import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentMode } from '@baocut/protocol';
import { silentLogger, type AgentEvent, type AgentSession, type CreateSessionOptions } from '@baocut/harness';
import { createFakeOpenCode, type FakeOpenCode, type FakeOpenCodeScenario } from '../testing/fake-opencode.ts';
import { OpenCodeDriver } from './opencode-driver.ts';

/**
 * OpenCode 会话对着假 serve：一轮的消息与推理、工具步骤（文件修改带 diff）、审批（允许、拒绝、本会话放行）、
 * 访问模式与模型、中断、进程意外退出、恢复、MCP 与开发者指令。假 serve 在启动时读场景，改场景之后要新开会话。
 */

async function until<T>(read: () => T | undefined | null | false, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

type Completed = Extract<AgentEvent, { type: 'turn.completed' }>;
type Approval = Extract<AgentEvent, { type: 'approval.requested' }>;
type ItemEvent = Extract<AgentEvent, { type: 'item.completed' }>;

const PATCH = 'Index: notes.txt\n===\n--- notes.txt\n+++ notes.txt\n@@ -1,1 +1,1 @@\n-beta\n+BETA\n';
const EDIT_TOOL = {
  name: 'edit',
  input: { path: '', oldString: 'beta', newString: 'BETA' },
  permission: { action: 'edit', resources: ['notes.txt'], metadata: { files: [{ file: 'notes.txt', patch: PATCH, status: 'modified' }] } },
  output: 'Edited notes.txt (1 replacement)',
  metadata: { files: [{ file: 'notes.txt', patch: PATCH, status: 'modified' }] },
};

describe('OpenCodeSession（假 opencode serve）', () => {
  let dir: string;
  let cwd: string;
  let fake: FakeOpenCode;
  let driver: OpenCodeDriver;
  const open: AgentSession[] = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-opencode-session-'));
    cwd = path.join(dir, 'project');
    await fs.mkdir(cwd);
    fake = await createFakeOpenCode(path.join(dir, 'fake'));
    driver = new OpenCodeDriver(silentLogger, { locate: fake.locate, timeoutMs: 10_000 });
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((s) => s.close()));
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function start(scenario: Partial<FakeOpenCodeScenario> = {}, extra: Partial<CreateSessionOptions> = {}) {
    fake.scenario(scenario);
    const session = await driver.createSession({ cwd, accessMode: 'ask', model: null, effort: null, resume: null, ...extra });
    open.push(session);
    const events: AgentEvent[] = [];
    session.subscribe((event) => events.push(event));
    const completed = (turnId: string) =>
      until(() => events.find((e): e is Completed => e.type === 'turn.completed' && e.turnId === turnId));
    const approval = (n = 1) => until(() => events.filter((e): e is Approval => e.type === 'approval.requested')[n - 1]);
    return { session, events, completed, approval };
  }

  const settings = (accessMode: AgentMode = 'ask', model: string | null = null, effort: string | null = null) => ({
    accessMode,
    model,
    effort,
  });

  it('一轮：推理与回复按增量到达，执行成功后回合完成', async () => {
    const { session, events, completed } = await start({ turn: { reasoning: 'thinking', reply: 'hello there', end: 'succeeded' } });
    const { turnId } = await session.startTurn({ text: 'hi' }, settings());
    const done = await completed(turnId);
    expect(done.outcome).toBe('completed');
    const deltas = events.filter((e) => e.type === 'item.delta' && e.channel === 'text').map((e) => (e as { delta: string }).delta);
    expect(deltas.join('')).toBe('hello there');
    const items = events.filter((e): e is ItemEvent => e.type === 'item.completed').map((e) => e.item);
    expect(items).toEqual([
      expect.objectContaining({ kind: 'reasoning', text: 'thinking' }),
      expect.objectContaining({ kind: 'agent-message', text: 'hello there' }),
    ]);
    // 会话建在工作目录上，用 build 智能体，访问模式写成权限规则。
    const create = fake.requests('POST', '/api/session')[0]!.body!;
    expect(create.location).toEqual({ directory: cwd });
    expect(create.agent).toBe('build');
    expect(create.permissions).toContainEqual({ action: 'shell', resource: '*', effect: 'ask' });
    expect(fake.requests('POST', '/api/session/:id/prompt')[0]!.body).toEqual({ text: 'hi' });
    expect(session.describePersistence()).toEqual({ driverId: 'opencode', data: { sessionId: expect.stringMatching(/^ses_/) } });
  });

  it('执行失败：回合 failed，带 OpenCode 的错误', async () => {
    const { session, completed } = await start({ turn: { end: 'failed', error: 'rate limited' } });
    const { turnId } = await session.startTurn({ text: 'hi' }, settings());
    const done = await completed(turnId);
    expect(done.outcome).toBe('failed');
    expect(done.error).toBe('rate limited');
  });

  it('文件修改要审批：允许之后完成，步骤的输出是统一 diff', async () => {
    const { session, events, completed, approval } = await start({
      turn: { tool: { ...EDIT_TOOL, input: { ...EDIT_TOOL.input, path: path.join(cwd, 'notes.txt') } }, reply: 'ok' },
    });
    const { turnId } = await session.startTurn({ text: 'edit' }, settings());
    const asked = await approval();
    expect(asked.request).toEqual({ kind: 'file-change', reason: null, files: ['notes.txt'], rule: null });
    expect(asked.escalation).toBeUndefined();
    await session.respondToApproval(asked.approvalId, { decision: 'accept' });
    expect((await completed(turnId)).outcome).toBe('completed');
    const replies = fake.log().filter((e) => e.kind === 'request' && e.path?.endsWith('/reply'));
    expect(replies.map((e) => e.body)).toEqual([{ decision: 'once' }]);
    const tool = events.filter((e): e is ItemEvent => e.type === 'item.completed').find((e) => e.item.kind === 'tool-call')!.item;
    expect(tool).toMatchObject({ kind: 'tool-call', tool: 'file-change', title: 'notes.txt', status: 'completed', output: PATCH });
  });

  it('拒绝：那一步 declined，OpenCode 以 interrupted(shutdown) 结束执行，回合记成完成并提示', async () => {
    const { session, events, completed, approval } = await start({
      turn: { tool: { name: 'shell', input: { command: 'rm -rf build' }, permission: { action: 'shell', resources: ['rm -rf build'] } } },
    });
    const { turnId } = await session.startTurn({ text: 'clean' }, settings());
    const asked = await approval();
    expect(asked.request).toMatchObject({ kind: 'command', command: 'rm -rf build', cwd, rule: 'rm' });
    await session.respondToApproval(asked.approvalId, { decision: 'decline' });
    const done = await completed(turnId);
    expect(done.outcome).toBe('completed');
    const tool = events.filter((e): e is ItemEvent => e.type === 'item.completed').find((e) => e.item.kind === 'tool-call')!.item;
    expect(tool).toMatchObject({ status: 'declined', title: 'rm -rf build' });
    expect(events.some((e) => e.type === 'session.warning' && e.message.includes('工具被拒绝'))).toBe(true);
    const replies = fake.log().filter((e) => e.kind === 'request' && e.path?.endsWith('/reply'));
    expect(replies.map((e) => e.body)).toEqual([{ decision: 'reject' }]);
  });

  it('本会话放行：之后同类的请求直接答应，从不回原生的 always', async () => {
    const shell = { name: 'shell', input: { command: 'npm test' }, permission: { action: 'shell', resources: ['npm test'] } };
    const { session, events, completed, approval } = await start({ turn: { tool: shell, reply: 'ok' } });
    const first = await session.startTurn({ text: 'test' }, settings());
    await session.respondToApproval((await approval()).approvalId, { decision: 'accept-for-session' });
    await completed(first.turnId);
    const second = await session.startTurn({ text: 'again' }, settings());
    expect((await completed(second.turnId)).outcome).toBe('completed');
    expect(events.filter((e) => e.type === 'approval.requested')).toHaveLength(1);
    const replies = fake.log().filter((e) => e.kind === 'request' && e.path?.endsWith('/reply'));
    expect(replies.map((e) => e.body)).toEqual([{ decision: 'once' }, { decision: 'once' }]);
  });

  it('中断：挂着的审批收起并拒绝，回合 interrupted', async () => {
    const { session, events, completed, approval } = await start({
      turn: { tool: { name: 'shell', input: { command: 'sleep 100' }, permission: { action: 'shell', resources: ['sleep 100'] } } },
    });
    const { turnId } = await session.startTurn({ text: 'wait' }, settings());
    const asked = await approval();
    expect(await session.interrupt(turnId)).toEqual({ status: 'requested' });
    expect((await completed(turnId)).outcome).toBe('interrupted');
    expect(events).toContainEqual({ type: 'approval.resolved', approvalId: asked.approvalId });
    expect(await session.interrupt(turnId)).toEqual({ status: 'not-running' });
  });

  it('中断一直跑着的回合', async () => {
    const { session, completed } = await start({ turn: { reply: 'partial', end: 'hang' } });
    const { turnId } = await session.startTurn({ text: 'go' }, settings());
    await until(() => fake.requests('POST', '/api/session/:id/prompt').length > 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await session.interrupt(turnId)).toEqual({ status: 'requested' });
    expect((await completed(turnId)).outcome).toBe('interrupted');
    expect(fake.requests('POST', '/api/session/:id/interrupt')).toHaveLength(1);
  });

  it('serve 意外退出：session.exited 带原因，不再报回合结果', async () => {
    const { session, events } = await start({ turn: { crash: true } });
    await session.startTurn({ text: 'boom' }, settings());
    const exited = await until(() => events.find((e) => e.type === 'session.exited'));
    expect(exited).toMatchObject({ type: 'session.exited', error: expect.stringContaining('3') });
    expect(events.some((e) => e.type === 'turn.completed')).toBe(false);
  });

  it('访问模式变了：下一轮之前改会话的权限规则；模型与强度用 provider/model 与 variant', async () => {
    const { session, completed } = await start();
    const first = await session.startTurn({ text: 'a' }, settings('ask'));
    await completed(first.turnId);
    expect(fake.requests('PATCH', '/api/session/:id')).toHaveLength(0);
    const second = await session.startTurn({ text: 'b' }, settings('plan', 'opencode/fledge-alpha-free', 'high'));
    await completed(second.turnId);
    const patch = fake.requests('PATCH', '/api/session/:id');
    expect(patch).toHaveLength(1);
    expect(patch[0]!.body!.permissions).toContainEqual({ action: 'edit', resource: '*', effect: 'deny' });
    expect(fake.requests('POST', '/api/session/:id/model')[0]!.body).toEqual({
      model: { providerID: 'opencode', id: 'fledge-alpha-free', variant: 'high' },
    });
  });

  it('模型写法不对：开不了这一轮', async () => {
    const { session } = await start();
    await expect(session.startTurn({ text: 'a' }, settings('ask', 'no-slash'))).rejects.toMatchObject({
      agentCode: 'AGENT_MODEL_UNAVAILABLE',
    });
  });

  it('插话：进行中的回合用 delivery steer', async () => {
    const { session, completed } = await start({ turn: { end: 'hang' } });
    const { turnId } = await session.startTurn({ text: 'go' }, settings());
    expect(await session.steer!(turnId, { text: 'also this' })).toBe('accepted');
    expect(fake.requests('POST', '/api/session/:id/prompt')[1]!.body).toEqual({ text: 'also this', delivery: 'steer' });
    expect(await session.steer!('turn_other', { text: 'x' })).toBe('unavailable');
    await session.interrupt(turnId);
    await completed(turnId);
  });

  it('恢复：按 id 接回原生会话（换了 serve 进程也行），恢复不了时新建并提示', async () => {
    const first = await start();
    const handle = first.session.describePersistence();
    await first.session.close();
    const resumed = await start({}, { resume: handle });
    expect(resumed.session.describePersistence()).toEqual(handle);
    expect(fake.requests('POST', '/api/session')).toHaveLength(1);

    const fresh = await start({}, { resume: { driverId: 'opencode' as never, data: { sessionId: 'ses_gone' } } });
    expect(fresh.session.describePersistence()).not.toEqual(handle);
    await until(() => fresh.events.find((e) => e.type === 'session.warning' && e.message.includes('无法恢复')));
  });

  it('MCP 服务登记到 serve（执行超时 24 小时），连不上时提示', async () => {
    const mcpServers = { baocut: { url: 'http://127.0.0.1:1/mcp', headers: { authorization: 'Bearer t' } } };
    await start({}, { mcpServers });
    const put = fake.requests('PUT', '/api/experimental/mcp/baocut')[0]!;
    expect(put.location).toBe(cwd);
    expect(put.body).toEqual({
      config: {
        type: 'remote',
        url: 'http://127.0.0.1:1/mcp',
        headers: { authorization: 'Bearer t' },
        oauth: false,
        timeout: { execution: 86_400_000 },
      },
    });
    const failing = await start({ mcp: 'failed' }, { mcpServers });
    await until(() => failing.events.find((e) => e.type === 'session.warning' && e.message.includes('MCP')));
  });

  it('开发者指令写进会话的 instructions 条目；接口不在时附在第一轮前面', async () => {
    await start({}, { developerInstructions: 'Be brief.' });
    expect(fake.log().find((e) => e.path?.endsWith('/instructions/entries/baocut'))?.body).toEqual({ value: 'Be brief.' });

    const fallback = await start({ instructions: 'missing' }, { developerInstructions: 'Be brief.' });
    const { turnId } = await fallback.session.startTurn({ text: 'hi' }, settings());
    await fallback.completed(turnId);
    const prompts = fake.requests('POST', '/api/session/:id/prompt');
    expect(prompts.at(-1)!.body!.text).toBe('<system-instructions>\nBe brief.\n</system-instructions>\n\nhi');
  });

  it('受限的一次性调用不支持', async () => {
    await expect(start({}, { confinement: 'cwd-write-only' })).rejects.toThrow('不支持受限的一次性调用');
  });

  it('关闭会话结束 serve', async () => {
    const { session } = await start();
    await session.close();
    await until(() => fake.log().some((e) => e.kind === 'exit'));
  });
});
