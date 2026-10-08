import { execFile } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import type { AgentDriver, AgentEvent, AgentSession, ApprovalResponse, CreateSessionOptions, TurnSettings } from '@baocut/harness';
import { Harness } from '@baocut/harness';
import { applySettingsEvent, applySpaceEvent, applyTasksEvent } from '@baocut/client';
import { JobManager } from '@baocut/jobs';
import { NodeInitiator, NodeService } from '@baocut/nodes';
import {
  RpcError,
  SETTING_DEFAULTS,
  newId,
  type AgentsEvent,
  type AgentsView,
  type ConversationSnapshot,
  type DriverProbe,
  type Id,
  type SettingsEvent,
  type SettingsSnapshot,
  type SpaceSnapshot,
  type TasksSnapshot,
} from '@baocut/protocol';
import { readDiscovery, resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { Gateway } from './gateway.ts';
import { MediaAnalysis } from './media-analysis.ts';
import { VideoService } from './videos/video-service.ts';
import { fakeProbe } from './agent-tools/testing/fake-agent.ts';
import { startRuntime, type RunningRuntime, type StartRuntimeOptions } from './runtime.ts';
import { SpaceCatalog } from './space-catalog.ts';
import { ServiceManager } from './services/service-manager.ts';

/**
 * 端到端：真实的 Runtime、网关与客户端，Driver 换成脚本化的假实现。
 * 用户消息决定假智能体的行为：`hello` 流式回复后结束；`approve` 先要一次审批再结束。
 */

const capabilities: DriverProbe['capabilities'] = { steer: false, approvals: true, resume: false, images: false };

class FakeSession implements AgentSession {
  readonly id = newId('fake');
  readonly capabilities = capabilities;
  readonly calls: string[] = [];
  /** 每一轮带来的访问模式（`TurnSettings.accessMode`）：模式按轮生效，不重开原生会话。 */
  readonly turnModes: TurnSettings['accessMode'][] = [];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  #turn = 0;

  startTurn(input: { text: string }, settings: TurnSettings): Promise<{ turnId: string }> {
    const turnId = `turn-${++this.#turn}`;
    this.calls.push(`startTurn:${input.text}`);
    this.turnModes.push(settings.accessMode);
    setTimeout(() => this.#script(turnId, input.text), 5);
    return Promise.resolve({ turnId });
  }

  async interrupt(turnId: string) {
    this.calls.push(`interrupt:${turnId}`);
    setTimeout(() => this.#emit({ type: 'turn.completed', turnId, outcome: 'interrupted', error: null }), 5);
    return { status: 'requested' as const };
  }

  async respondToApproval(approvalId: Id, response: ApprovalResponse) {
    this.calls.push(`approval:${approvalId}:${response.decision}`);
    if (response.decision === 'accept') {
      setTimeout(() => this.#emit({ type: 'turn.completed', turnId: `turn-${this.#turn}`, outcome: 'completed', error: null }), 5);
    }
  }

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

  #script(turnId: string, text: string) {
    this.#emit({ type: 'turn.started', turnId });
    if (text === 'hello') {
      this.#emit({ type: 'item.started', turnId, item: { kind: 'agent-message', id: 'm1', text: '' } });
      this.#emit({ type: 'item.delta', turnId, itemId: 'm1', channel: 'text', delta: '你' });
      this.#emit({ type: 'item.delta', turnId, itemId: 'm1', channel: 'text', delta: '好' });
      this.#emit({ type: 'item.completed', turnId, item: { kind: 'agent-message', id: 'm1', text: '你好' } });
      this.#emit({ type: 'turn.completed', turnId, outcome: 'completed', error: null });
    } else if (DRIVER_REQUESTS[text]) {
      const { request, escalation } = DRIVER_REQUESTS[text];
      this.#emit({ type: 'approval.requested', turnId, approvalId: 'ap1', request, ...(escalation ? { escalation } : {}) });
    }
  }
}

/** 假智能体按消息发出的审批请求：命令、工作目录内外的文件修改、越出沙箱的命令（Codex 的 on-request）。 */
const DRIVER_REQUESTS: Record<string, { request: Extract<AgentEvent, { type: 'approval.requested' }>['request']; escalation?: true }> = {
  approve: { request: { kind: 'command', command: 'touch notes.txt', cwd: null, reason: null, rule: 'touch' } },
  'approve-file': { request: { kind: 'file-change', files: ['notes.txt'], reason: null } },
  'approve-outside': { request: { kind: 'file-change', files: [path.join(os.tmpdir(), 'baocut-elsewhere', 'x.txt')], reason: null } },
  'approve-escalation': {
    request: { kind: 'command', command: 'curl https://example.com', cwd: null, reason: '需要联网' },
    escalation: true,
  },
};

class FakeDriver implements AgentDriver {
  readonly id = 'codex' as const;
  readonly sessions: FakeSession[] = [];
  readonly created: CreateSessionOptions[] = [];

  async probe(): Promise<DriverProbe> {
    return fakeProbe(capabilities);
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    this.created.push(options);
    const session = new FakeSession();
    this.sessions.push(session);
    return session;
  }
}

async function until<T>(read: () => T | undefined | false, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Runtime（假 Driver）', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let driver: FakeDriver;
  let client: BaoCutClient;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-test-'));
    driver = new FakeDriver();
    runtime = await startRuntime({ home: resolveRuntimeHome({ BAOCUT_HOME: dir }), drivers: () => [driver], watchSpace: false });
    client = await connect();
  });

  async function connect(): Promise<BaoCutClient> {
    const { endpoint, token } = runtime.discovery;
    const next = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'cli', name: 'test', version: '0' },
      reconnect: false,
    });
    await next.connect();
    return next;
  }

  async function rejection(promise: Promise<unknown>): Promise<RpcError> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof RpcError) return error;
      throw error;
    }
    throw new Error('应该被拒绝');
  }

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 经订阅维护的会话镜像，与界面拿到的一致。 */
  function mirror(conversationId: Id) {
    let current: ConversationSnapshot | null = null;
    const updates: string[] = [];
    client.subscribeConversation(conversationId, {
      snapshot: (snapshot) => {
        current = snapshot;
      },
      event: (event) => {
        updates.push(event.type);
        if (!current) return;
        if (event.type === 'item.upsert') {
          const index = current.items.findIndex((i) => i.id === event.item.id);
          current = { ...current, items: index < 0 ? [...current.items, event.item] : current.items.with(index, event.item) };
        } else if (event.type === 'conversation.updated') {
          current = { ...current, conversation: event.conversation };
        }
      },
    });
    return { get: () => current, updates, ready: until(() => current !== null) };
  }

  it('发送消息：流式回复，任务完成，标题取自第一句', async () => {
    const { conversation } = await client.request('conversations.create', {});
    const view = mirror(conversation.id);
    await view.ready;
    const { taskId } = await client.request('conversations.send', {
      conversationId: conversation.id,
      text: 'hello',
      commandId: newId('cmd'),
    });

    const done = await until(() => {
      const snapshot = view.get();
      const task = snapshot?.items.find((i) => i.id === taskId);
      return snapshot && task?.kind === 'task' && task.status === 'completed' ? snapshot : undefined;
    });
    expect(view.updates).toContain('item.append');
    const reply = runtime.harness.getConversation(conversation.id).items.find((i) => i.kind === 'agent-message');
    expect(reply).toMatchObject({ text: '你好', streaming: false });
    expect(done.conversation).toMatchObject({ title: 'hello', activity: 'idle', activeTaskId: null });
  });

  it('同一个 commandId 重发不会再起一个任务', async () => {
    const { conversation } = await client.request('conversations.create', {});
    const commandId = newId('cmd');
    const first = await client.request('conversations.send', { conversationId: conversation.id, text: 'hello', commandId });
    const second = await client.request('conversations.send', { conversationId: conversation.id, text: 'hello', commandId });
    expect(second.taskId).toBe(first.taskId);
    // 原生会话在 send 返回之后异步创建（要先读开着的 skill），等它出现再数。
    const session = await until(() => driver.sessions[0]?.calls.some((c) => c.startsWith('startTurn')) && driver.sessions[0]);
    expect(session.calls.filter((c) => c.startsWith('startTurn'))).toHaveLength(1);
  });

  it('创作模板：列出内置与用户目录的模板，取正文，随附文件经媒体通道取', async () => {
    const own = path.join(dir, 'templates', 'my-scene');
    await fs.mkdir(path.join(own, 'assets'), { recursive: true });
    const { manifest } = (await client.request('templates.get', { id: 'launch-film' })).template;
    await fs.writeFile(
      path.join(own, 'template.json'),
      JSON.stringify({
        ...manifest,
        id: 'my-scene',
        source: 'community',
        cover: { file: 'cover.png', tone: 'blue' },
        preview: { beats: manifest.preview.beats },
        verification: undefined,
        assets: [{ path: 'assets/x.svg', type: 'svg', note: '片尾标志' }],
      }),
    );
    await fs.writeFile(path.join(own, 'prompt.md'), '你要做一条自己的视频。\n');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6J1sAAAAASUVORK5CYII=', 'base64');
    await fs.writeFile(path.join(own, 'cover.png'), png);
    await fs.writeFile(path.join(own, 'assets', 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await fs.mkdir(path.join(dir, 'templates', 'broken'));
    await fs.writeFile(path.join(dir, 'templates', 'broken', 'template.json'), '{}');

    const { templates, diagnostics } = await client.request('templates.list', {});
    expect(templates.filter((t) => t.origin === 'builtin').length).toBeGreaterThanOrEqual(24);
    expect(templates.find((t) => t.manifest.id === 'my-scene')).toMatchObject({
      origin: 'user',
      files: { cover: true, preview: false, assets: 1 },
    });
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'unsupported-schema', origin: 'user', dir: 'broken' })]);

    expect((await client.request('templates.get', { id: 'my-scene' })).prompt).toBe('你要做一条自己的视频。\n');
    const cover = await client.request('templates.openHandle', { id: 'my-scene', path: 'cover.png' });
    expect(cover).toMatchObject({ mimeType: 'image/png', contentKind: 'image', size: png.length, fileName: 'cover.png' });
    expect(Buffer.from(await (await fetch(cover.url)).arrayBuffer())).toEqual(png);
    const svg = await client.request('templates.openHandle', { id: 'my-scene', path: 'assets/x.svg' });
    expect(await (await fetch(svg.url)).text()).toContain('<svg');
    const unregistered = await rejection(client.request('templates.openHandle', { id: 'my-scene', path: 'prompt.md' }));
    expect(unregistered).toMatchObject({ code: 'not-found', details: { code: 'TEMPLATE_FILE_NOT_FOUND' } });
    expect((await rejection(client.request('templates.get', { id: 'broken' }))).details).toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
    expect((await rejection(client.request('templates.openHandle', { id: 'my-scene', path: '../x' }))).code).toBe('invalid-request');
  });

  it('带场景模板发送：智能体拿到简报引导与正文，会话里是用户的原话加模板标记', async () => {
    const { conversation } = await client.request('conversations.create', {});
    const { prompt } = await client.request('templates.get', { id: 'launch-film' });
    await client.request('conversations.send', {
      conversationId: conversation.id,
      text: '给我的新耳机做一条发布片',
      commandId: newId('cmd'),
      template: { id: 'launch-film', version: '0.0.1' },
    });
    const turn = await until(() => driver.sessions[0]?.calls.find((c) => c.startsWith('startTurn:')));
    expect(turn.startsWith('startTurn:给我的新耳机做一条发布片\n\n<baocut-template id="launch-film" version="1.1.0">')).toBe(true);
    expect(turn).toContain('先和用户确认简报');
    expect(turn).toContain(prompt.trim());
    const message = runtime.harness.getConversation(conversation.id).items.find((i) => i.kind === 'user-message');
    expect(message).toMatchObject({
      text: '给我的新耳机做一条发布片',
      template: { id: 'launch-film', version: '1.1.0', title: '新品发布片', kind: 'scene', origin: 'builtin' },
    });

    const other = await client.request('conversations.create', {});
    const example = await rejection(
      client.request('conversations.send', {
        conversationId: other.conversation.id,
        text: '做一条',
        commandId: newId('cmd'),
        template: { id: 'ai-news-take' },
      }),
    );
    expect(example).toMatchObject({ code: 'invalid-request', details: { code: 'TEMPLATE_NOT_SCENE' } });
  });

  it('审批：允许后回合继续并完成', async () => {
    const { conversation } = await client.request('conversations.create', {});
    const { taskId } = await client.request('conversations.send', {
      conversationId: conversation.id,
      text: 'approve',
      commandId: newId('cmd'),
      autonomy: 'plan',
    });
    await until(() => runtime.harness.getConversation(conversation.id).conversation.activity === 'awaiting-approval');

    const result = await client.request('agents.respondToApproval', {
      conversationId: conversation.id,
      approvalId: 'ap1',
      decision: 'accept',
    });
    expect(result.status).toBe('accepted');
    await until(() => {
      const task = runtime.harness.getConversation(conversation.id).items.find((i) => i.id === taskId);
      return task?.kind === 'task' && task.status === 'completed';
    });
    expect(runtime.harness.getConversation(conversation.id).items.find((i) => i.kind === 'approval')).toMatchObject({ status: 'accepted' });
  });

  it('停止屏障：先取消待批审批，再中断回合；之后的批准不再放行', async () => {
    const { conversation } = await client.request('conversations.create', {});
    const { taskId } = await client.request('conversations.send', {
      conversationId: conversation.id,
      text: 'approve',
      commandId: newId('cmd'),
      accessMode: 'ask',
    });
    await until(() => runtime.harness.getConversation(conversation.id).conversation.activity === 'awaiting-approval');

    await client.request('tasks.stop', { taskId });
    const late = await client.request('agents.respondToApproval', {
      conversationId: conversation.id,
      approvalId: 'ap1',
      decision: 'accept',
    });
    expect(late.status).toBe('already-resolved');

    await until(() => {
      const task = runtime.harness.getConversation(conversation.id).items.find((i) => i.id === taskId);
      return task?.kind === 'task' && task.status === 'stopped';
    });
    const session = driver.sessions[0]!;
    expect(session.calls).toEqual(['startTurn:approve', 'approval:ap1:cancel', 'interrupt:turn-1']);
    expect(runtime.harness.getConversation(conversation.id).items.find((i) => i.kind === 'approval')).toMatchObject({
      status: 'cancelled',
    });
    expect(runtime.harness.getConversation(conversation.id).conversation).toMatchObject({ activity: 'idle', activeTaskId: null });
  });

  it('Driver 的审批按同一张决策表：自动允许、自动拒绝或交给用户；待处理的进统一列表与任务主题', async () => {
    let tasks: TasksSnapshot | null = null;
    client.subscribeTasks({
      snapshot: (snapshot) => {
        tasks = snapshot;
      },
      event: (event) => {
        if (tasks) tasks = applyTasksEvent(tasks, event);
      },
    });
    await until(() => tasks !== null);
    const cases = [
      ['plan', 'approve', 'pending', 'command'],
      ['plan', 'approve-file', 'declined', 'edit'],
      ['ask', 'approve-file', 'pending', 'edit'],
      ['autoAcceptEdits', 'approve-file', 'accepted', 'edit'],
      ['autoAcceptEdits', 'approve-outside', 'pending', 'high'],
      ['autoAcceptEdits', 'approve', 'pending', 'command'],
      ['auto', 'approve', 'accepted', 'command'],
      ['auto', 'approve-escalation', 'pending', 'high'],
      ['fullAccess', 'approve-escalation', 'accepted', 'high'],
      ['fullAccess', 'approve-outside', 'accepted', 'high'],
    ] as const;
    for (const [mode, text, status, risk] of cases) {
      const label = `${mode} ${text}`;
      const { conversation } = await client.request('conversations.create', {});
      const { taskId } = await client.request('conversations.send', {
        conversationId: conversation.id,
        text,
        commandId: newId('cmd'),
        accessMode: mode,
      });
      const item = await until(() => runtime.harness.getConversation(conversation.id).items.find((i) => i.kind === 'approval'));
      expect(item, label).toMatchObject({ status, risk, mode, ...(status === 'pending' ? {} : { decidedBy: 'auto' }) });
      const session = driver.sessions.at(-1)!;
      if (status === 'pending') {
        const pending = runtime.harness.approvals.pending();
        expect(pending, label).toHaveLength(1);
        expect(pending[0], label).toMatchObject({
          subject: { kind: 'conversation', conversationId: conversation.id, taskId },
          risk,
          basis: { kind: 'mode', mode },
          expiresAt: null,
        });
        await until(() => tasks?.approvals?.length === 1);
        expect(runtime.harness.getConversation(conversation.id).conversation.activity, label).toBe('awaiting-approval');
        await client.request('tasks.stop', { taskId });
        expect(session.calls, label).toContain('approval:ap1:cancel');
        expect(runtime.harness.approvals.pending(), label).toEqual([]);
        await until(() => tasks?.approvals?.length === 0);
      } else {
        expect(session.calls, label).toContain(`approval:ap1:${status === 'accepted' ? 'accept' : 'decline'}`);
        expect(runtime.harness.approvals.pending(), label).toEqual([]);
        if (status === 'declined') await client.request('tasks.stop', { taskId });
      }
      await until(() => runtime.harness.getConversation(conversation.id).conversation.activity === 'idle');
    }
  });

  it('会话审批的两种处理方式：agents.respondToApproval 的 accept-for-session 与 approvals.respond 一样结束统一列表里的那条', async () => {
    const { conversation } = await client.request('conversations.create', {});
    await client.request('conversations.send', {
      conversationId: conversation.id,
      text: 'approve',
      commandId: newId('cmd'),
      accessMode: 'ask',
    });
    const [pending] = await until(() => runtime.harness.approvals.pending().length === 1 && runtime.harness.approvals.pending());
    expect((await client.request('approvals.list', {})).approvals).toEqual([pending]);
    expect(await client.request('approvals.respond', { approvalId: pending!.approvalId, decision: 'allow' })).toEqual({
      status: 'allowed',
    });
    expect(await client.request('approvals.respond', { approvalId: pending!.approvalId, decision: 'deny' })).toEqual({
      status: 'already-resolved',
    });
    expect(
      await client.request('agents.respondToApproval', { conversationId: conversation.id, approvalId: 'ap1', decision: 'decline' }),
    ).toEqual({
      status: 'already-resolved',
    });
    await until(() => runtime.harness.getConversation(conversation.id).conversation.activity === 'idle');
    expect(driver.sessions.at(-1)!.calls).toEqual(['startTurn:approve', 'approval:ap1:accept']);
    expect(runtime.harness.getConversation(conversation.id).items.find((i) => i.kind === 'approval')).toMatchObject({
      status: 'accepted',
      decidedBy: 'user',
    });

    const { conversation: second } = await client.request('conversations.create', {});
    await client.request('conversations.send', { conversationId: second.id, text: 'approve', commandId: newId('cmd'), accessMode: 'ask' });
    await until(() => runtime.harness.approvals.pending().length === 1);
    expect(
      await client.request('agents.respondToApproval', { conversationId: second.id, approvalId: 'ap1', decision: 'accept-for-session' }),
    ).toEqual({ status: 'accepted' });
    expect(runtime.harness.approvals.pending()).toEqual([]);
    await until(() => driver.sessions.at(-1)!.calls.includes('approval:ap1:accept-for-session'));
  });

  it('访问模式跟随设置；「总是允许」：规则归 BaoCut 存，原生侧只按会话级放行，之后同一条规则自动答应；默认 Agent 存在设置里', async () => {
    const { conversation } = await client.request('conversations.create', {});
    // 没有切换过的会话跟随设置 agent.defaultAccessMode（默认 auto）。
    expect(conversation).toMatchObject({ driverId: 'codex', model: null, effort: null, accessMode: null });
    const { conversation: switched } = await client.request('conversations.update', { conversationId: conversation.id, accessMode: 'ask' });
    expect(switched.accessMode).toBe('ask');

    const { taskId } = await client.request('conversations.send', { conversationId: conversation.id, text: 'approve', commandId: newId('cmd') });
    await until(() => runtime.harness.getConversation(conversation.id).conversation.activity === 'awaiting-approval');
    await client.request('agents.respondToApproval', { conversationId: conversation.id, approvalId: 'ap1', decision: 'accept-always' });
    expect(driver.sessions[0]!.calls).toContain('approval:ap1:accept-for-session');
    expect(runtime.harness.getConversation(conversation.id).items.find((i) => i.kind === 'approval')).toMatchObject({
      status: 'accepted',
      decidedBy: 'user',
      decision: 'accept-always',
    });
    // 假智能体只在 `accept` 后结束回合；会话级放行之后由停止收尾。
    await client.request('tasks.stop', { taskId });
    await until(() => runtime.harness.getConversation(conversation.id).conversation.activity === 'idle');

    const view = await client.request('agents.list', {});
    expect(view.preferences).toMatchObject({ rules: ['touch'] });
    expect(view.drivers).toEqual([expect.objectContaining({ id: 'codex', state: 'ready', enabled: true, isDefault: true })]);

    // 另一个会话里同一条规则：「询问」档也自动答应，时间线上记成按规则。
    const { conversation: other } = await client.request('conversations.create', {});
    await client.request('conversations.send', { conversationId: other.id, text: 'approve', commandId: newId('cmd'), accessMode: 'ask' });
    const ruled = await until(() => runtime.harness.getConversation(other.id).items.find((i) => i.kind === 'approval'));
    expect(ruled).toMatchObject({ status: 'accepted', decidedBy: 'rule' });
    expect(driver.sessions.at(-1)!.calls).toContain('approval:ap1:accept');
    await until(() => runtime.harness.getConversation(other.id).conversation.activity === 'idle');
    expect((await client.request('agents.removeRule', { rule: 'touch' })).preferences.rules).toEqual([]);

    // 默认 Agent：agents.setDefault 写的是设置 agent.defaultDriver。
    await client.request('agents.setDefault', { driverId: 'codex' });
    expect((await client.request('settings.get', {})).settings['agent.defaultDriver']).toBe('codex');

    // 原生会话不能跨 Agent 续：有过任务的会话不能换。
    const error = await rejection(client.request('conversations.update', { conversationId: conversation.id, driverId: 'claude' }));
    expect(error.code).toBe('conflict');
    // 停用之后不再是可用的默认。
    const disabled = await client.request('agents.configure', { driverId: 'codex', enabled: false });
    expect(disabled.drivers[0]).toMatchObject({ state: 'disabled', status: 'unavailable', enabled: false });
  });
  it('agents 主题：快照是 agents.list 的视图；偏好、重新检测与默认 Agent 的变化逐次推送整份视图', async () => {
    const listed = await client.request('agents.list', {});
    let view: AgentsView | null = null;
    const seen: AgentsEvent[] = [];
    const stop = client.subscribeAgents({
      snapshot: (snapshot) => (view = snapshot),
      event: (event) => {
        seen.push(event);
        view = event.view;
      },
    });
    try {
      const snapshot = await until(() => view ?? undefined);
      expect(snapshot.checking).toEqual([]);
      expect(snapshot.drivers.map((d) => d.id)).toEqual(listed.drivers.map((d) => d.id));
      expect(snapshot.drivers[0]).toMatchObject({ id: 'codex', state: 'ready' });

      await client.request('agents.updatePreferences', { modelAutoUpdate: false });
      await until(() => view?.preferences.modelAutoUpdate === false);

      const count = seen.length;
      const detected = await client.request('agents.detect', { driverId: 'codex' });
      await until(() => seen.length > count);
      expect(view!.drivers[0]!.checkedAt).toBe(detected.drivers[0]!.checkedAt);

      await client.request('agents.configure', { driverId: 'codex', enabled: false });
      await until(() => view?.drivers[0]?.state === 'disabled');
      await client.request('agents.configure', { driverId: 'codex', enabled: true });
      const before = seen.length;
      await client.request('agents.setDefault', { driverId: 'codex' });
      await until(() => seen.length > before);
      expect(seen.every((event) => event.type === 'agents.updated')).toBe(true);
    } finally {
      stop();
    }
  });

  it('断线不取消回合：换一条连接还能看到并继续这个任务', async () => {
    const { conversation } = await client.request('conversations.create', {});
    const { taskId } = await client.request('conversations.send', {
      conversationId: conversation.id,
      text: 'approve',
      commandId: newId('cmd'),
      autonomy: 'plan',
    });
    await until(() => runtime.harness.getConversation(conversation.id).conversation.activity === 'awaiting-approval');
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    client = await connect();
    const view = mirror(conversation.id);
    await view.ready;
    expect(view.get()!.conversation).toMatchObject({ activity: 'awaiting-approval', activeTaskId: taskId });
    await client.request('agents.respondToApproval', { conversationId: conversation.id, approvalId: 'ap1', decision: 'accept' });
    await until(() => {
      const task = view.get()?.items.find((i) => i.id === taskId);
      return task?.kind === 'task' && task.status === 'completed';
    });
  });

  it('任务主题：快照与增量；完成后会话标为未读，markRead 清掉', async () => {
    let tasks: TasksSnapshot | null = null;
    client.subscribeTasks({
      snapshot: (snapshot) => {
        tasks = snapshot;
      },
      event: (event) => {
        if (tasks) tasks = applyTasksEvent(tasks, event);
      },
    });
    await until(() => tasks !== null);
    const { conversation } = await client.request('conversations.create', {});
    const { taskId } = await client.request('conversations.send', {
      conversationId: conversation.id,
      text: 'hello',
      commandId: newId('cmd'),
    });
    const done = await until(() => tasks?.tasks.find((t) => t.taskId === taskId && t.status === 'completed'));
    expect(done).toMatchObject({ conversationId: conversation.id, goal: 'hello', conversationTitle: 'hello', error: null });
    expect(runtime.harness.getConversation(conversation.id).conversation.unread).toBe(true);

    const before = runtime.harness.getConversation(conversation.id).conversation.updatedAt;
    const read = await client.request('conversations.markRead', { conversationId: conversation.id });
    expect(read.conversation).toMatchObject({ unread: false, updatedAt: before });

    // 会话删除后，它的任务从任务中心消失。
    await client.request('conversations.delete', { conversationId: conversation.id });
    await until(() => tasks?.tasks.length === 0);
  });

  it('项目：新建在项目目录下且重名加序号；置顶与归档不改最近活动', async () => {
    const first = await client.request('projects.create', { name: '短片' });
    const second = await client.request('projects.create', { name: '短片' });
    const unnamed = await client.request('projects.create', {});
    expect(first.project.path).toBe(await fs.realpath(path.join(dir, 'projects', '短片')));
    expect(path.basename(second.project.path)).toBe('短片 2');
    expect(path.basename(unnamed.project.path)).toBe('未命名项目');
    expect(first.project).toMatchObject({ name: '短片', pinned: false, archived: false });

    const pinned = await client.request('projects.update', { projectId: first.project.id, pinned: true, name: '短片 A' });
    expect(pinned.project).toMatchObject({ pinned: true, name: '短片 A', lastActiveAt: first.project.lastActiveAt });

    const { conversation } = await client.request('conversations.create', { projectId: first.project.id });
    const updated = await client.request('conversations.update', { conversationId: conversation.id, title: '  第一版  ', pinned: true });
    expect(updated.conversation).toMatchObject({ title: '第一版', pinned: true, updatedAt: conversation.updatedAt });

    const bad = await rejection(client.request('projects.create', { name: 3 as unknown as string }));
    expect(bad.code).toBe('invalid-request');
    const missing = await rejection(client.request('projects.update', { projectId: 'proj_nope', pinned: true }));
    expect(missing.code).toBe('not-found');
  });

  it('Space：列出项目里的媒体文件，标记可改，媒体地址支持 Range', async () => {
    const project = path.join(dir, 'work');
    await fs.mkdir(path.join(project, 'clips'), { recursive: true });
    await fs.mkdir(path.join(project, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(project, 'clips', 'a.mp4'), Buffer.from('0123456789'));
    await fs.writeFile(path.join(project, 'notes.md'), '# 笔记');
    await fs.writeFile(path.join(project, 'index.ts'), 'code');
    await fs.writeFile(path.join(project, 'node_modules', 'x.png'), 'x');

    let space: SpaceSnapshot | null = null;
    client.subscribeSpace({
      snapshot: (snapshot) => {
        space = snapshot;
      },
      event: (event) => {
        if (space) space = applySpaceEvent(space, event);
      },
    });
    await runtime.space.ready;
    const { project: opened } = await client.request('projects.open', { path: project });
    const entries = await until(() => (space && space.entries.length === 2 ? space.entries : undefined));
    expect(entries.map((e) => `${e.kind}:${e.relPath}`).sort()).toEqual(['document:notes.md', 'video-file:clips/a.mp4']);
    const video = entries.find((e) => e.kind === 'video-file')!;
    expect(video).toMatchObject({ fileName: 'a.mp4', size: 10, source: { projectId: opened.id, conversationId: null } });

    const { entry } = await client.request('space.update', { entryId: video.id, favorite: true, displayName: '开场' });
    expect(entry).toMatchObject({ name: '开场', user: { favorite: true, displayName: '开场', trashedAt: null } });
    await until(() => space?.entries.find((e) => e.id === video.id)?.user.favorite);
    const trashed = await client.request('space.update', { entryId: video.id, trashed: true });
    expect(trashed.entry.user.trashedAt).not.toBeNull();
    // 回收站只写标记，文件还在。
    await fs.access(path.join(project, 'clips', 'a.mp4'));

    // 标记在重扫后保留。
    await client.request('space.rescan', {});
    expect(space!.entries.find((e) => e.id === video.id)).toMatchObject({ name: '开场', user: { favorite: true } });

    const handle = await client.request('media.resolve', { entryId: video.id });
    // 夹具是十个 ASCII 字节：目录分类仍看扩展名，查看器必须按内容判断。
    expect(handle).toMatchObject({ mimeType: 'text/plain; charset=utf-8', contentKind: 'text', size: 10, fileName: 'a.mp4' });
    expect(handle.url).not.toContain(project);
    expect(await client.request('media.playback', { url: handle.url })).toMatchObject({ status: 'ready', media: handle });
    expect((await rejection(client.request('media.playback', { url: handle.url, path: project } as never))).code).toBe('invalid-request');
    expect((await rejection(client.request('media.playback', { url: 'http://other.invalid/media/forged/x' }))).code).toBe('not-found');
    const partial = await fetch(handle.url, { headers: { Range: 'bytes=2-5' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await partial.text()).toBe('2345');
    const tail = await fetch(handle.url, { headers: { Range: 'bytes=-3' } });
    expect(await tail.text()).toBe('789');
    const beyond = await fetch(handle.url, { headers: { Range: 'bytes=20-' } });
    expect(beyond.status).toBe(416);
    const head = await fetch(handle.url, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('10');
    expect(head.headers.get('accept-ranges')).toBe('bytes');
    const forged = await fetch(handle.url.replace(/\/media\/[^/]+/, '/media/not-a-handle'));
    expect(forged.status).toBe(404);

    // 删掉文件后条目消失。
    await fs.rm(path.join(project, 'notes.md'));
    await client.request('space.rescan', {});
    expect(space!.entries.map((e) => e.relPath)).toEqual(['clips/a.mp4']);
  });

  it('Space：不列出项目标记目录；项目目录移动后跟到新位置，用户标记保留', async () => {
    const project = path.join(dir, 'before');
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, 'a.mp4'), 'x');
    await runtime.space.ready;
    const { project: opened } = await client.request('projects.open', { path: project });
    await fs.access(path.join(project, '.bcut', 'project.json'));
    await client.request('space.rescan', {});
    const entries = () => runtime.space.snapshot().entries.filter((e) => e.source.projectId === opened.id);
    expect(entries().map((e) => e.relPath)).toEqual(['a.mp4']);
    const [entry] = entries();
    await client.request('space.update', { entryId: entry!.id, favorite: true });

    const after = path.join(dir, 'after');
    await fs.rename(project, after);
    const { project: moved } = await client.request('projects.open', { path: after });
    expect(moved.id).toBe(opened.id);
    await client.request('space.rescan', {});
    expect(entries()).toMatchObject([{ id: entry!.id, relPath: 'a.mp4', user: { favorite: true } }]);
    expect(runtime.space.locate(entry!.id).root).toBe(moved.path);
  });

  it('从 Space 条目继续会话：选会话、只带标识与元数据、下一条消息带上后清掉；看不到条目的会话与回收站里的条目拒绝', async () => {
    const project = path.join(dir, 'continue');
    await fs.mkdir(project, { recursive: true });
    const secret = '这段文件内容不该进提示词';
    await fs.writeFile(path.join(project, 'notes.md'), secret);
    await runtime.space.ready;
    const { project: opened } = await client.request('projects.open', { path: project });
    await client.request('space.rescan', {});
    const entry = runtime.space.snapshot().entries.find((e) => e.relPath === 'notes.md')!;

    // 属于项目的条目：在那个项目里新建会话。同一个 commandId 重试拿到同一个会话，引用不重复。
    const commandId = newId('cmd');
    const first = await client.request('space.continueInConversation', { entryId: entry.id, commandId });
    expect(first).toMatchObject({
      created: true,
      conversation: { projectId: opened.id, cwd: opened.path },
      reference: { entryId: entry.id, kind: 'document', name: 'notes.md', projectId: opened.id, relPath: 'notes.md', origin: null },
    });
    expect(first.conversation.pendingReferences).toEqual([first.reference]);
    const again = await client.request('space.continueInConversation', { entryId: entry.id, commandId });
    expect(again).toMatchObject({ created: false, conversation: { id: first.conversation.id } });
    expect(again.conversation.pendingReferences).toHaveLength(1);
    // 只挂引用，不启动任务。
    expect(driver.created).toEqual([]);
    expect(runtime.harness.getConversation(first.conversation.id).items).toEqual([]);

    // 指定会话：要看得到这个条目。不属于项目的会话看不到项目里的条目。
    const { conversation: loose } = await client.request('conversations.create', {});
    const mismatch = await rejection(client.request('space.continueInConversation', { entryId: entry.id, conversationId: loose.id }));
    expect(mismatch.details).toMatchObject({ code: 'SPACE_CONVERSATION_MISMATCH' });
    const { conversation: sibling } = await client.request('conversations.create', { projectId: opened.id });
    const into = await client.request('space.continueInConversation', { entryId: entry.id, conversationId: sibling.id });
    expect(into).toMatchObject({ created: false, conversation: { id: sibling.id, pendingReferences: [{ entryId: entry.id }] } });
    // 用户在输入框里去掉了引用。
    const cleared = await client.request('conversations.update', { conversationId: sibling.id, pendingReferences: null });
    expect(cleared.conversation.pendingReferences).toBeUndefined();

    // 发送：引用附在发给智能体的文字后面，记在用户消息上，然后清掉；文件内容不在里面。
    await client.request('conversations.send', {
      conversationId: first.conversation.id,
      text: '接着整理这份笔记',
      commandId: newId('cmd'),
    });
    const session = await until(() => driver.sessions[0]);
    const prompt = await until(() => session.calls.find((c) => c.startsWith('startTurn:')));
    expect(prompt).toContain('接着整理这份笔记');
    expect(prompt).toContain('<baocut-space-references>');
    expect(prompt).toContain(`entryId: ${entry.id}`);
    expect(prompt).not.toContain(secret);
    const after = runtime.harness.getConversation(first.conversation.id);
    expect(after.conversation.pendingReferences).toBeUndefined();
    expect(after.items.find((i) => i.kind === 'user-message')).toMatchObject({
      text: '接着整理这份笔记',
      references: [{ entryId: entry.id }],
    });

    // 回收站里的条目不能拿来继续。
    await client.request('space.trash', { entryId: entry.id });
    const trashed = await rejection(client.request('space.continueInConversation', { entryId: entry.id }));
    expect(trashed.details).toMatchObject({ code: 'SPACE_ENTRY_TRASHED' });
  });

  it('媒体句柄按内容识别未知格式、无扩展名和伪装扩展名，HTTP 类型与元数据一致', async () => {
    const { conversation } = await client.request('conversations.create', {});
    const examples = [
      { name: 'README', data: Buffer.from('中文 English\n'), kind: 'text', mime: 'text/plain; charset=utf-8' },
      { name: '说明.abc', data: Buffer.from('notes\n'), kind: 'text', mime: 'text/plain; charset=utf-8' },
      { name: 'model.bin', data: Buffer.from([0, 1, 2, 3]), kind: 'binary', mime: 'application/octet-stream' },
      { name: 'fake.txt', data: Buffer.from('%PDF-1.7\nfixture'), kind: 'pdf', mime: 'application/pdf' },
    ];
    for (const item of examples) {
      await fs.writeFile(path.join(conversation.cwd, item.name), item.data);
      const handle = await client.request('media.resolve', { conversationId: conversation.id, path: item.name });
      expect(handle).toMatchObject({ contentKind: item.kind, mimeType: item.mime, size: item.data.length });
      const response = await fetch(handle.url);
      expect(response.headers.get('content-type')).toBe(item.mime);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(item.data);
      const download = await fetch(`${handle.url}?download=1`);
      expect(download.headers.get('content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`);
      expect(Buffer.from(await download.arrayBuffer())).toEqual(item.data);
    }
    expect((await rejection(client.request('media.resolve', { conversationId: conversation.id, path: 'missing.abc' }))).code).toBe('not-found');
  });

  it('媒体地址只发给会话工作目录里的文件', async () => {
    const outside = path.join(dir, 'secret.txt');
    await fs.writeFile(outside, 'secret');
    const { conversation } = await client.request('conversations.create', {});
    await fs.writeFile(path.join(conversation.cwd, 'ok.txt'), 'ok');
    await fs.symlink(outside, path.join(conversation.cwd, 'link.txt'));

    const ok = await client.request('media.resolve', { conversationId: conversation.id, path: 'ok.txt' });
    expect(await (await fetch(ok.url)).text()).toBe('ok');
    expect((await rejection(client.request('media.resolve', { conversationId: conversation.id, path: '../../secret.txt' }))).code).toBe(
      'forbidden',
    );
    expect((await rejection(client.request('media.resolve', { conversationId: conversation.id, path: outside }))).code).toBe('forbidden');
    expect((await rejection(client.request('media.resolve', { conversationId: conversation.id, path: 'link.txt' }))).code).toBe(
      'forbidden',
    );
    expect((await rejection(client.request('media.resolve', { conversationId: conversation.id, path: 'nope.txt' }))).code).toBe(
      'not-found',
    );
    const mixed = await rejection(
      client.request('media.resolve', { entryId: 'sp_x', conversationId: conversation.id, path: 'ok.txt' } as never),
    );
    expect(mixed.code).toBe('invalid-request');
  });

  it('字幕：列出视频同目录的字幕文件，同名的在前；定位可以是项目里的路径', async () => {
    const project = path.join(dir, 'film');
    await fs.mkdir(path.join(project, 'clips'), { recursive: true });
    for (const name of ['talk.mp4', 'talk.en.vtt', 'talk.srt', 'talk.zh.vtt', 'other.ass', 'notes.txt', '.hidden.srt', 'talkshow.srt']) {
      await fs.writeFile(path.join(project, 'clips', name), name);
    }
    const { project: opened } = await client.request('projects.open', { path: project });

    const { tracks } = await client.request('media.subtitles', { projectId: opened.id, path: 'clips/talk.mp4' });
    expect(tracks.map((t) => [t.fileName, t.matched, t.tag])).toEqual([
      ['talk.srt', true, null],
      ['talk.en.vtt', true, 'en'],
      ['talk.zh.vtt', true, 'zh'],
      ['other.ass', false, null],
      ['talkshow.srt', false, null],
    ]);
    expect(tracks[2]!.target).toEqual({ projectId: opened.id, path: 'clips/talk.zh.vtt' });
    const handle = await client.request('media.resolve', tracks[2]!.target);
    expect(await (await fetch(handle.url)).text()).toBe('talk.zh.vtt');

    // 从 Space 条目来：字幕的定位落在条目的项目上。
    let space: SpaceSnapshot | null = null;
    client.subscribeSpace({
      snapshot: (snapshot) => {
        space = snapshot;
      },
      event: (event) => {
        if (space) space = applySpaceEvent(space, event);
      },
    });
    await client.request('space.rescan', {});
    const video = await until(() => space?.entries.find((e) => e.relPath === 'clips/talk.mp4'));
    const viaEntry = await client.request('media.subtitles', { entryId: video.id });
    expect(viaEntry.tracks[0]!.target).toEqual({ projectId: opened.id, path: 'clips/talk.srt' });

    const { conversation } = await client.request('conversations.create', { projectId: opened.id });
    const viaConversation = await client.request('media.subtitles', { conversationId: conversation.id, path: 'clips/talk.mp4' });
    expect(viaConversation.tracks[0]!.target).toEqual({ conversationId: conversation.id, path: 'clips/talk.srt' });

    await fs.writeFile(path.join(dir, 'outside.mp4'), 'x');
    expect((await rejection(client.request('media.subtitles', { projectId: opened.id, path: '../outside.mp4' }))).code).toBe('forbidden');
    expect((await rejection(client.request('media.subtitles', { projectId: 'proj_nope', path: 'clips/talk.mp4' }))).code).toBe('not-found');
  });

  it('偏好设置：默认值、整批校验、null 恢复默认；主题先给快照再送变化', async () => {
    let mirror: SettingsSnapshot | null = null;
    const events: SettingsEvent[] = [];
    client.subscribeSettings({
      snapshot: (snapshot) => {
        mirror = snapshot;
      },
      event: (event) => {
        events.push(event);
        if (mirror) mirror = applySettingsEvent(mirror, event);
      },
    });
    const initial = await until(() => mirror);
    expect(initial).toEqual({ settings: SETTING_DEFAULTS, defaults: SETTING_DEFAULTS });

    const all = await client.request('settings.get', {});
    expect(all.settings).toEqual(SETTING_DEFAULTS);
    const some = await client.request('settings.get', { keys: ['offline.strict'] });
    expect(some).toEqual({ settings: { 'offline.strict': false }, defaults: { 'offline.strict': false } });
    expect((await rejection(client.request('settings.get', { keys: ['nope' as 'offline.strict'] }))).code).toBe('invalid-request');

    // 一个坏值让整批都不生效，也不落盘。
    const settingsFile = path.join(dir, 'store', 'settings.json');
    const bad = await rejection(
      client.request('settings.set', { values: { 'offline.strict': true, 'agent.defaultAccessMode': 'nope' as 'plan' } }),
    );
    expect(bad.code).toBe('invalid-request');
    const unknown = await rejection(client.request('settings.set', { values: { 'openai.apiKey': 'sk-test' } as never }));
    expect(unknown.code).toBe('invalid-request');
    expect(fsSync.existsSync(settingsFile)).toBe(false);

    const updated = await client.request('settings.set', {
      values: { 'offline.strict': true, 'captions.maxLineLength': { cjk: 18, other: 40 } },
    });
    expect(updated.settings).toMatchObject({ 'offline.strict': true, 'captions.maxLineLength': { cjk: 18, other: 40 } });
    expect(updated.defaults).toEqual(SETTING_DEFAULTS);
    await until(() => events.length === 1);
    expect(events[0]).toEqual({
      type: 'settings.updated',
      changed: { 'offline.strict': true, 'captions.maxLineLength': { cjk: 18, other: 40 } },
    });

    // 没有变化的修改不发事件；null 恢复默认。
    await client.request('settings.set', { values: { 'offline.strict': true } });
    const reset = await client.request('settings.set', { values: { 'offline.strict': null } });
    expect(reset.settings['offline.strict']).toBe(false);
    await until(() => events.length === 2);
    expect(events[1]).toEqual({ type: 'settings.updated', changed: { 'offline.strict': false } });
    expect(mirror).toEqual(reset);
  });

  it('偏好设置：重启后保留', async () => {
    await client.request('settings.set', { values: { 'updates.autoCheck': false, 'downloads.directory': '/tmp/baocut-downloads' } });
    client.close();
    await runtime.close();
    runtime = await startRuntime({ home: resolveRuntimeHome({ BAOCUT_HOME: dir }), drivers: () => [driver], watchSpace: false });
    client = await connect();
    const { settings } = await client.request('settings.get', { keys: ['updates.autoCheck', 'downloads.directory', 'offline.strict'] });
    expect(settings).toEqual({ 'updates.autoCheck': false, 'downloads.directory': '/tmp/baocut-downloads', 'offline.strict': false });
  });

  it('存着旧访问模式的会话记录：重启后会话的模式与任务卡片上的模式换成新值', async () => {
    const { conversation } = await client.request('conversations.create', {});
    const { taskId } = await client.request('conversations.send', {
      conversationId: conversation.id,
      text: 'hello',
      commandId: newId('cmd'),
    });
    await until(() => runtime.harness.getConversation(conversation.id).conversation.activity === 'idle');
    client.close();
    await runtime.close();

    // 旧版本写下的记录：会话上是旧值，任务卡片上也是旧值。
    const conversationsDir = resolveRuntimeHome({ BAOCUT_HOME: dir }).conversationsDir;
    const file = (await fs.readdir(conversationsDir)).find((name) => name.includes(conversation.id))!;
    const record = JSON.parse(await fs.readFile(path.join(conversationsDir, file), 'utf8'));
    record.conversation.accessMode = 'authorized';
    for (const item of record.items) if (item.kind === 'task') item.autonomy = { mode: 'controlled', source: 'request' };
    await fs.writeFile(path.join(conversationsDir, file), JSON.stringify(record));

    runtime = await startRuntime({ home: resolveRuntimeHome({ BAOCUT_HOME: dir }), drivers: () => [driver], watchSpace: false });
    client = await connect();
    const loaded = await client.request('conversations.get', { conversationId: conversation.id });
    expect(loaded.conversation.accessMode).toBe('fullAccess');
    expect(loaded.items.find((i) => i.id === taskId)).toMatchObject({ autonomy: { mode: 'ask', source: 'request' } });
    expect(runtime.harness.conversationMode(conversation.id)).toBe('fullAccess');
  });

  it('新会话读默认 Driver：设的引擎没有注册时拒绝创建', async () => {
    await client.request('settings.set', { values: { 'agent.defaultDriver': 'claude' } });
    expect((await rejection(client.request('conversations.create', {}))).code).toBe('driver-unavailable');
    expect(runtime.harness.directorySnapshot().conversations).toHaveLength(0);

    await client.request('settings.set', { values: { 'agent.defaultDriver': 'codex' } });
    const { conversation } = await client.request('conversations.create', {});
    expect(conversation.driverId).toBe('codex');
  });

  it('未经集成测试的 Driver（D08）：可以选，但发送被拒绝，不开原生会话', async () => {
    client.close();
    await runtime.close();
    const created: CreateSessionOptions[] = [];
    const gemini: AgentDriver = {
      id: 'gemini',
      verified: false,
      probe: async () => ({ ...fakeProbe(capabilities), id: 'gemini', name: 'Gemini CLI', verified: false }),
      createSession: async (options) => {
        created.push(options);
        return new FakeSession();
      },
    };
    runtime = await startRuntime({ home: resolveRuntimeHome({ BAOCUT_HOME: dir }), drivers: () => [driver, gemini], watchSpace: false });
    client = await connect();
    await client.request('settings.set', { values: { 'agent.defaultDriver': 'gemini' } });
    const { conversation } = await client.request('conversations.create', {});
    expect(conversation.driverId).toBe('gemini');
    const error = await rejection(
      client.request('conversations.send', { conversationId: conversation.id, text: 'hello', commandId: newId('cmd') }),
    );
    expect(error.code).toBe('driver-unavailable');
    expect(error.message).toContain('Gemini CLI');
    expect(created).toEqual([]);
  });

  it('新任务读默认访问模式并记下来源；发送时显式给出的优先，并切换会话的模式', async () => {
    const { conversation } = await client.request('conversations.create', {});
    expect(conversation.accessMode).toBeNull();
    const taskOf = (taskId: Id) => runtime.harness.getConversation(conversation.id).items.find((i) => i.id === taskId);
    const idle = () => until(() => runtime.harness.getConversation(conversation.id).conversation.activity === 'idle');

    const first = await client.request('conversations.send', { conversationId: conversation.id, text: 'hello', commandId: newId('cmd') });
    expect(taskOf(first.taskId)).toMatchObject({ autonomy: { mode: 'auto', source: 'default' } });
    await idle();

    // 旧值 authorized 按 fullAccess 存；会话没有切换过，跟着设置走。命令自动放行，回合照常完成。
    await client.request('settings.set', { values: { 'agent.defaultAccessMode': 'authorized' } });
    const second = await client.request('conversations.send', {
      conversationId: conversation.id,
      text: 'approve',
      commandId: newId('cmd'),
    });
    expect(taskOf(second.taskId)).toMatchObject({ autonomy: { mode: 'fullAccess', source: 'setting' } });
    expect(runtime.harness.agentRun(conversation.id)).toMatchObject({ mode: 'fullAccess', autonomy: 'fullAccess' });
    await until(() => driver.sessions.at(-1)?.turnModes.at(-1) === 'fullAccess');
    await idle();
    expect(runtime.harness.getConversation(conversation.id).items.find((i) => i.kind === 'approval')).toMatchObject({
      status: 'accepted',
      decidedBy: 'auto',
      mode: 'fullAccess',
      risk: 'command',
    });

    // 发送时给出模式（这里是旧字段 autonomy）：会话切到 plan，记一条提示；之后不给时沿用会话的模式。
    const third = await client.request('conversations.send', {
      conversationId: conversation.id,
      text: 'hello',
      commandId: newId('cmd'),
      autonomy: 'plan',
    });
    expect(taskOf(third.taskId)).toMatchObject({ autonomy: { mode: 'plan', source: 'request' } });
    expect(runtime.harness.getConversation(conversation.id).conversation.accessMode).toBe('plan');
    expect(runtime.harness.getConversation(conversation.id).items.find((i) => i.kind === 'notice')).toMatchObject({
      modeChange: { from: 'fullAccess', to: 'plan' },
    });
    await idle();

    const fourth = await client.request('conversations.send', { conversationId: conversation.id, text: 'hello', commandId: newId('cmd') });
    expect(taskOf(fourth.taskId)).toMatchObject({ autonomy: { mode: 'plan', source: 'conversation' } });
    await idle();

    // 旧值 controlled 即 ask。
    const fifth = await client.request('conversations.send', {
      conversationId: conversation.id,
      text: 'hello',
      commandId: newId('cmd'),
      autonomy: 'controlled',
    });
    expect(taskOf(fifth.taskId)).toMatchObject({ autonomy: { mode: 'ask', source: 'request' } });
    await idle();

    // conversations.update 给 null：回到跟随设置。
    const { conversation: back } = await client.request('conversations.update', { conversationId: conversation.id, accessMode: null });
    expect(back.accessMode).toBeNull();
    expect(runtime.harness.conversationMode(conversation.id)).toBe('fullAccess');
  });
});

describe('Runtime 启动失败', () => {
  let dir: string;
  let home: RuntimeHome;
  let blocker: net.Server | null = null;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-test-'));
    home = resolveRuntimeHome({ BAOCUT_HOME: dir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const server = blocker;
    blocker = null;
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 占住一个回环端口，返回端口号。 */
  async function occupyPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    blocker = server;
    return (server.address() as net.AddressInfo).port;
  }

  function boot(options: Partial<StartRuntimeOptions> = {}): Promise<RunningRuntime> {
    return startRuntime({
      home,
      drivers: () => [new FakeDriver()],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
      initiator: { discoverer: null },
      ...options,
      nodes: { host: '127.0.0.1', advertiser: null, ...options.nodes },
    });
  }

  /** 期限内没落定就算失败：修复前网关端口被占时启动永远挂着。 */
  async function startupError(promise: Promise<RunningRuntime>, ms = 3_000): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`启动在 ${ms} 毫秒内没有落定`)), ms);
    });
    let started: RunningRuntime;
    try {
      started = await Promise.race([promise, timeout]);
    } catch (error) {
      return error;
    } finally {
      clearTimeout(timer);
    }
    await started.close();
    throw new Error('启动应该失败');
  }

  it('网关端口被占用：启动带着原始错误失败，不写发现文件、释放实例锁；换个端口再启动就好', async () => {
    const taken = await occupyPort();
    const error = await startupError(boot({ host: '127.0.0.1', port: taken }));
    expect(error).toMatchObject({ code: 'EADDRINUSE' });
    expect((error as Error).message).toContain(String(taken));
    expect(await readDiscovery(home)).toBeNull();
    expect(await fs.readFile(path.join(home.logsDir, 'runtime.log'), 'utf8')).toContain('Runtime failed to start');

    const runtime = await boot({ host: '127.0.0.1', port: 0 });
    try {
      expect((await readDiscovery(home))?.instanceId).toBe(runtime.info.instanceId);
    } finally {
      await runtime.close();
    }
  });

  /** 记下各个服务的停止方法被调用的顺序（照常执行原方法）。 */
  function recordStops(): string[] {
    const calls: string[] = [];
    const track = (name: string, proto: object, method: string) => {
      const original = (proto as Record<string, (...args: unknown[]) => unknown>)[method]!;
      vi.spyOn(proto as Record<string, (...args: unknown[]) => unknown>, method).mockImplementation(function (this: unknown, ...args) {
        calls.push(name);
        return original.apply(this, args);
      });
    };
    track('services', ServiceManager.prototype, 'close');
    track('nodes', NodeService.prototype, 'close');
    track('jobs', JobManager.prototype, 'shutdown');
    track('initiator', NodeInitiator.prototype, 'close');
    track('space', SpaceCatalog.prototype, 'close');
    track('analysis', MediaAnalysis.prototype, 'close');
    track('videos', VideoService.prototype, 'shutdown');
    track('harness', Harness.prototype, 'shutdown');
    track('gateway', Gateway.prototype, 'close');
    return calls;
  }

  /** 记下 Space 开的目录监视（它们不阻止进程退出，`getActiveResourcesInfo` 里看不到），返回还没关的那些。 */
  function trackWatchers(): { opened: () => number; open: Set<fsSync.FSWatcher> } {
    const open = new Set<fsSync.FSWatcher>();
    let opened = 0;
    const original = fsSync.watch;
    vi.spyOn(fsSync, 'watch').mockImplementation(((...args: Parameters<typeof fsSync.watch>) => {
      const watcher = original(...args);
      opened++;
      open.add(watcher);
      const close = watcher.close.bind(watcher);
      watcher.close = () => {
        open.delete(watcher);
        close();
      };
      return watcher;
    }) as typeof fsSync.watch);
    return { opened: () => opened, open };
  }

  /** 本进程的子进程（引擎、Model Worker 等）。 */
  async function childProcesses(): Promise<string[]> {
    try {
      const { stdout } = await promisify(execFile)('pgrep', ['-P', String(process.pid)]);
      return stdout.split('\n').filter(Boolean);
    } catch (error) {
      // pgrep 没找到时退出码是 1。
      if ((error as { code?: number }).code === 1) return [];
      throw error;
    }
  }

  async function portFree(port: number): Promise<boolean> {
    const probe = net.createServer();
    return new Promise((resolve) => {
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
  }

  async function freePort(): Promise<number> {
    const probe = net.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));
    return port;
  }

  /** 准备一个开着共享（节点服务监听 `sharePort`）、有一个项目目录的 Runtime Home。 */
  async function prepareHome(): Promise<{ sharePort: number }> {
    const sharePort = await freePort();
    const runtime = await boot();
    await runtime.harness.createProject({ name: '短片' });
    await runtime.nodes.start({ port: sharePort });
    expect(runtime.nodes.port).toBe(sharePort);
    await runtime.close();
    return { sharePort };
  }

  const STARTED_STOPS = ['services', 'nodes', 'jobs', 'initiator', 'space', 'analysis', 'videos', 'harness', 'gateway'];

  it('正常停止的顺序：对外服务、节点服务、任务、发起端、Space、媒体分析、视频引擎、Harness、网关', async () => {
    await prepareHome();
    const runtime = await boot({ watchSpace: true });
    const calls = recordStops();
    await runtime.close();
    expect(calls).toEqual(STARTED_STOPS);
  });

  it('启动最后一步失败（网关端口被占）：已经起来的服务按停止顺序全部停掉，抛出原来的错误', async () => {
    const { sharePort } = await prepareHome();
    const taken = await occupyPort();
    const watchers = trackWatchers();
    const calls = recordStops();

    const error = await startupError(boot({ host: '127.0.0.1', port: taken, watchSpace: true }));
    expect(error).toMatchObject({ code: 'EADDRINUSE' });
    expect(calls).toEqual(STARTED_STOPS);
    // Space 确实开过目录监视，失败后都关了。
    expect(watchers.opened()).toBeGreaterThan(0);
    expect(watchers.open.size).toBe(0);
    expect(await portFree(sharePort)).toBe(true);
    expect(await childProcesses()).toEqual([]);
    expect(await readDiscovery(home)).toBeNull();

    vi.restoreAllMocks();
    const runtime = await boot({ watchSpace: true });
    try {
      expect(runtime.nodes.port).toBe(sharePort);
    } finally {
      await runtime.close();
    }
  });

  it('启动中途失败（Space 标记文件损坏）：已经起来的服务停掉，没起来的不碰', async () => {
    const { sharePort } = await prepareHome();
    await fs.writeFile(home.spaceFile, '{ 损坏');
    const calls = recordStops();

    const error = await startupError(boot({ watchSpace: true }));
    expect(error).toBeInstanceOf(SyntaxError);
    expect(calls).toEqual(['services', 'nodes', 'jobs', 'initiator', 'analysis', 'videos', 'harness']);
    expect(await portFree(sharePort)).toBe(true);
    expect(await childProcesses()).toEqual([]);
    expect(await readDiscovery(home)).toBeNull();

    vi.restoreAllMocks();
    await fs.rm(home.spaceFile);
    const runtime = await boot();
    await runtime.close();
  });

  it('停止某一步出错：后面的步骤照常执行，抛出的仍是启动失败的原始错误', async () => {
    const { sharePort } = await prepareHome();
    const taken = await occupyPort();
    const shutdown = Harness.prototype.shutdown;
    const calls = recordStops();
    vi.spyOn(Harness.prototype, 'shutdown').mockImplementation(async function (this: Harness) {
      calls.push('harness');
      await shutdown.call(this);
      throw new Error('Harness 停不下来');
    });

    const error = await startupError(boot({ host: '127.0.0.1', port: taken }));
    expect(error).toMatchObject({ code: 'EADDRINUSE' });
    expect(calls).toEqual(STARTED_STOPS);
    expect(await portFree(sharePort)).toBe(true);
    expect(await fs.readFile(path.join(home.logsDir, 'runtime.log'), 'utf8')).toContain('Stopping the Harness failed');

    vi.restoreAllMocks();
    const runtime = await boot();
    await runtime.close();
  });
});

