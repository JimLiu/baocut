import { describe, expect, it } from 'vitest';
import {
  AGENT_SETUP_OUTPUT_LINES,
  OUTPUT_LIMIT,
  SETTING_DEFAULTS,
  type AgentSetupRun,
  type Conversation,
  type ConversationSnapshot,
  type JobRecord,
  type ModelBundleStatus,
  type ModelsSnapshot,
  type PendingApproval,
  type TasksSnapshot,
  type TimelineItem,
} from '@baocut/protocol';
import {
  applyAgentSetupEvent,
  applyConversationEvent,
  applyDirectoryEvent,
  applyJobsEvent,
  applyModelsEvent,
  applySettingsEvent,
  applyTasksEvent,
} from './reducers.ts';

const at = '2026-10-02T00:00:00.000Z';
const conversation: Conversation = {
  id: 'conv_1',
  title: '新会话',
  projectId: null,
  cwd: '/tmp/x',
  driverId: 'codex',
  model: null,
  effort: null,
  accessMode: 'ask',
  createdAt: at,
  updatedAt: at,
  archived: false,
  pinned: false,
  unread: false,
  activity: 'idle',
  activeTaskId: null,
};
const message: TimelineItem = { kind: 'agent-message', id: 'm1', createdAt: at, taskId: 't1', text: '你', streaming: true };
const command: TimelineItem = {
  kind: 'tool-call',
  id: 'c1',
  createdAt: at,
  taskId: 't1',
  tool: 'command',
  title: 'ls',
  detail: null,
  output: '',
  status: 'running',
  exitCode: null,
  durationMs: null,
};

describe('applyConversationEvent', () => {
  const base: ConversationSnapshot = { conversation, items: [message, command] };

  it('追加文字只换掉变化的条目，其余保持同一引用', () => {
    const next = applyConversationEvent(base, { type: 'item.append', itemId: 'm1', field: 'text', delta: '好' })!;
    expect(next.items[0]).toMatchObject({ text: '你好' });
    expect(next.items[1]).toBe(command);
    expect(base.items[0]).toMatchObject({ text: '你' });
  });

  it('输出超过上限时只保留结尾', () => {
    const next = applyConversationEvent(base, {
      type: 'item.append',
      itemId: 'c1',
      field: 'output',
      delta: 'x'.repeat(OUTPUT_LIMIT + 10),
    })!;
    const item = next.items[1]!;
    expect(item.kind === 'tool-call' && item.output.startsWith('…\n')).toBe(true);
    expect(item.kind === 'tool-call' && item.output.length).toBe(OUTPUT_LIMIT + 2);
  });

  it('未知条目的增量与字段不匹配的增量都忽略', () => {
    expect(applyConversationEvent(base, { type: 'item.append', itemId: 'nope', field: 'text', delta: 'x' })).toBe(base);
    expect(applyConversationEvent(base, { type: 'item.append', itemId: 'm1', field: 'output', delta: 'x' })).toBe(base);
  });

  it('upsert 替换同 ID 的条目，新条目追加在最后', () => {
    const replaced = applyConversationEvent(base, { type: 'item.upsert', item: { ...command, status: 'completed' } })!;
    expect(replaced.items).toHaveLength(2);
    expect(replaced.items[1]).toMatchObject({ status: 'completed' });
    const added = applyConversationEvent(base, { type: 'item.upsert', item: { ...message, id: 'm2' } })!;
    expect(added.items.map((i) => i.id)).toEqual(['m1', 'c1', 'm2']);
  });

  it('会话删除时返回 null', () => {
    expect(applyConversationEvent(base, { type: 'conversation.removed' })).toBeNull();
  });
});

describe('applyDirectoryEvent', () => {
  it('upsert 与删除会话', () => {
    const empty = { projects: [], conversations: [] };
    const added = applyDirectoryEvent(empty, { type: 'conversation.upsert', conversation });
    expect(added.conversations).toEqual([conversation]);
    const renamed = applyDirectoryEvent(added, { type: 'conversation.upsert', conversation: { ...conversation, title: '改名' } });
    expect(renamed.conversations).toHaveLength(1);
    expect(renamed.conversations[0]!.title).toBe('改名');
    expect(applyDirectoryEvent(renamed, { type: 'conversation.removed', conversationId: 'conv_1' }).conversations).toEqual([]);
  });
});

