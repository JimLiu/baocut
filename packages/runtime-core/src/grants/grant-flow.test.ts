import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { fakeOpenAiHandler, startFakeProviderServer, type FakeProviderServer } from '@baocut/providers/testing';
import { RpcError, newId, type AgentMode, type Grant, type Id } from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { ToolDriver, tool, until, type ToolSession } from '../agent-tools/testing/fake-agent.ts';

/**
 * 数据外发的授权与预算端到端（架构设计 §12.5、§7.8、§6.8）：会话里的智能体经真实的 MCP 端点调用模型工具，界面连接直接提交，
 * 都走同一个 JobManager 的接纳；在线 Provider 只对本机回环地址上的假供应商。密钥是测试里编的字符串。
 * 不需要视频引擎；任务提交之后是否完成与授权无关（没有 ffprobe 时语音任务会失败，结算照样按规则计）。
 */

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-grants-0123456789';

interface Side {
  dir: string;
  home: RuntimeHome;
  runtime: RunningRuntime;
  driver: ToolDriver;
  client: BaoCutClient;
  conversationId: Id;
}

async function boot(dir: string, openai: FakeProviderServer): Promise<Side> {
  const home = resolveRuntimeHome({ BAOCUT_HOME: dir });
  const driver = new ToolDriver();
  const runtime = await startRuntime({
    home,
    drivers: () => [driver],
    watchSpace: false,
    engineHost: null,
    modelWorker: null,
    jobIdleMs: 60_000,
    initiator: { discoverer: null },
    nodes: { host: '127.0.0.1', advertiser: null },
    online: { baseUrls: { openai: `${openai.origin}/v1` }, http: { backoffMs: () => 10 } },
  });
  const { endpoint, token } = runtime.discovery;
  const client = new BaoCutClient({
    resolve: async () => ({ endpoint, token }),
    client: { kind: 'desktop', name: 'test', version: '0' },
    reconnect: false,
  });
  await client.connect();
  const { project } = await client.request('projects.create', { name: '授权' });
  const {
    conversation: { id: conversationId },
  } = await client.request('conversations.create', { projectId: project.id });
  return { dir, home, runtime, driver, client, conversationId };
}

async function shutdown(side: Side | undefined): Promise<void> {
  if (!side) return;
  side.client.close();
  await side.runtime.close();
}

/** 发一条消息（指定访问模式），等假智能体的回合开始。 */
async function send(side: Side, accessMode: AgentMode): Promise<{ taskId: Id; session: ToolSession }> {
  const { taskId } = await side.client.request('conversations.send', {
    conversationId: side.conversationId,
    text: '做点事',
    commandId: newId('cmd'),
    accessMode,
  });
  const session = await until(() => side.driver.sessions[0]);
  await until(() => session.turnId === taskId || session.turnId);
  return { taskId, session };
}

async function grantsOf(side: Side, includeEnded = false): Promise<Grant[]> {
  return (await side.client.request('grants.list', { recipient: 'openai', ...(includeEnded ? { includeEnded } : {}) })).grants;
}

async function revokeDefault(side: Side): Promise<Grant> {
  const [byDefault] = await grantsOf(side);
  expect(byDefault).toMatchObject({ origin: 'provider-enable' });
  await side.client.request('grants.revoke', { grantId: byDefault!.grantId });
  return byDefault!;
}

function rejection(promise: Promise<unknown>): Promise<RpcError> {
  return promise.then(
    () => {
      throw new Error('应当被拒绝');
    },
    (error: unknown) => error as RpcError,
  );
}

