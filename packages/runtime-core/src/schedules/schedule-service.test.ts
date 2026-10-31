import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { RpcError, type ActiveState, type Conversation, type Id, type Schedule, type TaskStatus, type TaskSummary, type TasksEvent, type WorkItemStatus, type WorkItemTemplate } from '@baocut/protocol';
import { SCHEDULE_MAX_TIMER_MS, ScheduleService, type ScheduleClock, type ScheduleHost } from './schedule-service.ts';

/** 定时任务（产品设计 §6.1「定时任务」）：假时钟、假会话与假发送，不起 Agent。钉在 UTC，时刻按墙上时间写。 */
const previousTz = process.env.TZ;
process.env.TZ = 'UTC';
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-10-30T08:00:00.000Z');

class FakeClock implements ScheduleClock {
  t = T0;
  timers = new Map<number, { at: number; fn: () => void }>();
  delays: number[] = [];
  #seq = 0;
  now = () => this.t;
  setTimer = (fn: () => void, ms: number) => {
    const id = ++this.#seq;
    this.delays.push(ms);
    this.timers.set(id, { at: this.t + ms, fn });
    return () => void this.timers.delete(id);
  };
  /** 往前拨，途中到点的计时器按顺序触发。 */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = Math.max(this.t, due[1].at);
      due[1].fn();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

const conversation = (patch: Partial<Conversation> & { id: Id }): Conversation => ({
  title: 'Promo',
  projectId: 'p1',
  cwd: '/work/promo',
  driverId: 'claude',
  model: 'sonnet',
  effort: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  archived: false,
  pinned: false,
  unread: false,
  activity: 'idle',
  activeTaskId: null,
  accessMode: 'fullAccess',
  ...patch,
});

class FakeHost implements ScheduleHost {
  conversations = new Map<Id, Conversation>();
  projects = new Set<Id>(['p1']);
  tasks = new Map<Id, TaskSummary>();
  sent: { conversationId: Id; text: string; commandId: Id }[] = [];
  created: Parameters<ScheduleHost['createConversation']>[0][] = [];
  events: TasksEvent[] = [];
  sendError: Error | null = null;
  bot?: FakeBot;
  #n = 0;

  conversation = (id: Id) => this.conversations.get(id);
  hasProject = (id: Id) => this.projects.has(id);
  createConversation = async (p: Parameters<ScheduleHost['createConversation']>[0]) => {
    const c = conversation({
      id: `new${++this.#n}`,
      projectId: p.projectId,
      title: p.title,
      driverId: p.agent.driverId,
      accessMode: p.agent.accessMode,
    });
    this.conversations.set(c.id, c);
    this.created.push(p);
    return c;
  };
  send = async (p: { conversationId: Id; text: string; commandId: Id }) => {
    if (this.sendError) throw this.sendError;
    const taskId = `t${++this.#n}`;
    this.sent.push(p);
    this.tasks.set(taskId, {
      taskId,
      conversationId: p.conversationId,
      conversationTitle: 'Promo',
      projectId: 'p1',
      goal: p.text,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      error: null,
    });
    this.setActivity(p.conversationId, 'running', taskId);
    return { taskId };
  };
  task = (id: Id) => this.tasks.get(id);
  publish = (event: TasksEvent) => void this.events.push(event);

