import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, RpcError, type Id, type RelayBody, type TimelineItem } from '@baocut/protocol';
import { ConversationStore, ProjectStore, resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import { BOT_INTERNAL, Harness, type Delivery, type RunEvent } from './harness.ts';
import { silentLogger } from './logger.ts';
import { ScriptedDriver, testToolAccess } from './testing.ts';

/** Bot 的通用投递（技术方案 §8.1）、角色锁（§4.2）与无人在场（§14.2）。 */

let dir: string;
let home: RuntimeHome;
let driver: ScriptedDriver;
let harness: Harness;
let runs: RunEvent[];

async function open(options: { steer?: boolean; approvals?: boolean } = {}): Promise<void> {
  driver = new ScriptedDriver(options);
  const drivers = new DriverRegistry();
  drivers.register(driver);
  harness = await Harness.open({
    home,
    conversations: new ConversationStore(home.conversationsDir),
    projects: new ProjectStore(home.projectsFile),
    drivers,
    log: silentLogger,
    tools: testToolAccess(),
  });
  runs = [];
  harness.onRun((event) => runs.push(event));
}

async function until<T>(read: () => T | undefined | null | false, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timeout');
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
}

const items = (id: Id) => harness.getConversation(id).items;
const tasks = (id: Id) => items(id).filter((i): i is Extract<TimelineItem, { kind: 'task' }> => i.kind === 'task');
const relay = (text: string): RelayBody => ({
  direction: 'report',
  workItemId: null,
  reportId: null,
  from: { role: 'thread', conversationId: null },
  text,
  cited: [],
});
const delivery = (conversationId: Id, over: Partial<Delivery> = {}): Delivery => ({
  id: newId('dlv'),
  conversationId,
  item: relay('report body'),
  agentText: '<baocut-thread-report>done</baocut-thread-report>',
  wake: 'new-task',
  origin: 'relay',
  unattended: true,
  ...over,
});

async function channel(): Promise<Id> {
  const conversation = await harness.createConversation({ title: 'Main', accessMode: 'fullAccess' }, undefined, {
    role: 'channel',
    channelId: 'chan_main',
    cwd: path.join(dir, 'channel-files'),
  });
  return conversation.id;
}

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-deliver-')));
  home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  await open();
});