describe('数据外发的授权与预算', () => {
  let side: Side | undefined;
  let openai: FakeProviderServer | undefined;
  let dir: string | undefined;

  async function start(): Promise<Side> {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-grants-'));
    side = await boot(dir, openai);
    return side;
  }

  afterEach(async () => {
    await shutdown(side);
    await openai?.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    side = openai = dir = undefined;
  });

  it('迁移规则：启用发放默认授权（风险 command）；撤销后是 high 带外发的审批；只这一次与持续授权', async () => {
    const s = await start();
    await s.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const [byDefault] = await grantsOf(s);
    expect(byDefault).toMatchObject({
      origin: 'provider-enable',
      recipient: 'openai',
      scope: { videoId: null },
      budgetMode: 'per-call-unknown-cost',
      budgetCap: null,
      maxCalls: null,
      once: false,
    });
    expect([...byDefault!.dataKinds].sort()).toEqual(['audio', 'document', 'transcript']);

    const { taskId, session } = await send(s, 'auto');
    const covered = await tool(session, 'speak', { text: 'hi', provider: 'openai' });
    expect(covered.body).toMatchObject({ approval: { mode: 'auto', risk: 'command', decidedBy: 'auto' } });
    expect(s.runtime.models.jobs.inspect(covered.body.jobId).grant).toMatchObject({ grantId: byDefault!.grantId, dataKinds: ['document'] });

    // 撤销之后：同样的调用要新的授权，风险 high，审批里列出要交出的数据。
    await s.client.request('grants.revoke', { grantId: byDefault!.grantId });
    const first = tool(session, 'speak', { text: 'again', provider: 'openai' });
    const asked = await until(() => s.runtime.harness.approvals.pending()[0]);
    expect(asked).toMatchObject({
      risk: 'high',
      action: { name: 'speak' },
      grants: [{ recipient: 'openai', dataKinds: ['document'], capability: 'synthesizeSpeech', reason: 'revoked', cost: 'unknown' }],
    });
    expect((await s.client.request('jobs.list', {})).jobs).toHaveLength(1);
    // 不带选择 = 只这一次。
    await s.client.request('approvals.respond', { approvalId: asked.approvalId, decision: 'allow' });
    const once = (await first).body;
    expect(once.approval).toEqual({ mode: 'auto', risk: 'high', decidedBy: 'user' });
    const onceGrantId = s.runtime.models.jobs.inspect(once.jobId).grant!.grantId;
    expect((await grantsOf(s, true)).find((g) => g.grantId === onceGrantId)).toMatchObject({
      once: true,
      origin: 'approval',
      taskId,
      maxCalls: 1,
      usage: { calls: expect.any(Number) },
    });

    // 只这一次的授权不覆盖下一次：再问；这次发放持续授权（全部视频）。
    const second = tool(session, 'speak', { text: 'third', provider: 'openai' });
    const askedAgain = await until(() => s.runtime.harness.approvals.pending()[0]);
    expect(askedAgain.approvalId).not.toBe(asked.approvalId);
    await s.client.request('approvals.respond', {
      approvalId: askedAgain.approvalId,
      decision: 'allow',
      grant: { persist: true, scope: 'all' },
    });
    expect((await second).isError).toBe(false);
    const persistent = (await grantsOf(s)).find((g) => g.origin === 'approval' && !g.once)!;
    expect(persistent).toMatchObject({ scope: { videoId: null }, taskId: null, maxCalls: null });

    // 持续授权覆盖之后不再问。
    const after = await tool(session, 'speak', { text: 'fourth', provider: 'openai' });
    expect(after.body.approval).toEqual({ mode: 'auto', risk: 'command', decidedBy: 'auto' });
    expect(s.runtime.harness.approvals.pending()).toEqual([]);
    expect(s.runtime.models.jobs.inspect(after.body.jobId).grant!.grantId).toBe(persistent.grantId);

    // 不涉及外发的审批不能带授权的选择。
    await expect(
      s.client.request('approvals.respond', { approvalId: 'apv_none', decision: 'allow', grant: { persist: false } }),
    ).resolves.toEqual({ status: 'already-resolved' });
  });

  it('完全访问：没有授权覆盖的外发自动按只这一次放行；预算上限照样生效（BUDGET_EXCEEDED，不进审批）', async () => {
    const s = await start();
    await s.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await revokeDefault(s);
    const { session } = await send(s, 'fullAccess');

    const auto = await tool(session, 'speak', { text: 'hi', provider: 'openai' });
    expect(auto.body.approval).toEqual({ mode: 'fullAccess', risk: 'high', decidedBy: 'auto' });
    const used = s.runtime.models.jobs.inspect(auto.body.jobId).grant!;
    expect((await grantsOf(s, true)).find((g) => g.grantId === used.grantId)).toMatchObject({ once: true });

    const { grant: capped } = await s.client.request('grants.create', {
      recipient: 'openai',
      dataKinds: ['document'],
      purpose: '配音，最多一次',
      budgetMode: 'per-call-unknown-cost',
      maxCalls: 1,
    });
    expect((await tool(session, 'speak', { text: 'one', provider: 'openai' })).isError).toBe(false);
    const jobs = (await s.client.request('jobs.list', {})).jobs.length;
    const over = await tool(session, 'speak', { text: 'two', provider: 'openai' });
    expect(over.isError).toBe(true);
    expect(over.body.error).toMatchObject({
      code: 'BUDGET_EXCEEDED',
      grantId: capped.grantId,
      measure: 'calls',
      remedy: { action: 'raise-budget', commands: [`baocut grants update ${capped.grantId} --max-calls <更大的次数>`] },
      next: expect.stringContaining('不要换服务商'),
    });
    expect(s.runtime.harness.approvals.pending()).toEqual([]);
    expect((await s.client.request('jobs.list', {})).jobs).toHaveLength(jobs);
  });

  it('grants_request：一个任务的多项外发合并成一条审批；任务内的授权按次数封顶，之后的调用不再问', async () => {
    const s = await start();
    await s.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await revokeDefault(s);
    const { taskId, session } = await send(s, 'auto');

    const requesting = tool(session, 'grants_request', {
      items: [
        { capability: 'synthesizeSpeech', provider: 'openai', calls: 2, purpose: '旁白配音' },
        { capability: 'transcribe', provider: 'openai', calls: 1, purpose: '转写采访' },
      ],
    });
    const asked = await until(() => s.runtime.harness.approvals.pending()[0]);
    expect(s.runtime.harness.approvals.pending()).toHaveLength(1);
    expect(asked).toMatchObject({
      risk: 'high',
      action: { name: 'grants_request' },
      grants: [
        { capability: 'synthesizeSpeech', dataKinds: ['document'], maxCalls: 2 },
        { capability: 'transcribe', dataKinds: ['audio'], maxCalls: 1 },
      ],
    });
    await s.client.request('approvals.respond', { approvalId: asked.approvalId, decision: 'allow' });
    const granted = (await requesting).body;
    expect(granted.items).toMatchObject([
      { status: 'granted', recipient: 'openai', dataKinds: ['document'], maxCalls: 2, taskId },
      { status: 'granted', recipient: 'openai', dataKinds: ['audio'], maxCalls: 1, taskId },
    ]);

    for (const text of ['一', '二']) {
      const call = await tool(session, 'speak', { text, provider: 'openai' });
      expect(call.body.approval).toEqual({ mode: 'auto', risk: 'command', decidedBy: 'auto' });
    }
    const over = await tool(session, 'speak', { text: '三', provider: 'openai' });
    expect(over.body.error).toMatchObject({ code: 'BUDGET_EXCEEDED', grantId: granted.items[0].grantId });
    expect(s.runtime.harness.approvals.pending()).toEqual([]);

    const usage = await s.client.request('grants.usage', { grantId: granted.items[0].grantId });
    expect(usage.jobs).toHaveLength(2);
    expect(usage.grant.usage.calls + usage.grant.usage.reservedCalls).toBe(2);

    // 已有授权覆盖的项不再申请。
    const again = await tool(session, 'grants_request', {
      items: [{ capability: 'transcribe', provider: 'openai', calls: 1, purpose: '转写采访' }],
    });
    expect(again.body.items).toMatchObject([{ status: 'covered', grantId: granted.items[1].grantId }]);
  });

  it('并发提交：多个任务同时提交，预留是原子的，次数上限不会被超出；超出的以 BUDGET_EXCEEDED 拒绝且不建任务', async () => {
    const s = await start();
    await s.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await revokeDefault(s);
    const { grant } = await s.client.request('grants.create', {
      recipient: 'openai',
      dataKinds: ['document'],
      purpose: '并发测试',
      budgetMode: 'per-call-unknown-cost',
      maxCalls: 3,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => s.client.request('models.synthesizeSpeech', { text: `第 ${i} 段`, provider: 'openai' })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(3);
    expect(refused).toHaveLength(5);
    for (const r of refused) expect((r.reason as RpcError).details).toMatchObject({ code: 'BUDGET_EXCEEDED', grantId: grant.grantId });
    expect((await s.client.request('jobs.list', {})).jobs).toHaveLength(3);
    const { grant: after } = await s.client.request('grants.usage', { grantId: grant.grantId });
    expect(after.usage.calls + after.usage.reservedCalls).toBe(3);
  });

  it('金额上限而模型没有价格：界面提交是 BUDGET_UNVERIFIABLE；会话里是「金额未知、只这一次」的审批', async () => {
    const s = await start();
    await s.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await revokeDefault(s);
    const { grant } = await s.client.request('grants.create', {
      recipient: 'openai',
      dataKinds: ['document'],
      purpose: '有金额上限',
      budgetMode: 'estimate-cap',
      budgetCap: { amount: '5', currency: 'USD' },
    });
    const error = await rejection(s.client.request('models.synthesizeSpeech', { text: 'hi', provider: 'openai' }));
    expect(error.code).toBe('conflict');
    expect(error.details).toMatchObject({ code: 'BUDGET_UNVERIFIABLE', grantId: grant.grantId, remedy: { action: 'approve-once' } });

    const { session } = await send(s, 'auto');
    const pending = tool(session, 'speak', { text: 'hi', provider: 'openai' });
    const asked = await until(() => s.runtime.harness.approvals.pending()[0]);
    expect(asked.grants).toMatchObject([{ reason: 'unverifiable', estimate: null, cost: 'unknown' }]);
    await s.client.request('approvals.respond', { approvalId: asked.approvalId, decision: 'allow' });
    const allowed = await pending;
    expect(allowed.isError).toBe(false);
    const use = s.runtime.models.jobs.inspect(allowed.body.jobId).grant!;
    expect(use.grantId).not.toBe(grant.grantId);
    expect(use).toMatchObject({ budgetMode: 'per-call-unknown-cost', reserved: { calls: 1, amount: null } });
    // 有金额上限的授权没有被动用。
    expect((await s.client.request('grants.usage', { grantId: grant.grantId })).grant.usage).toMatchObject({ calls: 0, reservedCalls: 0 });
  });

  it('任务预算：任务里的外发跨调用合计；超出时 TASK_BUDGET_EXCEEDED、不建任务、不进审批；金额上限而估不出时 TASK_BUDGET_UNVERIFIABLE', async () => {
    const s = await start();
    await s.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const created = await s.client.request('tasks.create', {
      conversationId: s.conversationId,
      goal: '配两段音',
      commandId: newId('cmd'),
      accessMode: 'auto',
      contract: { budget: { maxCalls: 1, cap: null } },
    });
    const taskId = created.taskId;
    expect(created.contract).toMatchObject({ taskId, revision: 1, autonomy: 'auto', budgetPolicyRef: expect.any(String) });
    const session = await until(() => s.driver.sessions[0]);
    await until(() => session.turnId);

    const first = await tool(session, 'speak', { text: '第一段', provider: 'openai' });
    expect(first.isError).toBe(false);
    // 授权（默认授权，不限次数）放行，任务预算不放行：明确的错误码，不建任务，也不进审批。
    const second = await tool(session, 'speak', { text: '第二段', provider: 'openai' });
    expect(second.isError).toBe(true);
    expect(second.body.error).toMatchObject({ code: 'TASK_BUDGET_EXCEEDED', taskId, measure: 'calls', taskBudget: { maxCalls: 1 } });
    expect((await s.client.request('jobs.list', {})).jobs).toHaveLength(1);
    expect(s.runtime.harness.approvals.pending()).toEqual([]);
    // 任务里启动的流程：子步骤经父任务找到所在的智能体任务，一样计入。
    expect(s.runtime.models.grants.taskOf({ kind: 'pipeline', id: first.body.jobId })).toBe(taskId);

    const view = await s.client.request('tasks.getContract', { taskId });
    expect(view.budget!.usage.calls + view.budget!.usage.reservedCalls).toBe(1);
    // 用户改成金额上限：模型没有价格，估不出，任务预算无法保证。
    await s.client.request('tasks.updateContract', {
      taskId,
      expectedRevision: view.contract.revision,
      commandId: newId('cmd'),
      patch: { budget: { maxCalls: null, cap: { amount: '5', currency: 'USD' } } },
    });
    const third = await tool(session, 'speak', { text: '第三段', provider: 'openai' });
    expect(third.body.error).toMatchObject({ code: 'TASK_BUDGET_UNVERIFIABLE', taskId });
    expect((await s.client.request('jobs.list', {})).jobs).toHaveLength(1);
    // 智能体不能自己放宽预算。
    const widened = await tool(session, 'tasks_update_contract', {
      expectedRevision: view.contract.revision + 1,
      patch: { budget: { maxCalls: null, cap: null } },
    });
    expect(widened.body.error).toMatchObject({ code: 'CONTRACT_FIELD_READONLY', fields: ['budget'] });

    // 界面连接直接提交的不在任务里，不受任务预算限制。
    await s.client.request('models.synthesizeSpeech', { text: '界面', provider: 'openai' });
    expect((await s.client.request('jobs.list', {})).jobs).toHaveLength(2);
  });

  it('迁移规则的持久：用户撤销的默认授权重启后不补发；停用撤销、重新启用另发；旧版本没有启用时间的也有默认授权', async () => {
    const s = await start();
    await s.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const byDefault = await revokeDefault(s);
    // 账本是延后写入的：先等它落盘再看文件。
    await s.runtime.models.grants.flush();
    expect((await fs.stat(s.home.grantsFile)).mode & 0o777).toBe(0o600);

    // 重启：撤销的不补发（同一次启用）。
    await shutdown(s);
    side = await boot(dir!, openai!);
    expect(await grantsOf(side)).toEqual([]);
    expect((await grantsOf(side, true)).find((g) => g.grantId === byDefault.grantId)).toMatchObject({ state: 'revoked' });

    // 停用再启用：新的一次启用，另发一条；停用时撤销它。
    await side.client.request('models.configure', { providerId: 'openai', enabled: false });
    await side.client.request('models.configure', { providerId: 'openai', enabled: true });
    const [fresh] = await until(async () => {
      const active = await grantsOf(side!);
      return active.length > 0 ? active : null;
    });
    expect(fresh).toMatchObject({ origin: 'provider-enable', state: 'active' });
    expect(fresh!.grantId).not.toBe(byDefault.grantId);
    await side.client.request('models.configure', { providerId: 'openai', enabled: false });
    await until(async () => (await grantsOf(side!)).length === 0);

    // 旧版本写的配置：启用着但没有启用时间；授权账本也还没有。升级后照样有默认授权，原有的调用不变。
    await side.client.request('models.configure', { providerId: 'openai', enabled: true });
    await shutdown(side);
    const services = JSON.parse(await fs.readFile(side.home.modelServicesFile, 'utf8'));
    delete services.providers.openai.enabledAt;
    await fs.writeFile(side.home.modelServicesFile, JSON.stringify(services));
    await fs.rm(side.home.grantsFile);
    side = await boot(dir!, openai!);
    const [legacy] = await until(async () => {
      const active = await grantsOf(side!);
      return active.length > 0 ? active : null;
    });
    expect(legacy).toMatchObject({ origin: 'provider-enable', state: 'active' });
    const { jobId } = await side.client.request('models.synthesizeSpeech', { text: 'hi', provider: 'openai' });
    expect((await side.client.request('jobs.inspect', { jobId })).grant).toMatchObject({ grantId: legacy!.grantId });
  });

  it('网关上的授权方法：create / update / revoke / usage 与 grants 主题；收紧使代加一', async () => {
    const s = await start();
    await s.client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const { grant } = await s.client.request('grants.create', {
      recipient: 'openai',
      dataKinds: ['audio', 'document'],
      purpose: '用户发放',
      budgetMode: 'per-call-unknown-cost',
      maxCalls: 10,
    });
    expect(grant).toMatchObject({ origin: 'user', generation: 1, state: 'active' });
    const { grant: widened } = await s.client.request('grants.update', { grantId: grant.grantId, maxCalls: 20 });
    expect(widened.generation).toBe(1);
    const { grant: narrowed } = await s.client.request('grants.update', { grantId: grant.grantId, dataKinds: ['audio'] });
    expect(narrowed.generation).toBe(2);
    const revoked = await s.client.request('grants.revoke', { grantId: grant.grantId });
    expect(revoked.grant).toMatchObject({ state: 'revoked', generation: 3 });
    expect(revoked.note).toEqual(expect.any(String));
    expect((await rejection(s.client.request('grants.usage', { grantId: 'grt_nope' }))).code).toBe('not-found');
    expect(
      (
        await rejection(
          s.client.request('grants.create', { recipient: 'openai', dataKinds: ['audio'], purpose: 'x', budgetMode: 'estimate-cap' }),
        )
      ).code,
    ).toBe('invalid-request');

    const events: unknown[] = [];
    const snapshot = await new Promise<{ grants: Grant[] }>((resolve) => {
      s.client.subscribe('grants', { snapshot: resolve, event: (event: unknown) => events.push(event) });
    });
    expect(snapshot.grants.map((g) => g.grantId)).toContain(grant.grantId);
    await s.client.request('grants.create', {
      recipient: 'openai',
      dataKinds: ['frames'],
      purpose: '缩略图',
      budgetMode: 'per-call-unknown-cost',
    });
    await until(() => events.some((e) => (e as { type: string }).type === 'grant.upsert'));
  });
});