  setActivity(id: Id, activity: Conversation['activity'], activeTaskId: Id | null = null): Conversation {
    const c = { ...this.conversations.get(id)!, activity, activeTaskId };
    this.conversations.set(id, c);
    return c;
  }
}

/** Bot 模式的宿主一侧（§11.1）：频道在不在、建任务、任务的状态。 */
class FakeBot implements NonNullable<ScheduleHost['bot']> {
  channels = new Map<Id, { archived: boolean }>([['chan1', { archived: false }]]);
  items = new Map<Id, { status: WorkItemStatus; activeState: ActiveState | null }>();
  created: { channelId: Id; template: WorkItemTemplate; scheduleId: Id; runId: Id }[] = [];
  #n = 0;
  channel = (id: Id) => this.channels.get(id);
  createWorkItem = async (channelId: Id, template: WorkItemTemplate, scheduleId: Id, runId: Id) => {
    const workItemId = `wi${++this.#n}`;
    this.created.push({ channelId, template, scheduleId, runId });
    this.items.set(workItemId, { status: 'active', activeState: 'working' });
    return { workItemId };
  };
  workItem = (id: Id) => this.items.get(id);
  paused = false;
  automationPaused = () => this.paused;
}

class MemoryStore {
  saved: Schedule[] = [];
  readonly initial: Schedule[];
  constructor(initial: Schedule[] = []) {
    this.initial = initial;
  }
  load = async () => structuredClone(this.initial);
  save = async (list: readonly Schedule[]) => void (this.saved = structuredClone([...list]));
}

let clock: FakeClock;
let host: FakeHost;
let store: MemoryStore;
let service: ScheduleService;
let ids = 0;

async function boot(initial: Schedule[] = []): Promise<void> {
  store = new MemoryStore(initial);
  service = new ScheduleService({ store, host, clock, log: silentLogger, newId: () => `id${++ids}` });
  await service.start();
}

/** 任务结束：任务记状态，会话空下来，两边都告诉服务。 */
function finish(taskId: Id, status: TaskStatus, error: string | null = null): void {
  const task = { ...host.tasks.get(taskId)!, status, endedAt: new Date(clock.t).toISOString(), error };
  host.tasks.set(taskId, task);
  service.taskChanged(task);
  service.conversationChanged(host.setActivity(task.conversationId, status === 'failed' ? 'failed' : 'idle'));
}

const daily = (overrides: Partial<Parameters<ScheduleService['create']>[0]> = {}) =>
  service.create({
    conversationId: 'c1',
    prompt: 'Check the glossary',
    cadence: { type: 'daily', time: '09:00' },
    target: 'conversation',
    maxRuns: null,
    commandId: `cmd${++ids}`,
    ...overrides,
  });

const only = () => service.list()[0]!;

beforeEach(async () => {
  clock = new FakeClock();
  host = new FakeHost();
  host.conversations.set('c1', conversation({ id: 'c1' }));
  ids = 0;
  await boot();
});

describe('建立', () => {
  it('从会话取 Agent 设置，名称空着取话的开头，算出下一次，推送并落盘', async () => {
    const { schedule } = await daily({ name: '  ' });
    expect(schedule).toMatchObject({
      name: 'Check the glossary',
      conversationId: 'c1',
      projectId: 'p1',
      agent: { driverId: 'claude', model: 'sonnet', effort: null, accessMode: 'fullAccess' },
      status: 'active',
      nextAt: '2026-10-30T09:00:00.000Z',
      runCount: 0,
    });
    expect(host.events).toContainEqual({ type: 'schedule.upsert', schedule: expect.objectContaining({ id: schedule.id }) });
    expect(store.saved.map((s) => s.id)).toEqual([schedule.id]);
  });

  it('已归档的会话、无项目会话选每次新开、频率不对都拒绝；同一个 commandId 只建一次', async () => {
    host.conversations.set('arch', conversation({ id: 'arch', archived: true }));
    host.conversations.set('loose', conversation({ id: 'loose', projectId: null }));
    await expect(daily({ conversationId: 'arch' })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(daily({ conversationId: 'loose', target: 'new' })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(daily({ cadence: { type: 'cron', expr: '0 0 30 2 *' } })).rejects.toMatchObject({
      code: 'invalid-request',
      details: { code: 'cron-never' },
    });
    await expect(daily({ conversationId: 'nope' })).rejects.toMatchObject({ code: 'not-found' });
    const first = await daily({ commandId: 'same' });
    const again = await daily({ commandId: 'same' });
    expect(again.schedule.id).toBe(first.schedule.id);
    expect(service.list()).toHaveLength(1);
  });
});

describe('到点', () => {
  it('到点时把话发给会话，下一次算到明天；任务完成记完成与次数', async () => {
    await daily();
    await clock.advance(HOUR - 1);
    expect(host.sent).toEqual([]);
    await clock.advance(1);
    expect(host.sent).toEqual([{ conversationId: 'c1', text: 'Check the glossary', commandId: expect.stringMatching(/^schedule:/) }]);
    expect(only()).toMatchObject({ nextAt: '2026-10-31T09:00:00.000Z', runs: [{ status: 'running', taskId: 't1', conversationId: 'c1' }] });
    await clock.advance(MIN);
    finish('t1', 'completed');
    expect(only()).toMatchObject({ runCount: 1, runs: [{ status: 'done', endedAt: '2026-10-30T09:01:00.000Z' }] });
  });

  it('会话正忙时排队，空下来再发；上一次还没结束时到点跳过', async () => {
    await daily({ cadence: { type: 'hourly', minute: 0 } });
    host.setActivity('c1', 'awaiting-approval');
    await clock.advance(HOUR);
    expect(host.sent).toEqual([]);
    expect(only().runs.map((r) => r.status)).toEqual(['queued']);
    // 还在排队时又到点：跳过。
    await clock.advance(HOUR);
    expect(only().runs.map((r) => r.status)).toEqual(['skipped', 'queued']);
    service.conversationChanged(host.setActivity('c1', 'idle'));
    await settle();
    expect(host.sent).toHaveLength(1);
    expect(only().runs.map((r) => r.status)).toEqual(['skipped', 'running']);
    await clock.advance(HOUR);
    expect(only().runs.map((r) => r.status)).toEqual(['skipped', 'skipped', 'running']);
    expect(host.sent).toHaveLength(1);
  });

  it('发不出去记在这一次上算失败，计时器照常；抢先变忙时退回排队', async () => {
    await daily({ cadence: { type: 'hourly', minute: 0 } });
    host.sendError = new RpcError('not-found', 'Agent unavailable');
    await clock.advance(HOUR);
    expect(only()).toMatchObject({ runCount: 1, runs: [{ status: 'failed', error: 'Agent unavailable' }] });
    host.sendError = new RpcError('busy', 'Busy');
    await clock.advance(HOUR);
    expect(only().runs.map((r) => r.status)).toEqual(['queued', 'failed']);
    host.sendError = null;
    service.conversationChanged(host.setActivity('c1', 'idle'));
    await settle();
    expect(only().runs.map((r) => r.status)).toEqual(['running', 'failed']);
  });

  it('停下的任务算失败并写明；失败的任务带上原因', async () => {
    await daily({ cadence: { type: 'hourly', minute: 0 } });
    await clock.advance(HOUR);
    finish('t1', 'stopped');
    await clock.advance(HOUR);
    finish('t2', 'failed', 'Model error');
    expect(only().runs).toMatchObject([
      { status: 'failed', error: 'Model error' },
      { status: 'failed', error: '没跑完就停下了', errorRef: { key: 'rcSchedules.runStopped' } },
    ]);
    expect(only().runCount).toBe(2);
  });

  it('同一刻对两次表只发一次；计时器最长等一小时', async () => {
    await daily({ cadence: { type: 'cron', expr: '0 9 * * 1' } });
    // 下一次是 11 月 2 日周一：中途每小时醒一次，不发。
    expect(Math.max(...clock.delays)).toBeLessThanOrEqual(SCHEDULE_MAX_TIMER_MS);
    await clock.advance(3 * 24 * HOUR);
    expect(host.sent).toEqual([]);
    expect(clock.delays.length).toBeGreaterThan(70);
    expect(Math.max(...clock.delays)).toBe(SCHEDULE_MAX_TIMER_MS);
    await clock.advance(HOUR);
    expect(host.sent).toHaveLength(1);
    await clock.advance(0);
    expect(host.sent).toHaveLength(1);
  });

  it('每次新开会话：在项目里用建立时的 Agent 设置新开一条，标题是名称', async () => {
    await daily({ target: 'new', name: 'Nightly glossary' });
    await clock.advance(HOUR);
    expect(host.created).toEqual([
      {
        projectId: 'p1',
        title: 'Nightly glossary',
        agent: { driverId: 'claude', model: 'sonnet', effort: null, accessMode: 'fullAccess' },
        commandId: expect.any(String),
      },
    ]);
    expect(host.sent[0]!.conversationId).toBe('new1');
    expect(only().runs[0]).toMatchObject({ status: 'running', conversationId: 'new1' });
  });
});

describe('跑满、暂停与继续', () => {
  it('跑满就标完成；改大次数之前不能继续', async () => {
    await daily({ cadence: { type: 'hourly', minute: 0 }, maxRuns: 1 });
    await clock.advance(HOUR);
    finish('t1', 'completed');
    expect(only()).toMatchObject({ status: 'completed', nextAt: null, runCount: 1 });
    await clock.advance(HOUR);
    expect(host.sent).toHaveLength(1);
    await expect(service.update({ scheduleId: only().id, paused: false })).rejects.toMatchObject({ code: 'invalid-request' });
    await service.update({ scheduleId: only().id, maxRuns: 3 });
    expect(only().status).toBe('completed');
    const { schedule } = await service.update({ scheduleId: only().id, paused: false });
    expect(schedule).toMatchObject({ status: 'active', nextAt: '2026-10-30T11:00:00.000Z' });
  });

  it('目标会话归档时自动暂停，排队的那一轮去掉；恢复会话后能继续；删除后写明删除', async () => {
    await daily({ cadence: { type: 'hourly', minute: 0 } });
    host.setActivity('c1', 'running');
    await clock.advance(HOUR);
    expect(only().runs.map((r) => r.status)).toEqual(['queued']);
    host.conversations.set('c1', { ...host.conversations.get('c1')!, archived: true });
    service.conversationChanged(host.conversations.get('c1')!);
    expect(only()).toMatchObject({ status: 'paused', pauseReason: 'conversation-archived', nextAt: null, runs: [] });
    await expect(service.update({ scheduleId: only().id, paused: false })).rejects.toMatchObject({ code: 'invalid-request' });
    host.conversations.set('c1', { ...host.conversations.get('c1')!, archived: false, activity: 'idle', activeTaskId: null });
    service.conversationChanged(host.conversations.get('c1')!);
    expect(only().status).toBe('paused');
    await service.update({ scheduleId: only().id, paused: false });
    expect(only()).toMatchObject({ status: 'active', pauseReason: null });
    host.conversations.delete('c1');
    service.conversationRemoved('c1');
    expect(only()).toMatchObject({ status: 'paused', pauseReason: 'conversation-deleted' });
  });

  it('项目移除时每次新开的定时任务暂停；立即运行只给启用的', async () => {
    await daily({ target: 'new' });
    host.projects.delete('p1');
    service.projectRemoved('p1');
    expect(only()).toMatchObject({ status: 'paused', pauseReason: 'project-removed' });
    await expect(service.run({ scheduleId: only().id, commandId: 'r1' })).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('立即运行：同到点的规则，不改下一次；同一个 commandId 只运行一次；在跑时再点是跳过', async () => {
    await daily();
    const first = await service.run({ scheduleId: only().id, commandId: 'r1' });
    expect(first.outcome).toBe('run');
    expect((await service.run({ scheduleId: only().id, commandId: 'r1' })).outcome).toBe('run');
    expect(host.sent).toHaveLength(1);
    expect((await service.run({ scheduleId: only().id, commandId: 'r2' })).outcome).toBe('skip');
    expect(only()).toMatchObject({
      nextAt: '2026-10-30T09:00:00.000Z',
      runs: [
        { status: 'skipped', manual: true },
        { status: 'running', manual: true },
      ],
    });
  });

  it('建好后立即运行一次；删除只删定时任务本身', async () => {
    const { schedule, outcome } = await daily({ runNow: true });
    expect(outcome).toBe('run');
    expect(host.sent).toHaveLength(1);
    await service.remove({ scheduleId: schedule.id });
    expect(service.list()).toEqual([]);
    expect(host.events.at(-1)).toEqual({ type: 'schedule.removed', scheduleId: schedule.id });
    expect(host.conversations.has('c1')).toBe(true);
    await expect(service.remove({ scheduleId: schedule.id })).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('启动', () => {
  const stored = (patch: Partial<Schedule>): Schedule => ({
    id: 's1',
    name: 'Glossary',
    prompt: 'Check the glossary',
    cadence: { type: 'hourly', minute: 0 },
    conversationId: 'c1',
    target: 'conversation',
    projectId: 'p1',
    agent: { driverId: 'claude', model: null, effort: null, accessMode: null },
    maxRuns: null,
    runCount: 0,
    status: 'active',
    pauseReason: null,
    nextAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    runs: [],
    ...patch,
  });

  it('最近一次到点在五分钟内：照常发一次，更早的记一条错过；从现在起算下一次', async () => {
    clock.t = Date.parse('2026-10-30T08:03:00.000Z');
    await boot([stored({ nextAt: '2026-10-30T05:00:00.000Z' })]);
    await settle();
    expect(host.sent).toHaveLength(1);
    expect(only()).toMatchObject({
      nextAt: '2026-10-30T09:00:00.000Z',
      runs: [{ status: 'running' }, { status: 'missed', count: 3, at: '2026-10-30T05:00:00.000Z' }],
    });
  });

  it('都超过五分钟：不补跑，只记错过', async () => {
    clock.t = Date.parse('2026-10-30T08:30:00.000Z');
    await boot([stored({ nextAt: '2026-10-29T08:00:00.000Z' })]);
    await settle();
    expect(host.sent).toEqual([]);
    expect(only()).toMatchObject({ nextAt: '2026-10-30T09:00:00.000Z', runs: [{ status: 'missed', count: 25 }] });
  });

  it('上次没收完的运行：任务已结束的按任务收尾，没拿到任务的记失败；目标会话不在的暂停', async () => {
    host.tasks.set('old', {
      taskId: 'old',
      conversationId: 'c1',
      conversationTitle: 'Promo',
      projectId: 'p1',
      goal: 'Check the glossary',
      status: 'completed',
      startedAt: '2026-10-30T06:00:00.000Z',
      endedAt: '2026-10-30T06:05:00.000Z',
      error: null,
    });
    await boot([
      stored({
        nextAt: '2026-10-30T09:00:00.000Z',
        runs: [
          {
            id: 'r2',
            status: 'running',
            at: '2026-10-30T07:00:00.000Z',
            startedAt: null,
            endedAt: null,
            conversationId: 'c1',
            taskId: null,
            error: null,
          },
          {
            id: 'r1',
            status: 'running',
            at: '2026-10-30T06:00:00.000Z',
            startedAt: null,
            endedAt: null,
            conversationId: 'c1',
            taskId: 'old',
            error: null,
          },
        ],
      }),
      stored({ id: 's2', conversationId: 'gone', nextAt: '2026-10-30T09:00:00.000Z' }),
    ]);
    const [first, second] = service.list();
    expect(first!.runs.map((r) => r.status)).toEqual(['failed', 'done']);
    expect(first!.runCount).toBe(2);
    expect(second).toMatchObject({ status: 'paused', pauseReason: 'conversation-deleted' });
  });
});

describe('频道任务（work-item）', () => {
  const template: WorkItemTemplate = { title: 'Weekly recap', description: '', owner: 'agent', prompt: 'Summarise the week.', resources: [] };
  let bot: FakeBot;
  beforeEach(() => {
    bot = new FakeBot();
    host.bot = bot;
    host.conversations.set('chanconv', conversation({ id: 'chanconv', projectId: null }));
  });

  const hourly = (overrides: Partial<Parameters<ScheduleService['create']>[0]> = {}) =>
    daily({
      conversationId: 'chanconv',
      target: 'work-item',
      cadence: { type: 'hourly', minute: 0 },
      workItem: { channelId: 'chan1', template },
      ...overrides,
    });

  it('没有频道、频道不在或没有 Bot 都拒绝建立', async () => {
    await expect(hourly({ workItem: undefined } as never)).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(hourly({ workItem: { channelId: 'nope', template } })).rejects.toMatchObject({ code: 'invalid-request' });
    delete host.bot;
    await expect(hourly()).rejects.toMatchObject({ code: 'invalid-request' });
    expect(service.list()).toEqual([]);
  });

  it('到点在频道里按模板建任务，这一次记下任务；不发消息', async () => {
    const { schedule } = await hourly();
    expect(schedule).toMatchObject({ target: 'work-item', workItem: { channelId: 'chan1', template } });
    await clock.advance(HOUR);
    expect(host.sent).toEqual([]);
    expect(bot.created).toEqual([{ channelId: 'chan1', template, scheduleId: schedule.id, runId: only().runs[0]!.id }]);
    expect(only().runs[0]).toMatchObject({ status: 'running', workItemId: 'wi1' });
  });

  it('任务到了停点这一次算完成；卡住算失败；还在做或在等别人时不收', async () => {
    await hourly();
    await clock.advance(HOUR);
    bot.items.set('wi1', { status: 'active', activeState: 'waitingOnOthers' });
    service.workItemChanged('wi1');
    expect(only().runs[0]!.status).toBe('running');
    bot.items.set('wi1', { status: 'active', activeState: 'needsReview' });
    service.workItemChanged('wi1');
    expect(only()).toMatchObject({ runCount: 1, runs: [{ status: 'done' }] });
    // 上一条还没解决（待你审阅也算）：下一次跳过，不堆积。
    await clock.advance(HOUR);
    expect(bot.created).toHaveLength(1);
    expect(only().runs.map((r) => r.status)).toEqual(['skipped', 'done']);
    bot.items.set('wi1', { status: 'resolved', activeState: null });
    await clock.advance(HOUR);
    expect(bot.created).toHaveLength(2);
    bot.items.set('wi2', { status: 'active', activeState: 'blocked' });
    service.workItemChanged('wi2');
    expect(only().runs[0]).toMatchObject({ status: 'failed', workItemId: 'wi2' });
    // 别的任务变了不影响。
    service.workItemChanged('other');
    expect(only().runs[0]!.status).toBe('failed');
  });

  it('建出来的任务马上就停下（例如用户自己的任务）时当场收尾；任务不见了算失败', async () => {
    bot.createWorkItem = async (channelId, tmpl, scheduleId, runId) => {
      bot.created.push({ channelId, template: tmpl, scheduleId, runId });
      bot.items.set('wiX', { status: 'active', activeState: 'needsInput' });
      return { workItemId: 'wiX' };
    };
    await hourly();
    await clock.advance(HOUR);
    expect(only().runs[0]).toMatchObject({ status: 'done', workItemId: 'wiX' });
    bot.items.set('wiX', { status: 'resolved', activeState: null });
    bot.createWorkItem = async () => ({ workItemId: 'ghost' });
    await clock.advance(HOUR);
    expect(only().runs[0]).toMatchObject({ status: 'failed', workItemId: 'ghost' });
  });

  it('重启时按任务现在的状态收尾这一次：还在等别人就接着等，不按失败记，也不多算一次', async () => {
    await hourly({ maxRuns: 1 });
    await clock.advance(HOUR);
    bot.items.set('wi1', { status: 'active', activeState: 'waitingOnOthers' });
    service.workItemChanged('wi1');
    const saved = service.list();
    service.stop();
    await boot(saved);
    expect(only()).toMatchObject({ status: 'active', runCount: 0, runs: [{ status: 'running', workItemId: 'wi1' }] });
    bot.items.set('wi1', { status: 'active', activeState: 'needsReview' });
    service.workItemChanged('wi1');
    expect(only()).toMatchObject({ runCount: 1, runs: [{ status: 'done' }] });
    // 关掉时任务已经停下：重启当场收尾；任务不见了才算失败。
    await hourly();
    await clock.advance(HOUR);
    const second = service.list().find((x) => x.maxRuns === null)!;
    const lastId = second.runs[0]!.workItemId!;
    bot.items.set(lastId, { status: 'active', activeState: 'needsInput' });
    const before = service.list();
    service.stop();
    await boot(before);
    expect(service.list().find((x) => x.maxRuns === null)!.runs[0]).toMatchObject({ status: 'done', workItemId: lastId });
  });

  it('自动化暂停时到点记跳过：不建任务，不占运行次数；恢复后照常', async () => {
    await hourly({ maxRuns: 1 });
    bot.paused = true;
    await clock.advance(HOUR);
    expect(bot.created).toEqual([]);
    expect(only()).toMatchObject({ status: 'active', runCount: 0, runs: [{ status: 'skipped' }] });
    bot.paused = false;
    await clock.advance(HOUR);
    expect(bot.created).toHaveLength(1);
    expect(only().runs[0]).toMatchObject({ status: 'running', workItemId: 'wi1' });
  });

  it('上一条任务一直没解决：跳过的次数再多，也不会挤掉它而再建一条', async () => {
    await hourly();
    await clock.advance(HOUR);
    bot.items.set('wi1', { status: 'active', activeState: 'needsReview' });
    service.workItemChanged('wi1');
    await clock.advance(60 * HOUR);
    expect(bot.created).toHaveLength(1);
    const runs = only().runs;
    expect(runs.length).toBeLessThanOrEqual(50);
    expect(runs.at(-1)).toMatchObject({ workItemId: 'wi1' });
    expect(runs.slice(0, -1).every((r) => r.status === 'skipped')).toBe(true);
    bot.items.set('wi1', { status: 'resolved', activeState: null });
    await clock.advance(HOUR);
    expect(bot.created).toHaveLength(2);
  });

  it('频道归档时暂停（channel-archived），删除时写明删除；恢复后要用户自己继续', async () => {
    await hourly();
    bot.channels.set('chan1', { archived: true });
    service.channelChanged('chan1');
    expect(only()).toMatchObject({ status: 'paused', pauseReason: 'channel-archived', nextAt: null });
    await expect(service.update({ scheduleId: only().id, paused: false })).rejects.toMatchObject({ code: 'invalid-request' });
    bot.channels.set('chan1', { archived: false });
    service.channelChanged('chan1');
    expect(only().status).toBe('paused');
    await service.update({ scheduleId: only().id, paused: false });
    expect(only()).toMatchObject({ status: 'active', pauseReason: null });
    bot.channels.delete('chan1');
    service.channelChanged('chan1');
    expect(only()).toMatchObject({ status: 'paused', pauseReason: 'conversation-deleted' });
    await clock.advance(HOUR);
    expect(bot.created).toEqual([]);
  });

  it('forChannel 只列这个频道的频道任务；别的频道变化不碰它', async () => {
    bot.channels.set('chan2', { archived: false });
    const { schedule: a } = await hourly();
    const { schedule: b } = await hourly({ workItem: { channelId: 'chan2', template } });
    await daily();
    expect(service.forChannel('chan1').map((s) => s.id)).toEqual([a.id]);
    expect(service.forChannel('chan2').map((s) => s.id)).toEqual([b.id]);
    bot.channels.set('chan2', { archived: true });
    service.channelChanged('chan2');
    expect(service.list().find((s) => s.id === a.id)!.status).toBe('active');
    expect(service.list().find((s) => s.id === b.id)!.status).toBe('paused');
  });
});
