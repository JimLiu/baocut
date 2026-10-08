import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RpcError,
  newId,
  type DriverProbe,
  type EditorContext,
  type Id,
  type TaskBudgetLimits,
  type TaskBudgetPolicy,
  type TasksEvent,
} from '@baocut/protocol';
import { ConversationStore, ProjectStore, resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import type { AgentDriver, AgentEvent, AgentSession } from './driver.ts';
import { Harness } from './harness.ts';
import { silentLogger } from './logger.ts';
import type { TaskBudgetPort } from './task-contracts.ts';

/** 任务合同（架构设计 §3.2）：默认合同、修订与持久、修改的限制、改变目标与验收检查。假 Driver，全部在临时目录里。 */

const capabilities: DriverProbe['capabilities'] = { steer: false, approvals: true, resume: false, images: false };

/** 回合开始后一直开着，直到测试 `finish()`；中断请求很快以 interrupted 结束回合。 */
class Session implements AgentSession {
  readonly id = newId('fake');
  readonly capabilities = capabilities;
  readonly inputs: string[] = [];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  #turn = 0;
  turnId: string | null = null;

  startTurn(input: { text: string }): Promise<{ turnId: string }> {
    const turnId = `turn-${++this.#turn}`;
    this.turnId = turnId;
    this.inputs.push(input.text);
    setTimeout(() => this.#emit({ type: 'turn.started', turnId }), 1);
    return Promise.resolve({ turnId });
  }

  finish() {
    if (this.turnId) this.#emit({ type: 'turn.completed', turnId: this.turnId, outcome: 'completed', error: null });
    this.turnId = null;
  }

  async interrupt(turnId: string) {
    setTimeout(() => {
      if (this.turnId === turnId) {
        this.turnId = null;
        this.#emit({ type: 'turn.completed', turnId, outcome: 'interrupted', error: null });
      }
    }, 5);
    return { status: 'requested' as const };
  }

  async respondToApproval() {}

  subscribe(listener: (event: AgentEvent) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  describePersistence() {
    return null;
  }

  async close() {}

  #emit(event: AgentEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}

class Driver implements AgentDriver {
  readonly id = 'codex' as const;
  readonly sessions: Session[] = [];

  async probe(): Promise<DriverProbe> {
    return {
      id: 'codex',
      name: 'Fake',
      command: 'fake',
      state: 'ready',
      status: 'available',
      version: '0',
      minVersion: '0',
      latestVersion: null,
      unavailableReason: null,
      detail: null,
      executable: null,
      realExecutable: null,
      account: null,
      plan: '',
      loginCommand: null,
      install: [],
      models: [],
      configModel: null,
      configModelKnown: null,
      checkedAt: new Date().toISOString(),
      verified: true,
      tested: true,
      capabilities,
    };
  }

  async createSession(): Promise<AgentSession> {
    const session = new Session();
    this.sessions.push(session);
    return session;
  }
}

/** 内存里的任务预算账本：只记上限（用量的规则由授权账本测）。 */
class Budgets implements TaskBudgetPort {
  readonly policies = new Map<Id, TaskBudgetPolicy>();

  taskBudget(taskId: Id): TaskBudgetPolicy | null {
    return this.policies.get(taskId) ?? null;
  }

  setTaskBudget(taskId: Id, limits: TaskBudgetLimits): TaskBudgetPolicy {
    const now = new Date().toISOString();
    const existing = this.policies.get(taskId);
    const policy: TaskBudgetPolicy = {
      policyId: existing?.policyId ?? newId('tbp'),
      taskId,
      ...limits,
      usage: existing?.usage ?? { calls: 0, reservedCalls: 0, spent: [], reserved: [], unknownCostCalls: 0 },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.policies.set(taskId, policy);
    return policy;
  }
}

let dir: string;
let home: RuntimeHome;
let driver: Driver;
let budgets: Budgets;
let harness: Harness;

async function open(): Promise<Harness> {
  const drivers = new DriverRegistry();
  drivers.register(driver);
  return Harness.open({
    home,
    conversations: new ConversationStore(home.conversationsDir),
    projects: new ProjectStore(home.projectsFile),
    drivers,
    log: silentLogger,
    budgets,
  });
}

async function until<T>(read: () => T | undefined | null | false, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function rejection(run: () => unknown): RpcError {
  try {
    run();
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('应该被拒绝');
}

async function rejectionOf(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('应该被拒绝');
}

/** 发送并等回合开始。 */
async function start(conversationId: Id, text: string, extra: Partial<Parameters<Harness['send']>[0]> = {}) {
  const { taskId } = await harness.send({ conversationId, text, commandId: newId('cmd'), ...extra });
  const session = await until(() => driver.sessions.at(-1));
  await until(() => harness.agentRun(conversationId).taskId === taskId && session.turnId);
  return { taskId, session };
}

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-contract-')));
  home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  driver = new Driver();
  budgets = new Budgets();
  harness = await open();
});

afterEach(async () => {
  await harness.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('任务合同', () => {
  it('没有显式合同时建立默认合同：范围来自编辑器上下文，经任务条目与任务中心对用户可见', async () => {
    const conversation = await harness.createConversation({});
    const events: TasksEvent[] = [];
    harness.subscribe('tasks', undefined, (sequenced) => events.push(sequenced.event as TasksEvent));
    const context: EditorContext = {
      videoId: 'vid_1',
      videoName: '样片',
      videoPath: '样片',
      revision: '7',
      selection: ['itm_1'],
      playheadSeconds: 2,
    };
    const { taskId } = await start(conversation.id, '把开头剪短', { context, accessMode: 'autoAcceptEdits' });

    const { contract, latestRevision, budget } = harness.getContract(taskId);
    expect(latestRevision).toBe(1);
    expect(contract).toMatchObject({
      taskId,
      revision: 1,
      conversationId: conversation.id,
      videoId: 'vid_1',
      baseVideoRevision: '7',
      goal: '把开头剪短',
      scope: { videoId: 'vid_1', videoRevision: '7', sequenceId: null, itemIds: ['itm_1'], timeRange: null },
      constraints: [],
      protectedRefs: [],
      deliverables: [{ kind: 'video-change', requiredStage: 'committed' }],
      autonomy: 'autoAcceptEdits',
      permissionScopeRef: conversation.id,
      budgetPolicyRef: budget!.policyId,
      acceptanceChecks: [],
      supersedes: null,
      change: { by: 'runtime', reason: 'created', fields: [] },
    });
    expect(budget).toMatchObject({ taskId, maxCalls: null, cap: null });

    // 会话快照：任务条目带着合同；任务中心：任务行带着修订号。
    const task = harness.getConversation(conversation.id).items.find((i) => i.id === taskId);
    expect(task).toMatchObject({ kind: 'task', contract: { revision: 1, goal: '把开头剪短' } });
    expect(harness.tasksSnapshot().tasks.find((t) => t.taskId === taskId)).toMatchObject({ contractRevision: 1 });
    expect(events.some((e) => e.type === 'task.upsert' && e.task.taskId === taskId && e.task.contractRevision === 1)).toBe(true);
  });

  it('修改产生新修订、旧修订可查；切换访问模式也记一个修订；重启之后修订与检查结果都在', async () => {
    const conversation = await harness.createConversation({});
    const { taskId, session } = await start(conversation.id, '配字幕', {
      accessMode: 'ask',
      contract: {
        constraints: [{ kind: 'style', text: '字幕不超过两行' }],
        acceptanceChecks: [{ kind: 'review', description: '字幕和口播对得上', required: true }],
        budget: { maxCalls: 5, cap: null },
      },
    });
    const first = harness.getContract(taskId).contract;
    expect(first.change).toMatchObject({ by: 'user', reason: 'created' });
    expect(first.constraints).toEqual([{ constraintId: expect.any(String), kind: 'style', text: '字幕不超过两行' }]);
    expect(budgets.taskBudget(taskId)).toMatchObject({ maxCalls: 5 });

    const commandId = newId('cmd');
    const second = harness.updateContract({
      taskId,
      expectedRevision: 1,
      commandId,
      patch: {
        protectedRefs: [{ videoId: 'vid_1', target: { kind: 'entity', entityId: 'itm_9' }, note: '片头' }],
        budget: { maxCalls: 2, cap: { amount: '1.00', currency: 'USD' } },
      },
    }).contract;
    expect(second).toMatchObject({
      revision: 2,
      change: { by: 'user', reason: 'updated', fields: ['protectedRefs', 'budget'] },
      protectedRefs: [
        { videoId: 'vid_1', target: { kind: 'entity', entityId: 'itm_9' }, origin: { by: 'user', revision: 2 }, note: '片头' },
      ],
      budgetPolicyRef: first.budgetPolicyRef,
    });
    expect(budgets.taskBudget(taskId)).toMatchObject({ maxCalls: 2, cap: { amount: '1.00', currency: 'USD' } });
    // 同一个 commandId 只生效一次。
    expect(harness.updateContract({ taskId, expectedRevision: 1, commandId, patch: {} }).contract.revision).toBe(2);

    // 修订号不对：冲突，不产生修订。
    const stale = rejection(() =>
      harness.updateContract({ taskId, expectedRevision: 1, commandId: newId('cmd'), patch: { constraints: [] } }),
    );
    expect(stale).toMatchObject({ code: 'conflict', details: { code: 'CONTRACT_REVISION_CONFLICT', currentRevision: 2 } });

    // 合同的 autonomy 就是会话的模式：经合同改等于切换模式；切换会话的模式也给合同记一个修订。
    const third = harness.updateContract({ taskId, expectedRevision: 2, commandId: newId('cmd'), patch: { autonomy: 'auto' } }).contract;
    expect(third).toMatchObject({ revision: 3, autonomy: 'auto', change: { reason: 'updated', fields: ['autonomy'] } });
    expect(harness.agentRun(conversation.id).mode).toBe('auto');
    expect(harness.getConversation(conversation.id).conversation.accessMode).toBe('auto');
    harness.updateConversation({ conversationId: conversation.id, accessMode: 'plan' });
    expect(harness.getContract(taskId).contract).toMatchObject({
      revision: 4,
      autonomy: 'plan',
      change: { reason: 'mode', fields: ['autonomy'] },
    });

    // 检查结果。
    const [check] = harness.listChecks(taskId).checks;
    const recorded = harness.recordCheck({ taskId, checkId: check!.checkId, outcome: 'passed', note: '逐句核对过' }, 'agent').result;
    expect(recorded).toMatchObject({ checkId: check!.checkId, contractRevision: 4, outcome: 'passed', recordedBy: 'agent' });
    expect(rejection(() => harness.recordCheck({ taskId, checkId: 'check_nope', outcome: 'passed' }))).toMatchObject({ code: 'not-found' });

    // 旧修订可查。
    expect(harness.getContract(taskId, 1)).toMatchObject({ contract: { revision: 1, protectedRefs: [] }, latestRevision: 4 });
    expect(harness.listContracts({ taskId }).contracts.map((c) => c.revision)).toEqual([1, 2, 3, 4]);
    expect(rejection(() => harness.getContract(taskId, 9))).toMatchObject({ code: 'not-found' });

    session.finish();
    await until(() => harness.agentRun(conversation.id).taskId === null);
    // 任务结束之后不能再改（要换目标用 changeGoal），检查结果仍可以记。
    expect(rejection(() => harness.updateContract({ taskId, expectedRevision: 4, commandId: newId('cmd'), patch: {} }))).toMatchObject({
      code: 'conflict',
      details: { code: 'TASK_NOT_RUNNING' },
    });
    harness.recordCheck({ taskId, checkId: check!.checkId, outcome: 'failed' });

    // 重启：从磁盘读回。
    await harness.shutdown();
    harness = await open();
    expect(harness.listContracts({ taskId }).contracts.map((c) => c.revision)).toEqual([1, 2, 3, 4]);
    expect(harness.getContract(taskId, 2).contract.protectedRefs).toHaveLength(1);
    expect(harness.listChecks(taskId).results.map((r) => [r.outcome, r.recordedBy])).toEqual([
      ['passed', 'agent'],
      ['failed', 'user'],
    ]);
    expect(harness.listContracts({ conversationId: conversation.id }).contracts.map((c) => c.taskId)).toEqual([taskId]);
  });

  it('智能体不能改访问模式、预算与保护范围；能细化范围、约束与检查，修订记为智能体所改', async () => {
    const conversation = await harness.createConversation({});
    const { taskId } = await start(conversation.id, '做个预告片');
    for (const patch of [{ autonomy: 'fullAccess' as const }, { budget: { maxCalls: 100, cap: null } }, { protectedRefs: [] }]) {
      const refused = rejection(() => harness.updateContract({ taskId, expectedRevision: 1, commandId: newId('cmd'), patch }, 'agent'));
      expect(refused).toMatchObject({ code: 'forbidden', details: { code: 'CONTRACT_FIELD_READONLY', fields: Object.keys(patch) } });
    }
    expect(harness.getContract(taskId).latestRevision).toBe(1);
    const next = harness.updateContract(
      {
        taskId,
        expectedRevision: 1,
        commandId: newId('cmd'),
        patch: { constraints: [{ kind: 'duration', text: '不超过 30 秒' }], scope: { timeRange: { fromSeconds: 0, toSeconds: 30 } } },
      },
      'agent',
    ).contract;
    expect(next).toMatchObject({
      revision: 2,
      change: { by: 'agent', fields: ['constraints', 'scope'] },
      scope: { timeRange: { fromSeconds: 0, toSeconds: 30 } },
    });
  });

  it('改变目标：stop 停止旧任务后以新目标建立新任务；合同由旧合同派生，预算上限照搬', async () => {
    const conversation = await harness.createConversation({});
    const { taskId, session } = await start(conversation.id, '剪成 60 秒', {
      contract: { constraints: [{ kind: 'style', text: '保留片头' }], budget: { maxCalls: 3, cap: null } },
    });
    const changed = await harness.changeGoal({ taskId, goal: '剪成 30 秒', previousWork: 'stop', commandId: newId('cmd') });
    expect(changed.previousTaskId).toBe(taskId);
    expect(changed.taskId).not.toBe(taskId);
    const items = harness.getConversation(conversation.id).items;
    expect(items.find((i) => i.id === taskId)).toMatchObject({ kind: 'task', status: 'stopped' });
    expect(items.find((i) => i.id === changed.taskId)).toMatchObject({ kind: 'task', status: 'running', goal: '剪成 30 秒' });
    expect(changed.contract).toMatchObject({
      revision: 1,
      goal: '剪成 30 秒',
      supersedes: { taskId, previousWork: 'stop' },
      constraints: [{ kind: 'style', text: '保留片头' }],
      change: { by: 'user', reason: 'goal' },
    });
    expect(changed.contract.budgetPolicyRef).not.toBe(harness.getContract(taskId).contract.budgetPolicyRef);
    expect(budgets.taskBudget(changed.taskId)).toMatchObject({ maxCalls: 3 });
    await until(() => session.turnId);
    expect(session.inputs.at(-1)).toBe('剪成 30 秒');
    expect(items.some((i) => i.kind === 'notice' && i.text.startsWith('目标已改变：旧任务已停止'))).toBe(true);
  });

  it('改变目标：keep 只停下旧任务的回合，不取消它提交的后台 Job；旧任务已结束时直接建立新任务', async () => {
    const cancelled: Id[] = [];
    await harness.shutdown();
    const drivers = new DriverRegistry();
    drivers.register(driver);
    harness = await Harness.open({
      home,
      conversations: new ConversationStore(home.conversationsDir),
      projects: new ProjectStore(home.projectsFile),
      drivers,
      log: silentLogger,
      budgets,
      jobs: {
        cancelSubmittedBy: (conversationId) => {
          cancelled.push(conversationId);
          return 1;
        },
      },
    });
    const conversation = await harness.createConversation({});
    const { taskId } = await start(conversation.id, '生成配音');
    const kept = await harness.changeGoal({ taskId, goal: '只生成英文配音', previousWork: 'keep', commandId: newId('cmd') });
    expect(cancelled).toEqual([]);
    expect(kept.contract.supersedes).toEqual({ taskId, previousWork: 'keep' });
    const notice = harness.getConversation(conversation.id).items.find((i) => i.kind === 'notice' && i.text.includes('照常完成'));
    expect(notice).toBeDefined();

    // 新任务结束之后再换目标：stop 仍取消这个会话还没结束的 Job。
    driver.sessions.at(-1)!.finish();
    await until(() => harness.agentRun(conversation.id).taskId === null);
    const again = await harness.changeGoal({ taskId: kept.taskId, goal: '换成中文', previousWork: 'stop', commandId: newId('cmd') });
    expect(cancelled).toEqual([conversation.id]);
    expect(again.contract.supersedes).toEqual({ taskId: kept.taskId, previousWork: 'stop' });

    // 别的任务在运行时不能换旧任务的目标。
    const busy = await rejectionOf(harness.changeGoal({ taskId, goal: 'x', previousWork: 'stop', commandId: newId('cmd') }));
    expect(busy.code).toBe('busy');
  });

  it('早先没有合同的任务：读入时补上默认合同', async () => {
    const conversation = await harness.createConversation({});
    const { taskId, session } = await start(conversation.id, '旧任务', { accessMode: 'plan' });
    session.finish();
    await until(() => harness.agentRun(conversation.id).taskId === null);
    await harness.shutdown();
    // 去掉合同，模拟早先的记录：写成旧格式的整份 `<id>.json`，读入时迁移。
    const log = path.join(home.conversationsDir, `${conversation.id}.jsonl`);
    const store = new ConversationStore(home.conversationsDir);
    await store.load();
    const record = JSON.parse(JSON.stringify(store.get(conversation.id)));
    delete record.tasks;
    for (const item of record.items) delete item.contract;
    await fs.rm(log);
    await fs.writeFile(path.join(home.conversationsDir, `${conversation.id}.json`), JSON.stringify(record));

    budgets.policies.clear();
    harness = await open();
    expect(harness.getContract(taskId)).toMatchObject({
      contract: { revision: 1, goal: '旧任务', autonomy: 'plan', budgetPolicyRef: null, change: { by: 'runtime', reason: 'created' } },
      budget: null,
    });
    expect(harness.getConversation(conversation.id).items.find((i) => i.id === taskId)).toMatchObject({ contract: { revision: 1 } });
  });
});