afterEach(async () => {
  await harness.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Harness.deliver', () => {
  it('starts a new task with origin and no user message when the conversation is idle', async () => {
    const id = await channel();
    const conv = harness.getConversation(id).conversation;
    expect(conv.role).toBe('channel');
    expect(conv.cwd).toBe(path.join(dir, 'channel-files'));
    expect(conv.projectId).toBeNull();
    const d = delivery(id);
    const outcome = await harness.deliver(d);
    expect(outcome.result).toBe('started');
    await until(() => tasks(id)[0]?.status === 'completed');
    const task = tasks(id)[0]!;
    expect(task.origin).toBe('relay');
    expect(items(id).some((i) => i.kind === 'user-message')).toBe(false);
    expect(items(id).find((i) => i.id === d.id)?.kind).toBe('relay');
    // 无人在场：完全放开降到 auto。
    expect(driver.sessions[0]!.turns[0]).toContain('<baocut-thread-report>');
    expect(runs.find((r) => r.type === 'started')).toMatchObject({ attended: false, origin: 'relay' });
    expect(task.autonomy?.mode).toBe('auto');
    // 同一个 id 再投只返回上次的结果，不再起回合。
    expect((await harness.deliver(d)).result).toBe('started');
    expect(tasks(id)).toHaveLength(1);
  });

  it('steers into a running turn and marks it tainted', async () => {
    const id = await channel();
    driver.script = (turn) => turn.hold();
    await harness.send({ conversationId: id, text: 'hello', commandId: newId('cmd') });
    await until(() => driver.sessionOf(id)?.turnId);
    expect(harness.runInfo(id)).toMatchObject({ attended: true, tainted: false, origin: 'user' });
    const outcome = await harness.deliver(delivery(id, { userCitations: ['msg_1'] }));
    expect(outcome.result).toBe('steered');
    expect(harness.runInfo(id)?.tainted).toBe(true);
    expect([...harness.runInfo(id)!.userCitations]).toEqual(['msg_1']);
    driver.lastTurn!.complete();
    await until(() => tasks(id)[0]?.status === 'completed');
  });

  it('holds while a turn cannot be steered and merges held deliveries into one turn afterwards', async () => {
    await harness.shutdown();
    await open({ steer: false });
    const id = await channel();
    driver.script = (turn) => turn.hold();
    await harness.send({ conversationId: id, text: 'hello', commandId: newId('cmd') });
    await until(() => driver.sessionOf(id)?.turnId);
    let delivered = 0;
    const a = await harness.deliver(delivery(id, { agentText: 'A', onDelivered: () => delivered++ }));
    const b = await harness.deliver(delivery(id, { agentText: 'B', onDelivered: () => delivered++ }));
    expect([a.result, b.result]).toEqual(['held', 'held']);
    expect(delivered).toBe(0);
    driver.script = () => {};
    driver.lastTurn!.complete();
    await until(() => tasks(id).length === 2 && tasks(id)[1]!.status === 'completed');
    expect(delivered).toBe(2);
    const turns = driver.sessionOf(id)!.turns;
    expect(turns).toHaveLength(2);
    expect(turns[1]).toContain('A');
    expect(turns[1]).toContain('B');
  });

  it('stopping the turn drops what was held for it instead of starting another turn afterwards', async () => {
    await harness.shutdown();
    await open({ steer: false });
    const id = await channel();
    driver.script = (turn) => turn.hold();
    await harness.send({ conversationId: id, text: 'hello', commandId: newId('cmd') });
    await until(() => driver.sessionOf(id)?.turnId);
    let delivered = 0;
    const d = delivery(id, { agentText: 'A', onDelivered: () => delivered++ });
    expect((await harness.deliver(d)).result).toBe('held');
    await harness.stopTask(tasks(id)[0]!.id);
    await until(() => !harness.runInfo(id) && tasks(id)[0]!.status !== 'running' && tasks(id)[0]!.status !== 'stopping');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(tasks(id)).toHaveLength(1);
    expect(delivered).toBe(0);
    expect(driver.sessionOf(id)!.turns).toHaveLength(1);
  });

  it('a held delivery works out its access mode when the turn actually starts', async () => {
    await harness.shutdown();
    await open({ steer: false });
    const id = await channel();
    driver.script = (turn) => turn.hold();
    await harness.send({ conversationId: id, text: 'hello', commandId: newId('cmd') });
    await until(() => driver.sessionOf(id)?.turnId);
    let ceiling: 'auto' | 'plan' = 'auto';
    expect((await harness.deliver(delivery(id, { unattended: false, accessMode: 'auto', accessModeAt: () => ceiling }))).result).toBe('held');
    ceiling = 'plan';
    driver.script = () => {};
    driver.lastTurn!.complete();
    await until(() => tasks(id).length === 2 && tasks(id)[1]!.status === 'completed');
    expect(tasks(id)[1]!.autonomy?.mode).toBe('plan');
  });

  it('drops unattended deliveries when the driver has no per-step approvals', async () => {
    await harness.shutdown();
    await open({ approvals: false });
    const id = await channel();
    const outcome = await harness.deliver(delivery(id));
    expect(outcome).toMatchObject({ result: 'dropped', reason: 'unattended-needs-approvals' });
    expect(tasks(id)).toHaveLength(0);
    // 有人在场的（用户点了「继续」）照常起。
    expect((await harness.deliver(delivery(id, { unattended: false }))).result).toBe('started');
  });

  it('I6 drops unattended deliveries and job wakes when it is unknown whether the driver asks per step', async () => {
    await harness.shutdown();
    // 探测失败、Driver 也没有 describe()：不知道它支不支持逐次审批。
    driver = new ScriptedDriver();
    driver.probe = () => Promise.reject(new Error('probe failed'));
    const drivers = new DriverRegistry();
    drivers.register(driver);
    harness = await Harness.open({
      home,
      conversations: new ConversationStore(home.conversationsDir),
      projects: new ProjectStore(home.projectsFile),
      drivers,
      log: silentLogger,
      tools: testToolAccess(),
    });
    runs = [];
    harness.onRun((event) => runs.push(event));
    const id = await channel();
    expect(await harness.deliver(delivery(id))).toMatchObject({ result: 'dropped', reason: 'unattended-needs-approvals' });
    expect(tasks(id)).toHaveLength(0);
    // 用户在场时照常起；之后后台任务结束的叫醒无人在场，也不起。
    expect((await harness.deliver(delivery(id, { unattended: false }))).result).toBe('started');
    await until(() => driver.lastTurn);
    driver.lastTurn!.complete();
    await until(() => tasks(id)[0]?.status === 'completed');
    await harness.jobFinished({ conversationId: id, taskId: tasks(id)[0]!.id, jobId: 'job_1', kind: 'music', attempt: 1, state: 'completed' });
    expect(runs.at(-1)).toMatchObject({ type: 'finished', attended: false, error: 'unattended-needs-approvals' });
    expect(tasks(id)[0]!.status).toBe('completed');
  });

  it('drops deliveries to archived or missing conversations', async () => {
    expect((await harness.deliver(delivery('conv_missing'))).reason).toBe('not-found');
    const id = await channel();
    await harness.updateConversation({ conversationId: id, archived: true }, { internal: BOT_INTERNAL });
    expect((await harness.deliver(delivery(id))).reason).toBe('archived');
  });

  it('reopens a task for reopen-task deliveries', async () => {
    const id = await channel();
    const { taskId } = await harness.send({ conversationId: id, text: 'hi', commandId: newId('cmd') });
    await until(() => tasks(id)[0]?.status === 'completed');
    const outcome = await harness.deliver(delivery(id, { wake: 'reopen-task', reopenTaskId: taskId }));
    expect(outcome).toMatchObject({ result: 'woke', taskId });
    await until(() => driver.sessionOf(id)!.turns.length === 2 && tasks(id)[0]!.status === 'completed');
    expect(tasks(id)).toHaveLength(1);
  });

  it('prepends the turn context for bot-role conversations only', async () => {
    harness.setTurnContext((conversation, kind) => `<baocut-channel-state kind="${kind}">${conversation.id}</baocut-channel-state>`);
    const id = await channel();
    await harness.send({ conversationId: id, text: 'hello', commandId: newId('cmd'), via: 'suggestion', suggestionChipId: 'chip_1' });
    await until(() => tasks(id)[0]?.status === 'completed');
    expect(driver.sessionOf(id)!.turns[0]).toMatch(/^<baocut-channel-state kind="user">/);
    const message = items(id).find((i) => i.kind === 'user-message');
    expect(message).toMatchObject({ via: 'suggestion', suggestionChipId: 'chip_1' });
    const chat = await harness.createConversation({ title: 'plain' });
    await harness.send({ conversationId: chat.id, text: 'hello', commandId: newId('cmd') });
    await until(() => tasks(chat.id)[0]?.status === 'completed');
    expect(driver.sessionOf(chat.id)!.turns[0]).not.toContain('baocut-channel-state');
  });
});