describe('CLI 拉起的 Runtime（§2.2）', () => {
  let dir: string;
  let home: RuntimeHome;
  let runtime: RunningRuntime | null = null;
  const clients: BaoCutClient[] = [];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-test-'));
    home = resolveRuntimeHome({ BAOCUT_HOME: dir });
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await runtime?.close();
    runtime = null;
    await fs.rm(dir, { recursive: true, force: true });
  });

  function boot(options: Partial<StartRuntimeOptions>): Promise<RunningRuntime> {
    return startRuntime({
      home,
      drivers: () => [new FakeDriver()],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      launchedBy: 'cli',
      ...options,
    });
  }

  async function connect(kind: 'cli' | 'desktop'): Promise<BaoCutClient> {
    const { endpoint, token } = runtime!.discovery;
    const client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind, name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    clients.push(client);
    return client;
  }

  /** 断开在服务端落定（连接数变了）之后再往下走。 */
  async function connectionsSettle(client: BaoCutClient, done: (c: { desktop: number; cli: number }) => boolean): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!done((await client.request('runtime.status', {})).connections)) {
      if (Date.now() > deadline) throw new Error('等待超时');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it('runtime.stop：调用者之外还有 CLI 或桌面端连着时 RUNTIME_IN_USE，只剩自己时停', async () => {
    const requestStop = vi.fn();
    runtime = await boot({ requestStop });
    const caller = await connect('cli');
    const other = await connect('cli');

    const busy = await caller.request('runtime.stop', {}).catch((error: unknown) => error);
    expect(busy).toBeInstanceOf(RpcError);
    expect((busy as RpcError).details).toMatchObject({ code: 'RUNTIME_IN_USE', cli: 1, desktop: 0, activeJobs: 0 });

    other.close();
    await connectionsSettle(caller, (c) => c.cli === 1);
    const desktop = await connect('desktop');
    const withDesktop = await caller.request('runtime.stop', {}).catch((error: unknown) => error);
    expect((withDesktop as RpcError).details).toMatchObject({ code: 'RUNTIME_IN_USE', desktop: 1, cli: 0 });

    desktop.close();
    await connectionsSettle(caller, (c) => c.desktop === 0);
    await expect(caller.request('runtime.stop', {})).resolves.toEqual({ stopping: true });
    await until(() => requestStop.mock.calls.length === 1);
  });

  it('空闲退出：先删发现文件，再交给入口去停', async () => {
    let now = Date.parse('2026-10-06T00:00:00Z');
    let discoveryAtIdle: unknown = 'not-called';
    const onIdle = vi.fn(() => {
      discoveryAtIdle = fsSync.existsSync(home.discoveryFile);
    });
    runtime = await boot({ idleExit: { onIdle, checkMs: 10, now: () => now } });
    expect(fsSync.existsSync(home.discoveryFile)).toBe(true);
    now += 11 * 60_000;
    await until(() => onIdle.mock.calls.length === 1);
    expect(discoveryAtIdle).toBe(false);
  });
});