describe('applyJobsEvent', () => {
  const job = (jobId: string, state: JobRecord['state']) => ({ jobId, state }) as JobRecord;

  it('同 ID 的记录原位替换，新任务放在最前面', () => {
    const first = job('job_1', 'queued');
    const other = job('job_0', 'completed');
    const state = { jobs: [first, other] };
    const running = applyJobsEvent(state, { type: 'job.updated', job: job('job_1', 'running') });
    expect(running.jobs.map((j) => [j.jobId, j.state])).toEqual([
      ['job_1', 'running'],
      ['job_0', 'completed'],
    ]);
    expect(running.jobs[1]).toBe(other);
    expect(state.jobs[0]).toBe(first);
    const added = applyJobsEvent(running, { type: 'job.updated', job: job('job_2', 'queued') });
    expect(added.jobs.map((j) => j.jobId)).toEqual(['job_2', 'job_1', 'job_0']);
  });

  describe('实时段落', () => {
    const seg = (n: number, text = `段 ${n}`) => ({ start: n, end: n + 0.5, text });
    const segments = (jobId: string, from: number, list: Array<ReturnType<typeof seg>>) =>
      ({ type: 'job.segments', jobId, from, segments: list }) as const;

    it('从 from 起写入：接在后面是追加，已有的序号原位替换、其后的保留', () => {
      const state = { jobs: [job('job_1', 'running')] };
      const one = applyJobsEvent(state, segments('job_1', 0, [seg(0)]));
      expect(one.liveSegments).toEqual({ job_1: [seg(0)] });
      expect(one.jobs).toBe(state.jobs);
      const three = applyJobsEvent(one, segments('job_1', 1, [seg(1), seg(2)]));
      expect(three.liveSegments!.job_1).toEqual([seg(0), seg(1), seg(2)]);
      const replaced = applyJobsEvent(three, segments('job_1', 1, [seg(1, '改过')]));
      expect(replaced.liveSegments!.job_1).toEqual([seg(0), seg(1, '改过'), seg(2)]);
      expect(three.liveSegments!.job_1![1]).toEqual(seg(1));
      const other = applyJobsEvent(replaced, segments('job_2', 0, [seg(9)]));
      expect(Object.keys(other.liveSegments!)).toEqual(['job_1', 'job_2']);
      expect(other.liveSegments!.job_1).toBe(replaced.liveSegments!.job_1);
    });

    it('from 越过已有的段数（中间缺了）时整条忽略，原样返回', () => {
      const state = applyJobsEvent({ jobs: [job('job_1', 'running')] }, segments('job_1', 0, [seg(0)]));
      expect(applyJobsEvent(state, segments('job_1', 2, [seg(2)]))).toBe(state);
      const empty = { jobs: [job('job_1', 'running')] };
      expect(applyJobsEvent(empty, segments('job_1', 1, [seg(1)]))).toBe(empty);
    });

    it('任务还在跑时段落随记录更新保留；不再是 running 时丢掉，没有段落时不带 liveSegments', () => {
      let state = applyJobsEvent({ jobs: [job('job_1', 'running'), job('job_2', 'running')] }, segments('job_1', 0, [seg(0)]));
      state = applyJobsEvent(state, segments('job_2', 0, [seg(5)]));
      const progressed = applyJobsEvent(state, { type: 'job.updated', job: job('job_1', 'running') });
      expect(progressed.liveSegments).toBe(state.liveSegments);
      const unrelated = applyJobsEvent(progressed, { type: 'job.updated', job: job('job_3', 'completed') });
      expect(unrelated.liveSegments).toBe(state.liveSegments);
      const interrupted = applyJobsEvent(unrelated, { type: 'job.updated', job: job('job_1', 'interrupted') });
      expect(interrupted.liveSegments).toEqual({ job_2: [seg(5)] });
      const done = applyJobsEvent(interrupted, { type: 'job.updated', job: job('job_2', 'completed') });
      expect(done).not.toHaveProperty('liveSegments');
      expect(done.jobs.map((j) => [j.jobId, j.state])).toEqual([
        ['job_3', 'completed'],
        ['job_1', 'interrupted'],
        ['job_2', 'completed'],
      ]);
    });
  });
});