describe('role lock', () => {
  it('rejects fork, delete, archive, driver and mode changes on channel and thread conversations', async () => {
    const id = await channel();
    const locked = async (p: Promise<unknown>) => {
      const error = await p.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(RpcError);
      expect((error as RpcError).details).toMatchObject({ code: 'BOT_ROLE_LOCKED' });
    };
    await locked(harness.deleteConversation(id));
    await locked(harness.updateConversation({ conversationId: id, archived: true }));
    await locked(harness.updateConversation({ conversationId: id, accessMode: 'ask' }));
    await locked(harness.ensureConversationProject(id));
    const { taskId } = await harness.send({ conversationId: id, text: 'hi', commandId: newId('cmd') });
    await until(() => tasks(id)[0]?.status === 'completed');
    await locked(harness.forkConversation({ conversationId: id, taskId, commandId: newId('cmd') }));
    // 改标题照常可以。
    expect((await harness.updateConversation({ conversationId: id, title: 'Renamed' })).title).toBe('Renamed');
    // Bot 自己的调用绕过。
    await harness.deleteConversation(id, { internal: BOT_INTERNAL });
    expect(harness.conversationOf(id)).toBeUndefined();
  });

  it('job wake-ups in bot conversations are unattended', async () => {
    const id = await channel();
    const { taskId } = await harness.send({ conversationId: id, text: 'hi', commandId: newId('cmd') });
    await until(() => tasks(id)[0]?.status === 'completed');
    runs = [];
    const delivery = await harness.jobFinished({ conversationId: id, taskId, jobId: 'job_1', kind: 'music', attempt: 1, state: 'completed' });
    expect(delivery).toBe('woke');
    expect(runs.find((r) => r.type === 'started')).toMatchObject({ attended: false });
    await until(() => tasks(id)[0]?.status === 'completed');
  });
});
