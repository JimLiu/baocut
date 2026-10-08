import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentMode } from '@baocut/protocol';
import { silentLogger, type AgentEvent, type AgentPersistenceHandle, type AgentSession, type CreateSessionOptions } from '@baocut/harness';
import { createFakeAcp, type FakeAcp, type FakeAcpScenario } from '../testing/fake-acp.ts';
import { AcpDriver } from './acp-driver.ts';

/**
 * ACP 会话对着假智能体：新建与恢复、消息与工具事件、三种审批答复与本会话放行、取消、访问模式、MCP 不支持 HTTP 的提示。
 * 假智能体在进程启动时读场景，所以改场景之后要新开会话。
 */

async function until<T>(read: () => T | undefined | null | false, timeoutMs = 5_000): Promise<T> {
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

describe('AcpSession（假 ACP 智能体）', () => {
  let dir: string;
  let cwd: string;
  let fake: FakeAcp;
  let driver: AcpDriver;
  const open: AgentSession[] = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-acp-session-'));
    cwd = path.join(dir, 'project');
    await fs.mkdir(cwd);
    fake = await createFakeAcp(path.join(dir, 'fake'));
    driver = new AcpDriver('gemini', silentLogger, { locate: fake.locate });
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((s) => s.close()));
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function start(scenario: Partial<FakeAcpScenario> = {}, extra: Partial<CreateSessionOptions> = {}) {
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

  const settings = (accessMode: AgentMode = 'ask', model: string | null = null) => ({ accessMode, model, effort: null });

  it('新建会话：cwd 与 MCP 服务（Streamable HTTP）照传，第一轮前附开发者指令，消息与思考按增量到达', async () => {
    const { session, events, completed } = await start(
      { turn: { thought: 'thinking…', reply: 'hello world', plan: ['read', 'cut'] } },
      {
        mcpServers: { baocut: { url: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer t' } } },
        developerInstructions: 'Use bcut.',
      },
    );
    expect(session.capabilities).toEqual({ steer: false, approvals: true, resume: true, images: true });
    const created = fake.requests('session/new').at(-1)!.params;
    expect(created.cwd).toBe(cwd);
    expect(created.mcpServers).toEqual([
      { type: 'http', name: 'baocut', url: 'http://127.0.0.1:9/mcp', headers: [{ name: 'Authorization', value: 'Bearer t' }] },
    ]);
    const realCwd = await fs.realpath(cwd);
    expect(fake.log().find((e) => e.kind === 'start' && e.cwd === realCwd)?.env).toEqual({ NO_BROWSER: '1', NO_OPEN_BROWSER: '1' });

    const { turnId } = await session.startTurn({ text: 'hi' }, settings());
    const done = await completed(turnId);
    expect(done).toMatchObject({ outcome: 'completed', error: null });
    const prompt = fake.requests('session/prompt').at(-1)!.params.prompt as Array<{ type: string; text?: string }>;
    expect(prompt[0]!.text).toContain('Use bcut.');
    expect(prompt[1]).toEqual({ type: 'text', text: 'hi' });

    const deltas = events.filter((e) => e.type === 'item.delta');
    expect(deltas.map((e) => (e as { channel: string }).channel)).toEqual(['reasoning', 'text', 'text']);
    const items = events.filter((e) => e.type === 'item.completed').map((e) => (e as { item: { kind: string; text?: string } }).item);
    expect(items).toContainEqual(expect.objectContaining({ kind: 'reasoning', text: 'thinking…' }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'agent-message', text: '- [x] read\n- [ ] cut' }));
    expect(items).toContainEqual(expect.objectContaining({ kind: 'agent-message', text: 'hello world' }));
    expect(events.indexOf(done)).toBe(events.length - 1);

    // 第二轮不再附指令。
    const second = await session.startTurn({ text: 'again' }, settings());
    await completed(second.turnId);
    expect(fake.requests('session/prompt').at(-1)!.params.prompt).toEqual([{ type: 'text', text: 'again' }]);
    expect(session.describePersistence()).toEqual({ driverId: 'gemini', data: { sessionId: created.sessionId ?? expect.any(String) } });
  });

  it('智能体不支持经 HTTP 连 MCP：不传服务，提示用不了 BaoCut 的工具', async () => {
    const { events } = await start({ mcpHttp: false }, { mcpServers: { baocut: { url: 'http://127.0.0.1:9/mcp', headers: {} } } });
    expect(fake.requests('session/new').at(-1)!.params.mcpServers).toEqual([]);
    const warning = await until(() => events.find((e) => e.type === 'session.warning'));
    expect((warning as { message: string }).message).toContain('BaoCut 的工具');
  });

  it('恢复：支持 session/load 时加载，回放的历史不当成新内容', async () => {
    const first = await start();
    const handle = first.session.describePersistence() as AgentPersistenceHandle;
    const { session, events } = await start({}, { resume: handle });
    const loaded = fake.requests('session/load').at(-1)!.params;
    expect(loaded).toMatchObject({ sessionId: (handle.data as { sessionId: string }).sessionId, cwd, mcpServers: [] });
    expect(fake.requests('session/new')).toHaveLength(1);
    expect(session.describePersistence()).toEqual(handle);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events.filter((e) => e.type === 'item.delta' || e.type === 'session.warning')).toEqual([]);
  });

  it('恢复：没有 session/load 时用 session/resume；都不支持或失败时新建并如实提示', async () => {
    const handle: AgentPersistenceHandle = { driverId: 'gemini', data: { sessionId: 'old-session' } };
    await start({ loadSession: false, resume: true }, { resume: handle });
    expect(fake.requests('session/resume').at(-1)!.params).toMatchObject({ sessionId: 'old-session', cwd });

    const { events } = await start({ loadSession: true, loadFails: true }, { resume: handle });
    const warning = await until(() => events.find((e) => e.type === 'session.warning'));
    expect((warning as { message: string }).message).toContain('无法恢复');
    expect(fake.requests('session/new')).toHaveLength(1);
  });

  it('工具调用：开始与结束各一条，命令的标题、详情与输出', async () => {
    const { session, events, completed } = await start({
      turn: { tool: { kind: 'execute', title: 'Run ls', rawInput: { command: 'ls -la' }, output: 'a.mp4' }, reply: 'ok' },
    });
    const { turnId } = await session.startTurn({ text: 'list' }, settings());
    await completed(turnId);
    const started = events.find((e) => e.type === 'item.started') as Extract<AgentEvent, { type: 'item.started' }>;
    expect(started.item).toMatchObject({ kind: 'tool-call', id: 'tool-1', tool: 'command', status: 'running', detail: 'ls -la' });
    const finished = events.find((e) => e.type === 'item.completed' && e.item.kind === 'tool-call') as Extract<
      AgentEvent,
      { type: 'item.completed' }
    >;
    expect(finished.item).toMatchObject({ status: 'completed', output: 'a.mp4', exitCode: 0 });
  });

  it('审批：允许只选「只这一次」，拒绝选 reject_once 并记成 declined', async () => {
    const turn = { tool: { kind: 'execute', title: 'Run rm', rawInput: { command: 'rm a.txt' } }, ask: 1, reply: 'ok' };
    const a = await start({ turn });
    const t1 = await a.session.startTurn({ text: 'go' }, settings());
    const first = await a.approval();
    expect(first.request).toMatchObject({ kind: 'command', command: 'rm a.txt', cwd, rule: 'rm' });
    await a.session.respondToApproval(first.approvalId, { decision: 'accept' });
    await a.completed(t1.turnId);
    expect(fake.permissionAnswers().at(-1)).toEqual({ outcome: 'selected', optionId: 'allow' });

    const t2 = await a.session.startTurn({ text: 'again' }, settings());
    const second = await a.approval(2);
    await a.session.respondToApproval(second.approvalId, { decision: 'decline' });
    await a.completed(t2.turnId);
    expect(fake.permissionAnswers().at(-1)).toEqual({ outcome: 'selected', optionId: 'reject' });
    const declined = a.events.filter((e) => e.type === 'item.completed' && e.item.kind === 'tool-call').at(-1) as Extract<
      AgentEvent,
      { type: 'item.completed' }
    >;
    expect(declined.item).toMatchObject({ status: 'declined' });
  });

  it('审批：本会话放行与「总是允许」由 Driver 记住，之后同类请求直接答应，从不选原生的 allow_always', async () => {
    for (const decision of ['accept-for-session', 'accept-always'] as const) {
      const s = await start({
        turn: { tool: { kind: 'execute', title: 'Run bcut', rawInput: { command: 'bcut info a.mp4' } }, ask: 3, reply: 'ok' },
      });
      const before = fake.permissionAnswers().length;
      const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
      const first = await s.approval();
      await s.session.respondToApproval(first.approvalId, { decision });
      await s.completed(turnId);
      expect(s.events.filter((e) => e.type === 'approval.requested')).toHaveLength(1);
      expect(fake.permissionAnswers().slice(before)).toEqual(Array(3).fill({ outcome: 'selected', optionId: 'allow' }));
    }
  });

  it('审批：cancel 以 cancelled 作答并取消回合', async () => {
    const s = await start({ turn: { tool: { kind: 'edit', title: 'Edit a.txt', locations: ['/p/a.txt'] }, ask: 1, reply: 'ok' } });
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    const approval = await s.approval();
    expect(approval.request).toMatchObject({ kind: 'file-change', files: ['/p/a.txt'] });
    await s.session.respondToApproval(approval.approvalId, { decision: 'cancel' });
    const done = await s.completed(turnId);
    expect(done.outcome).toBe('interrupted');
    expect(fake.permissionAnswers().at(-1)).toEqual({ outcome: 'cancelled' });
    expect(fake.requests('session/cancel')).toHaveLength(1);
  });

  it('改文件成功：output 是由 diff 内容块生成的 unified diff（路径相对工作目录，新建的旧侧是 /dev/null）', async () => {
    const s = await start({
      turn: {
        tool: {
          kind: 'edit',
          title: 'Write',
          diffs: [
            { path: path.join(cwd, 'a.txt'), oldText: 'l1\nl2\nl3\nl4\nl5\nl6\n', newText: 'l1\nl2\nl3\nl4 changed\nl5\nl6\n' },
            { path: path.join(cwd, 'sub/new.txt'), oldText: null, newText: 'hello\n' },
          ],
        },
        ask: 1,
        reply: 'ok',
      },
    });
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    await s.session.respondToApproval((await s.approval()).approvalId, { decision: 'accept' });
    await s.completed(turnId);
    const started = s.events.find((e) => e.type === 'item.started' && e.item.kind === 'tool-call');
    expect(started).toMatchObject({ item: { tool: 'file-change', status: 'running', output: null } });
    const done = s.events.find((e) => e.type === 'item.completed' && e.item.kind === 'tool-call');
    expect(done).toMatchObject({ item: { tool: 'file-change', status: 'completed' } });
    expect((done as Extract<AgentEvent, { type: 'item.completed' }>).item).toHaveProperty(
      'output',
      [
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,6 +1,6 @@',
        ' l1',
        ' l2',
        ' l3',
        '-l4',
        '+l4 changed',
        ' l5',
        ' l6',
        '--- /dev/null',
        '+++ b/sub/new.txt',
        '@@ -0,0 +1,1 @@',
        '+hello',
      ].join('\n'),
    );
  });

  it('改文件被拒：declined，output 不是 diff', async () => {
    const s = await start({
      turn: { tool: { kind: 'edit', title: 'Write', diffs: [{ path: path.join(cwd, 'a.txt'), oldText: null, newText: 'x\n' }] }, ask: 1 },
    });
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    await s.session.respondToApproval((await s.approval()).approvalId, { decision: 'decline' });
    await s.completed(turnId);
    const done = s.events.find((e) => e.type === 'item.completed' && e.item.kind === 'tool-call');
    expect(done).toMatchObject({ item: { status: 'declined', output: null } });
  });

  it('BaoCut 自己的 MCP 工具：原生审批直接放行（由工具通道按访问模式把关），不出审批卡；别的 MCP 服务照常询问', async () => {
    const mcpServers = { baocut: { url: 'http://127.0.0.1:9/mcp', headers: {} } };
    for (const title of ['mcp__baocut__videos_list', 'videos_list (baocut MCP Server)']) {
      const s = await start({ turn: { tool: { kind: 'other', title }, ask: 1, reply: 'ok' } }, { mcpServers });
      const before = fake.permissionAnswers().length;
      const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
      await s.completed(turnId);
      expect(s.events.filter((e) => e.type === 'approval.requested')).toHaveLength(0);
      expect(fake.permissionAnswers().slice(before)).toEqual([{ outcome: 'selected', optionId: 'allow' }]);
    }
    const other = await start(
      { turn: { tool: { kind: 'other', title: 'mcp__github__create_issue' }, ask: 1, reply: 'ok' } },
      { mcpServers },
    );
    const { turnId } = await other.session.startTurn({ text: 'go' }, settings());
    const approval = await other.approval();
    expect(approval.request).toMatchObject({ kind: 'tool', tool: 'create_issue', server: 'github' });
    await other.session.respondToApproval(approval.approvalId, { decision: 'accept' });
    await other.completed(turnId);
  });

  it('中断：session/cancel，回合以 interrupted 结束；没在跑的回合报 not-running', async () => {
    const s = await start({ turn: { hang: true } });
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    await until(() => fake.requests('session/prompt').length > 0);
    expect(await s.session.interrupt(turnId)).toEqual({ status: 'requested' });
    expect((await s.completed(turnId)).outcome).toBe('interrupted');
    expect(await s.session.interrupt(turnId)).toEqual({ status: 'not-running' });
  });

  it('回合失败：需要登录的错误带 AGENT_AUTH_REQUIRED', async () => {
    const s = await start({ turn: { error: { code: -32000, message: 'Authentication required' } } });
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    expect(await s.completed(turnId)).toMatchObject({
      outcome: 'failed',
      error: 'Authentication required',
      errorCode: 'AGENT_AUTH_REQUIRED',
    });
  });

  it('开会话时没登录：抛出带 AGENT_AUTH_REQUIRED 的错误', async () => {
    fake.scenario({ loggedIn: false });
    await expect(driver.createSession({ cwd, accessMode: 'ask', model: null, effort: null, resume: null })).rejects.toMatchObject({
      code: 'driver-unavailable',
      agentCode: 'AGENT_AUTH_REQUIRED',
    });
  });

  it('访问模式取更严的原生模式；模型经 session/set_model 或配置项切换', async () => {
    const s = await start();
    const expected: Array<[AgentMode, string]> = [
      ['plan', 'plan'],
      ['ask', 'default'],
      ['autoAcceptEdits', 'default'],
      ['auto', 'default'],
      ['fullAccess', 'yolo'],
    ];
    for (const [mode, native] of expected) {
      const { turnId } = await s.session.startTurn({ text: mode }, settings(mode, 'fake-flash'));
      await s.completed(turnId);
      const set = fake.requests('session/set_mode');
      // 和当前模式相同时不发。
      if (set.length > 0) expect(set.at(-1)!.params.modeId).toBe(native);
    }
    expect(fake.requests('session/set_mode').map((r) => r.params.modeId)).toEqual(['plan', 'default', 'yolo']);
    expect(fake.requests('session/set_model').map((r) => r.params.modelId)).toEqual(['fake-flash']);

    const c = await start({ models: 'config', modesVia: 'config' });
    const { turnId } = await c.session.startTurn({ text: 'x' }, settings('plan', 'fake-flash'));
    await c.completed(turnId);
    expect(fake.requests('session/set_config_option').map((r) => [r.params.configId, r.params.value])).toEqual([
      ['mode', 'plan'],
      ['model', 'fake-flash'],
    ]);
  });

  it('Copilot：URL 形式的模式 id，完全访问是 #agent 加 allow_all=on，离开时先关掉', async () => {
    const agent = 'https://agentclientprotocol.com/protocol/session-modes#agent';
    const plan = 'https://agentclientprotocol.com/protocol/session-modes#plan';
    const autopilot = 'https://agentclientprotocol.com/protocol/session-modes#autopilot';
    driver = new AcpDriver('copilot', silentLogger, { locate: fake.locate });
    const s = await start({ modes: [agent, plan, autopilot], allowAll: true });
    for (const mode of ['ask', 'fullAccess', 'ask', 'plan', 'fullAccess'] as const) {
      const { turnId } = await s.session.startTurn({ text: mode }, settings(mode));
      await s.completed(turnId);
    }
    // 假智能体的当前模式是 'default'，第一轮 ask 也要设到 #agent；之后 ask ↔ fullAccess 只动 allow_all。
    expect(fake.requests('session/set_mode').map((r) => r.params.modeId)).toEqual([agent, plan, agent]);
    expect(fake.requests('session/set_config_option').map((r) => [r.params.configId, r.params.value])).toEqual([
      ['allow_all', 'on'],
      ['allow_all', 'off'],
      ['allow_all', 'on'],
    ]);
    expect(s.events.filter((e) => e.type === 'session.warning')).toEqual([]);
    // 离开完全访问时先关 allow_all 再换模式。
    const order = fake
      .log()
      .filter((e) => e.kind === 'in' && (e.msg?.method === 'session/set_mode' || e.msg?.method === 'session/set_config_option'))
      .map((e) => e.msg!.method);
    expect(order).toEqual([
      'session/set_mode',
      'session/set_config_option',
      'session/set_config_option',
      'session/set_mode',
      'session/set_mode',
      'session/set_config_option',
    ]);

    // 没有 allow_all 配置项：完全访问不设开关，提示一次，按 #agent 运行。
    const before = fake.requests('session/set_config_option').length;
    const n = await start({ modes: [agent, plan], allowAll: false });
    const { turnId } = await n.session.startTurn({ text: 'x' }, settings('fullAccess'));
    await n.completed(turnId);
    expect(fake.requests('session/set_config_option')).toHaveLength(before);
    expect(n.events.filter((e) => e.type === 'session.warning')).toHaveLength(1);
  });

  it('没有会话模式：不设模式，提示一次', async () => {
    const s = await start({ modes: null });
    for (const mode of ['plan', 'fullAccess'] as const) {
      const { turnId } = await s.session.startTurn({ text: mode }, settings(mode));
      await s.completed(turnId);
    }
    expect(fake.requests('session/set_mode')).toEqual([]);
    expect(s.events.filter((e) => e.type === 'session.warning')).toHaveLength(1);
  });

  it('图片按 base64 内容块发送', async () => {
    const image = path.join(dir, 'a.png');
    await fs.writeFile(image, Buffer.from([1, 2, 3]));
    const s = await start();
    const { turnId } = await s.session.startTurn({ text: 'look', images: [{ path: image, mimeType: 'image/png' }] }, settings());
    await s.completed(turnId);
    expect(fake.requests('session/prompt').at(-1)!.params.prompt).toContainEqual({ type: 'image', mimeType: 'image/png', data: 'AQID' });
  });

  it('受限的一次性调用不支持', async () => {
    await expect(
      driver.createSession({ cwd, accessMode: 'ask', model: null, effort: null, resume: null, confinement: 'cwd-write-only' }),
    ).rejects.toMatchObject({ code: 'driver-unavailable' });
  });

  it('关闭：先 session/close 再结束进程，报 session.exited 且没有错误', async () => {
    const s = await start();
    await s.session.close();
    expect(fake.requests('session/close')).toHaveLength(1);
    expect(await until(() => s.events.find((e) => e.type === 'session.exited'))).toEqual({ type: 'session.exited', error: null });
  });
});