describe('applyTasksEvent', () => {
  const approval = (approvalId: string): PendingApproval => ({
    approvalId,
    subject: { kind: 'service', serviceId: 'mcp', clientId: 'cl', clientName: 'Claude' },
    action: { kind: 'tool', name: 'edits_apply', targets: ['v1'], summary: '改一处' },
    risk: 'edit',
    basis: { kind: 'service', level: 'ask' },
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:00:50.000Z',
  });

  it('审批出现时追加、结束时去掉；任务行不受影响', () => {
    const state: TasksSnapshot = { tasks: [], approvals: [] };
    const one = applyTasksEvent(state, { type: 'approval.upsert', approval: approval('a1') });
    const two = applyTasksEvent(one, { type: 'approval.upsert', approval: approval('a2') });
    expect(two.approvals!.map((a) => a.approvalId)).toEqual(['a1', 'a2']);
    const removed = applyTasksEvent(two, { type: 'approval.removed', approvalId: 'a1', outcome: 'allowed' });
    expect(removed.approvals!.map((a) => a.approvalId)).toEqual(['a2']);
    expect(removed.tasks).toBe(state.tasks);
  });

  it('只认任务的旧镜像（没有 approvals）照样能套用审批事件与任务事件', () => {
    const legacy: TasksSnapshot = { tasks: [] };
    const next = applyTasksEvent(legacy, { type: 'approval.upsert', approval: approval('a1') });
    expect(next.approvals).toHaveLength(1);
    expect(applyTasksEvent(legacy, { type: 'approval.removed', approvalId: 'x', outcome: 'cancelled' }).approvals).toEqual([]);
    expect(applyTasksEvent(legacy, { type: 'task.removed', taskId: 't' })).toEqual({ tasks: [] });
  });
});

describe('applySettingsEvent', () => {
  it('只换变了的键，默认值与其他键不变', () => {
    const state = { settings: { ...SETTING_DEFAULTS }, defaults: { ...SETTING_DEFAULTS } };
    const next = applySettingsEvent(state, { type: 'settings.updated', changed: { 'offline.strict': true } });
    expect(next.settings['offline.strict']).toBe(true);
    expect(next.settings['agent.defaultAccessMode']).toBe('auto');
    expect(next.defaults['offline.strict']).toBe(false);
    expect(state.settings['offline.strict']).toBe(false);
  });
});

describe('applyModelsEvent', () => {
  const bundle: ModelBundleStatus = { bundleId: 'b1', capability: 'transcribe', backend: 'mlx', device: 'metal', state: 'not-installed' };
  const state: ModelsSnapshot = { capabilities: { marker: 1 } as never, bundles: [bundle] };

  it('能力视图整个替换；模型包按 bundleId 替换或追加，不改原状态', () => {
    const replaced = applyModelsEvent(state, { type: 'capabilities.updated', capabilities: { marker: 2 } as never });
    expect(replaced).toEqual({ capabilities: { marker: 2 }, bundles: [bundle] });
    const downloading = { ...bundle, state: 'downloading' as const };
    const updated = applyModelsEvent(state, { type: 'bundle.updated', bundle: downloading });
    expect(updated.bundles).toEqual([downloading]);
    expect(state.bundles[0]!.state).toBe('not-installed');
    const added = applyModelsEvent(updated, { type: 'bundle.updated', bundle: { ...bundle, bundleId: 'b2' } });
    expect(added.bundles.map((b) => b.bundleId)).toEqual(['b1', 'b2']);
  });
});

describe('applyAgentSetupEvent', () => {
  const run: AgentSetupRun = {
    runId: 'setup_1',
    driverId: 'codex',
    action: 'upgrade',
    kind: 'brew',
    command: 'brew upgrade codex',
    state: 'running',
    exitCode: null,
    output: ['$ a'],
    droppedLines: 0,
    startedAt: at,
    endedAt: null,
    error: null,
  };

  it('新的一次放在最前面，同 ID 原位替换', () => {
    const older = { ...run, runId: 'setup_0', state: 'completed' as const };
    const state = applyAgentSetupEvent({ runs: [older] }, { type: 'setup.updated', run });
    expect(state.runs.map((r) => r.runId)).toEqual(['setup_1', 'setup_0']);
    const done = applyAgentSetupEvent(state, { type: 'setup.updated', run: { ...run, state: 'failed', exitCode: 1 } });
    expect(done.runs[0]).toMatchObject({ state: 'failed', exitCode: 1 });
    expect(done.runs[1]).toBe(older);
  });

  it('输出追加，超过上限时丢掉最早的并记数；未知 runId 忽略', () => {
    const state = { runs: [run] };
    const lines = Array.from({ length: AGENT_SETUP_OUTPUT_LINES }, (_, i) => `line ${i}`);
    const next = applyAgentSetupEvent(state, { type: 'setup.output', runId: 'setup_1', lines });
    expect(next.runs[0]!.output).toHaveLength(AGENT_SETUP_OUTPUT_LINES);
    expect(next.runs[0]!.output[0]).toBe('line 0');
    expect(next.runs[0]!.droppedLines).toBe(1);
    expect(applyAgentSetupEvent(state, { type: 'setup.output', runId: 'nope', lines: ['x'] })).toBe(state);
  });
});
