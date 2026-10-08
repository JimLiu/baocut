import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentMode } from '@baocut/protocol';
import { silentLogger, type AgentEvent, type AgentItem, type CreateSessionOptions, type Logger, type TurnSettings } from '@baocut/harness';
import type { PermissionResult, SDKAssistantMessageError, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createFakeClaude, createFakeClaudeCli, type FakeClaude } from '../testing/fake-claude.ts';
import type { ClaudeInstall } from './claude-binary.ts';
import { ClaudeDriver } from './claude-driver.ts';
import { ASK_USER_QUESTION_DENIAL, ClaudeSession, approvalRequest, claudeMcpServers, claudePermissionMode } from './claude-session.ts';

/**
 * Claude 会话对着假 Query（`testing/fake-claude.ts`）：不起 claude 进程、不联网、不花额度。
 * 与真实 CLI 的差别（消息的确切形状、中断后是否一定发 result 等）见 claude-session.ts 里标「未验证」的注释。
 */

async function until<T>(read: () => T | undefined | null | false, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const INSTALL: ClaudeInstall = { command: '/fake/bin/claude', version: '2.1.284', env: { PATH: '/usr/bin:/bin' } };

type Event<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>;

function settings(patch: Partial<TurnSettings> = {}): TurnSettings {
  return { accessMode: 'ask', model: null, effort: null, ...patch };
}

function open(fake: FakeClaude, options: Partial<CreateSessionOptions> = {}, log: Logger = silentLogger) {
  const session = new ClaudeSession(
    INSTALL,
    { cwd: '/work', accessMode: 'ask', model: null, effort: null, resume: null, ...options },
    log,
    fake.factory,
  );
  const events: AgentEvent[] = [];
  session.subscribe((event) => events.push(event));
  const of = <T extends AgentEvent['type']>(type: T) => events.filter((e): e is Event<T> => e.type === type);
  return {
    session,
    events,
    of,
    completed: (turnId: string) => until(() => of('turn.completed').find((e) => e.turnId === turnId)),
    /** 第 n 个（从 0 起）审批请求。 */
    approval: (n = 0) => until(() => of('approval.requested')[n]),
    items: () => of('item.completed').map((e) => e.item),
  };
}

type ToolItem = Extract<AgentItem, { kind: 'tool-call' }>;

let sessions: ClaudeSession[] = [];
function track<T extends { session: ClaudeSession }>(opened: T): T {
  sessions.push(opened.session);
  return opened;
}

afterEach(async () => {
  for (const session of sessions) await session.close();
  sessions = [];
});

describe('ClaudeSession：回合与条目', () => {
  it('文字回合：流式 delta 与完成的条目同一个 id；Query 的选项；第二轮复用同一个 Query', async () => {
    const fake = createFakeClaude({
      sessionId: 'sess-1',
      turn: (t) => {
        t.thinking('想一想');
        t.text('你好，世界');
        t.result();
      },
    });
    const s = track(open(fake, { developerInstructions: '你在 BaoCut 里剪视频。' }));
    expect(s.session.describePersistence()).toBeNull();
    expect(fake.queries).toHaveLength(0);

    const { turnId } = await s.session.startTurn({ text: '你好' }, settings());
    expect(await s.completed(turnId)).toMatchObject({ outcome: 'completed', error: null, errorCode: null });
    expect(s.events[0]).toEqual({ type: 'turn.started', turnId });

    const [reasoning, message] = s.items();
    expect(reasoning).toMatchObject({ kind: 'reasoning', text: '想一想' });
    expect(message).toMatchObject({ kind: 'agent-message', text: '你好，世界' });
    expect(reasoning!.id).not.toBe(message!.id);
    const deltas = s.of('item.delta');
    expect(deltas.filter((d) => d.itemId === message!.id && d.channel === 'text').map((d) => d.delta).join('')).toBe('你好，世界');
    expect(deltas.filter((d) => d.itemId === reasoning!.id && d.channel === 'reasoning').map((d) => d.delta).join('')).toBe('想一想');
    expect(deltas.every((d) => d.turnId === turnId)).toBe(true);

    const query = fake.last();
    expect(query.options).toMatchObject({
      pathToClaudeCodeExecutable: '/fake/bin/claude',
      cwd: '/work',
      // 只加载 user 层；hooks 关掉，user 层的权限规则不生效（见 claudeSettingsOptions）。
      settingSources: ['user'],
      settings: { disableAllHooks: true },
      managedSettings: { allowManagedPermissionRulesOnly: true },
      systemPrompt: { type: 'preset', preset: 'claude_code', append: '你在 BaoCut 里剪视频。' },
      permissionMode: 'default',
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
    });
    // 子进程的环境就是 install.env（agentEnv() 的结果，去掉了宿主 Claude Code 的会话变量）。
    expect(query.options.env).toBe(INSTALL.env);
    for (const key of ['model', 'effort', 'resume', 'mcpServers', 'allowedTools', 'sandbox']) expect(query.options).not.toHaveProperty(key);
    expect(query.inputs[0]).toMatchObject({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: '你好' }] } });
    expect(query.inputs[0]!.priority).toBeUndefined();
    expect(s.session.describePersistence()).toEqual({ driverId: 'claude', data: { sessionId: 'sess-1' } });

    const second = await s.session.startTurn({ text: '再来' }, settings());
    expect(await s.completed(second.turnId)).toMatchObject({ outcome: 'completed' });
    expect(fake.queries).toHaveLength(1);
    expect(query.inputs).toHaveLength(2);
  });

  it('上一轮没结束时不能开新的一轮', async () => {
    const fake = createFakeClaude({ turn: () => new Promise(() => {}) });
    const s = track(open(fake));
    await s.session.startTurn({ text: '一' }, settings());
    await expect(s.session.startTurn({ text: '二' }, settings())).rejects.toThrow(/还没有结束/);
  });

  it('工具调用：命令成功记退出码 0，失败从「Exit code N」取；读文件的标题带工具名；改文件的输出是 diff', async () => {
    const fake = createFakeClaude({
      turn: (t) => {
        const ok = t.toolUse('Bash', { command: 'npm test', description: '跑测试' });
        t.toolResult(ok, 'all passed');
        const bad = t.toolUse('Bash', { command: 'false' });
        t.toolResult(bad, 'Exit code 2\nboom', true);
        const read = t.toolUse('Read', { file_path: '/work/a.ts' });
        t.toolResult(read, [{ type: 'text', text: '文件内容' }] as unknown as string);
        const edit = t.toolUse('Edit', { file_path: '/work/a.ts', old_string: 'a', new_string: 'b' });
        t.toolResult(edit, 'ok');
        t.result();
      },
    });
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: '跑一下' }, settings());
    await s.completed(turnId);

    const started = s.of('item.started').map((e) => e.item as ToolItem);
    expect(started.map((i) => [i.tool, i.title, i.detail, i.status])).toEqual([
      ['command', 'npm test', '跑测试', 'running'],
      ['command', 'false', null, 'running'],
      ['other', 'Read /work/a.ts', null, 'running'],
      ['file-change', '/work/a.ts', 'Edit /work/a.ts', 'running'],
    ]);
    const done = s.items() as ToolItem[];
    expect(done.map((i) => [i.id, i.status, i.exitCode, i.output])).toEqual([
      [started[0]!.id, 'completed', 0, 'all passed'],
      [started[1]!.id, 'failed', 2, 'Exit code 2\nboom'],
      [started[2]!.id, 'completed', null, '文件内容'],
      // 改文件的工具：output 是从输入合成的 diff，路径相对会话的 cwd。
      [started[3]!.id, 'completed', null, '--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +0,0 @@\n-a\n+b'],
    ]);
    expect(done.every((i) => typeof i.durationMs === 'number')).toBe(true);
  });

  it('子智能体的帧不进时间线', async () => {
    const fake = createFakeClaude({
      turn: (t) => {
        t.emit({
          type: 'assistant',
          message: { id: 'sub', role: 'assistant', content: [{ type: 'text', text: '子智能体的话' }] },
          parent_tool_use_id: 'toolu_task',
          session_id: t.query.sessionId,
        } as unknown as SDKMessage);
        t.text('主回复');
        t.result();
      },
    });
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'x' }, settings());
    await s.completed(turnId);
    expect(s.items().map((i) => (i.kind === 'agent-message' ? i.text : i.kind))).toEqual(['主回复']);
  });
});

describe('ClaudeSession：审批', () => {
  /** 每次 ask 的答复按顺序记下。 */
  function asking(commands: Array<{ name: string; input: Record<string, unknown> }>) {
    const answers: Array<PermissionResult | null> = [];
    const fake = createFakeClaude({
      turn: async (t) => {
        for (const { name, input } of commands) {
          const id = t.toolUse(name, input);
          const answer = await t.ask(name, input, id);
          answers.push(answer);
          if (answer?.behavior === 'allow') t.toolResult(id, 'ok');
          else t.toolResult(id, answer?.message ?? 'denied', true);
        }
        t.result();
      },
    });
    return { fake, answers };
  }

  it('命令：请求的形状；accept 放行且原样带回输入，decline 拒绝且条目记为 declined', async () => {
    const input = { command: 'npm install', description: '安装依赖' };
    const { fake, answers } = asking([{ name: 'Bash', input }]);
    const s = track(open(fake));

    const first = await s.session.startTurn({ text: '装依赖' }, settings());
    const request = await s.approval(0);
    expect(request).toMatchObject({
      turnId: first.turnId,
      request: { kind: 'command', command: 'npm install', cwd: '/work', reason: '安装依赖', rule: 'npm install' },
    });
    await s.session.respondToApproval(request.approvalId, { decision: 'accept' });
    expect(await s.completed(first.turnId)).toMatchObject({ outcome: 'completed' });
    expect(answers[0]).toEqual({ behavior: 'allow', updatedInput: input });
    expect((s.items()[0] as ToolItem).status).toBe('completed');

    const second = await s.session.startTurn({ text: '再装一次' }, settings());
    const again = await s.approval(1);
    await s.session.respondToApproval(again.approvalId, { decision: 'decline' });
    expect(await s.completed(second.turnId)).toMatchObject({ outcome: 'completed' });
    expect(answers[1]).toMatchObject({ behavior: 'deny' });
    expect(answers[1]).not.toHaveProperty('interrupt');
    const declined = s.items()[1] as ToolItem;
    expect([declined.status, declined.exitCode]).toEqual(['declined', null]);
    // 同一个审批答两次：第二次无效。
    await s.session.respondToApproval(again.approvalId, { decision: 'accept' });
  });

  it('本会话允许：同一条规则不再问，不同的命令照样问', async () => {
    const { fake, answers } = asking([
      { name: 'Bash', input: { command: 'npm install' } },
      { name: 'Bash', input: { command: 'npm install lodash' } },
      { name: 'Bash', input: { command: 'git status' } },
    ]);
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    await s.session.respondToApproval((await s.approval(0)).approvalId, { decision: 'accept-for-session' });
    const next = await s.approval(1);
    expect(next.request).toMatchObject({ kind: 'command', command: 'git status' });
    await s.session.respondToApproval(next.approvalId, { decision: 'accept' });
    await s.completed(turnId);
    expect(s.of('approval.requested')).toHaveLength(2);
    expect(answers.map((a) => a?.behavior)).toEqual(['allow', 'allow', 'allow']);
  });

  it('总是允许：只在会话里放行，绝不回传 updatedPermissions（不写 Claude 的设置文件）', async () => {
    const { fake, answers } = asking([
      { name: 'WebFetch', input: { url: 'https://example.com/a', prompt: '读一下' } },
      { name: 'WebFetch', input: { url: 'https://example.com/b', prompt: '再读' } },
    ]);
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    await s.session.respondToApproval((await s.approval(0)).approvalId, { decision: 'accept-always' });
    await s.completed(turnId);
    expect(s.of('approval.requested')).toHaveLength(1);
    for (const answer of answers) {
      expect(answer).toMatchObject({ behavior: 'allow' });
      expect(answer).not.toHaveProperty('updatedPermissions');
    }
  });

  it('文件修改、Agent 自带工具、其他 MCP 工具的请求形状', async () => {
    const { fake } = asking([
      { name: 'Write', input: { file_path: '/work/out.txt', content: 'x' } },
      { name: 'WebFetch', input: { url: 'https://example.com', prompt: '读一下' } },
      { name: 'mcp__github__create_issue', input: { title: 'Bug' } },
    ]);
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    const requests = [];
    for (let n = 0; n < 3; n++) {
      const request = await s.approval(n);
      requests.push(request.request);
      await s.session.respondToApproval(request.approvalId, { decision: 'accept' });
    }
    await s.completed(turnId);
    expect(requests).toEqual([
      { kind: 'file-change', reason: null, files: ['/work/out.txt'], rule: null },
      { kind: 'tool', tool: 'WebFetch', server: null, reason: 'https://example.com', files: [], rule: 'WebFetch' },
      { kind: 'tool', tool: 'create_issue', server: 'github', reason: 'github.create_issue', files: [], rule: 'mcp__github__create_issue' },
    ]);
  });

  it('AskUserQuestion：不弹审批卡，直接拒绝并让 Claude 用文字问；时间线上记为 declined，带着问题与选项', async () => {
    const input = {
      questions: [
        {
          question: 'Which aspect ratio should the export use?',
          header: 'Ratio',
          options: [
            { label: '16:9', description: 'Landscape' },
            { label: '9:16', description: 'Vertical' },
          ],
          multiSelect: false,
        },
      ],
    };
    const { fake, answers } = asking([{ name: 'AskUserQuestion', input }]);
    for (const accessMode of ['ask', 'fullAccess'] as AgentMode[]) {
      const s = track(open(fake));
      const { turnId } = await s.session.startTurn({ text: 'go' }, settings({ accessMode }));
      await s.completed(turnId);
      expect(s.of('approval.requested')).toEqual([]);
      const step = s.items().find((i): i is ToolItem => i.kind === 'tool-call')!;
      expect(step).toMatchObject({
        title: 'AskUserQuestion Which aspect ratio should the export use?',
        detail: 'Which aspect ratio should the export use?\n  - 16:9 — Landscape\n  - 9:16 — Vertical',
        status: 'declined',
      });
    }
    expect(answers).toEqual([
      { behavior: 'deny', message: ASK_USER_QUESTION_DENIAL },
      { behavior: 'deny', message: ASK_USER_QUESTION_DENIAL },
    ]);
  });

  it('ExitPlanMode：审批带计划全文、不给总是允许、不记会话级放行；在先给方案下批准后提示切换访问模式', async () => {
    const plan = '# 方案\n\n1. 剪掉开头的静音\n2. 加字幕';
    const { fake, answers } = asking([
      { name: 'ExitPlanMode', input: { plan } },
      { name: 'ExitPlanMode', input: { plan } },
    ]);
    const s = track(open(fake, { accessMode: 'plan' }));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings({ accessMode: 'plan' }));
    const first = await s.approval(0);
    expect(first.request).toEqual({ kind: 'tool', tool: 'ExitPlanMode', server: null, reason: plan, files: [], rule: null });
    await s.session.respondToApproval(first.approvalId, { decision: 'accept-for-session' });
    // 会话级放行对它不生效：下一个计划照样要问。
    const second = await s.approval(1);
    await s.session.respondToApproval(second.approvalId, { decision: 'decline' });
    await s.completed(turnId);
    expect(answers.map((a) => a?.behavior)).toEqual(['allow', 'deny']);
    expect(s.of('session.warning')).toHaveLength(1);
    expect(s.of('session.warning')[0]!.message).toMatch(/退出计划模式.*「先给方案」.*「自动接受修改」/);
    // 时间线上那一步的 detail 是计划全文。
    const steps = s.items().filter((i): i is ToolItem => i.kind === 'tool-call');
    expect(steps[0]).toMatchObject({ detail: plan, status: 'completed' });

    // 会话不在先给方案（Claude 自己进过计划模式）时批准不提示。
    const other = createFakeClaude({
      turn: async (t) => {
        const id = t.toolUse('ExitPlanMode', { plan });
        await t.ask('ExitPlanMode', { plan }, id);
        t.toolResult(id, 'ok');
        t.result();
      },
    });
    const o = track(open(other));
    const run = await o.session.startTurn({ text: 'go' }, settings({ accessMode: 'ask' }));
    await o.session.respondToApproval((await o.approval(0)).approvalId, { decision: 'accept' });
    await o.completed(run.turnId);
    expect(o.of('session.warning')).toEqual([]);
  });

  it('approvalRequest：越界路径并进文件列表，decisionReason 作为理由；复合命令没有规则，只按原文放行', () => {
    const signal = new AbortController().signal;
    expect(
      approvalRequest('Edit', { file_path: '/work/a.ts' }, { signal, toolUseID: 't', requestId: 'r', blockedPath: '/etc/hosts', decisionReason: '路径在工作目录之外' }, '/work'),
    ).toEqual({ request: { kind: 'file-change', reason: '路径在工作目录之外', files: ['/work/a.ts', '/etc/hosts'], rule: null }, grantKey: 'file-change' });
    const compound = approvalRequest('Bash', { command: 'npm install > log.txt' }, { signal, toolUseID: 't', requestId: 'r' }, '/work');
    if (compound.request.kind !== 'command') throw new Error('应是命令');
    // 规则算法归 approval-rule.ts：认不出规则时，「本会话允许」只放行一模一样的命令。
    expect(compound.grantKey).toBe(`command:${compound.request.rule ?? 'npm install > log.txt'}`);
  });

  it('BaoCut 自己的工具预先放行：allowedTools 与 canUseTool 都不拦；mcpServers 转成 http 配置；令牌不进日志', async () => {
    const lines: string[] = [];
    const recording: Logger = {
      debug: (m, f) => lines.push(m + JSON.stringify(f ?? {})),
      info: (m, f) => lines.push(m + JSON.stringify(f ?? {})),
      warn: (m, f) => lines.push(m + JSON.stringify(f ?? {})),
      error: (m, f) => lines.push(m + JSON.stringify(f ?? {})),
      child: () => recording,
    };
    const answers: Array<PermissionResult | null> = [];
    const fake = createFakeClaude({
      turn: async (t) => {
        answers.push(await t.ask('mcp__baocut__timeline_apply', { ops: [] }));
        t.result();
      },
    });
    const mcpServers = { baocut: { url: 'http://127.0.0.1:4100/mcp', headers: { Authorization: 'Bearer secret-token' } } };
    const s = track(open(fake, { mcpServers }, recording));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings({ effort: 'turbo' }));
    await s.completed(turnId);
    expect(answers).toEqual([{ behavior: 'allow', updatedInput: { ops: [] } }]);
    expect(s.of('approval.requested')).toHaveLength(0);
    expect(fake.last().options).toMatchObject({
      mcpServers: {
        baocut: { type: 'http', url: 'http://127.0.0.1:4100/mcp', headers: { Authorization: 'Bearer secret-token' }, timeout: 86_400_000 },
      },
      allowedTools: ['mcp__baocut__*'],
    });
    expect(claudeMcpServers(mcpServers)).toEqual(fake.last().options.mcpServers);
    await s.session.close();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('secret-token');
  });
});

describe('ClaudeSession：中断与插话', () => {
  it('中断：挂着的审批结清，Query 收到 interrupt，回合记为 interrupted；不在跑时 not-running', async () => {
    const answers: Array<PermissionResult | null> = [];
    const fake = createFakeClaude({
      turn: async (t) => {
        const id = t.toolUse('Bash', { command: 'sleep 100' });
        answers.push(await t.ask('Bash', { command: 'sleep 100' }, id));
        await t.interrupted();
        t.toolResult(id, 'Interrupted by user', true);
        t.result({ subtype: 'error_during_execution', terminal_reason: 'aborted_tools' });
      },
    });
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    const request = await s.approval(0);
    expect(await s.session.interrupt('turn_other')).toEqual({ status: 'not-running' });
    expect(await s.session.interrupt(turnId)).toEqual({ status: 'requested' });
    expect(fake.last().callsOf('interrupt')).toHaveLength(1);
    expect(s.of('approval.resolved')).toEqual([{ type: 'approval.resolved', approvalId: request.approvalId }]);
    expect(await s.completed(turnId)).toMatchObject({ outcome: 'interrupted', error: null, errorCode: null });
    expect(answers[0]).toMatchObject({ behavior: 'deny' });
    expect((s.items()[0] as ToolItem).status).toBe('interrupted');
    expect(await s.session.interrupt(turnId)).toEqual({ status: 'not-running' });
  });

  it('中断请求失败：回执为 unknown', async () => {
    const fake = createFakeClaude({ turn: () => new Promise(() => {}) });
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    fake.last().interrupt = () => Promise.reject(new Error('stdin closed'));
    expect(await s.session.interrupt(turnId)).toEqual({ status: 'unknown' });
  });

  it('停止屏障的 cancel：拒绝并要求 Claude 结束本回合', async () => {
    const answers: Array<PermissionResult | null> = [];
    const fake = createFakeClaude({
      turn: async (t) => {
        answers.push(await t.ask('Bash', { command: 'rm -rf build' }));
        t.result({ subtype: 'error_during_execution', terminal_reason: 'aborted_tools' });
      },
    });
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    await s.session.respondToApproval((await s.approval(0)).approvalId, { decision: 'cancel' });
    expect(await s.completed(turnId)).toMatchObject({ outcome: 'interrupted' });
    expect(answers[0]).toMatchObject({ behavior: 'deny', interrupt: true });
  });

  it('插话：以 priority:next 推进同一个输入流；回合不对或已结束时 unavailable', async () => {
    const fake = createFakeClaude({
      turn: async (t) => {
        t.text('先这样');
        const steer = await t.nextSteer();
        t.text(`收到：${(steer.message.content as Array<{ text: string }>).at(-1)!.text}`);
        t.result();
      },
    });
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    await until(() => s.items().length === 1);
    expect(await s.session.steer('turn_other', { text: 'x' })).toBe('unavailable');
    expect(await s.session.steer(turnId, { text: '改用 B 方案' })).toBe('accepted');
    await s.completed(turnId);
    const steer = fake.last().inputs[1]!;
    expect(steer).toMatchObject({ priority: 'next', message: { content: [{ type: 'text', text: '改用 B 方案' }] } });
    expect(fake.last().callsOf('streamInput')).toHaveLength(0);
    expect(s.items().map((i) => (i.kind === 'agent-message' ? i.text : ''))).toEqual(['先这样', '收到：改用 B 方案']);
    expect(await s.session.steer(turnId, { text: '晚了' })).toBe('unavailable');
  });

  it('插话会结清挂着的审批', async () => {
    const answers: Array<PermissionResult | null> = [];
    const fake = createFakeClaude({
      turn: async (t) => {
        answers.push(await t.ask('Bash', { command: 'npm publish' }));
        await t.nextSteer();
        t.text('好的，不发布了');
        t.result();
      },
    });
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    const request = await s.approval(0);
    expect(await s.session.steer(turnId, { text: '先别发布' })).toBe('accepted');
    expect(s.of('approval.resolved').map((e) => e.approvalId)).toEqual([request.approvalId]);
    expect(await s.completed(turnId)).toMatchObject({ outcome: 'completed' });
    expect(answers[0]).toMatchObject({ behavior: 'deny' });
  });

  it('插话没赶上、作为下一轮排着（queued_turn_count > 0）：BaoCut 的回合等它跑完才结束', async () => {
    const fake = createFakeClaude({
      turn: async (t) => {
        t.text('第一段');
        await t.nextSteer();
        t.result({ queued_turn_count: 1 });
        t.text('第二段');
        t.result();
      },
    });
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    await until(() => s.items().length === 1);
    await s.session.steer(turnId, { text: '补充一句' });
    await s.completed(turnId);
    expect(s.of('turn.completed')).toHaveLength(1);
    const texts = s.events.map((e) => (e.type === 'item.completed' && e.item.kind === 'agent-message' ? e.item.text : e.type));
    expect(texts.indexOf('第二段')).toBeLessThan(texts.indexOf('turn.completed'));
  });
});

describe('ClaudeSession：访问模式、模型与强度', () => {
  const MODES: Array<[AgentMode, string]> = [
    ['plan', 'plan'],
    ['ask', 'default'],
    ['autoAcceptEdits', 'acceptEdits'],
    ['auto', 'auto'],
    ['fullAccess', 'bypassPermissions'],
  ];

  it('访问模式（含先给方案）与 Claude 权限模式的对照，旧值先换成新值', () => {
    for (const [mode, permission] of MODES) expect(claudePermissionMode(mode)).toBe(permission);
    expect(claudePermissionMode('controlled')).toBe('default');
    expect(claudePermissionMode('authorized')).toBe('bypassPermissions');
  });

  it.each(MODES)('起 Query 时的权限模式：%s', async (mode, permission) => {
    const fake = createFakeClaude();
    const s = track(open(fake, { accessMode: mode }));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings({ accessMode: mode }));
    await s.completed(turnId);
    const query = fake.last();
    expect(query.options.allowDangerouslySkipPermissions).toBe(true);
    if (mode === 'auto') {
      // auto 先按 default 起，问过模型支持 auto 再切过去。
      expect(query.options.permissionMode).toBe('default');
      expect(query.callsOf('setPermissionMode')).toEqual([['auto']]);
      expect(query.callsOf('supportedModels')).toHaveLength(1);
    } else {
      expect(query.options.permissionMode).toBe(permission);
      expect(query.callsOf('setPermissionMode')).toEqual([]);
    }
  });

  it('换档：同一个 Query 上 setPermissionMode', async () => {
    const fake = createFakeClaude();
    const s = track(open(fake));
    for (const mode of ['ask', 'fullAccess', 'autoAcceptEdits', 'auto', 'plan', 'ask'] as AgentMode[]) {
      const { turnId } = await s.session.startTurn({ text: mode }, settings({ accessMode: mode }));
      await s.completed(turnId);
    }
    expect(fake.queries).toHaveLength(1);
    expect(fake.last().callsOf('setPermissionMode')).toEqual([['bypassPermissions'], ['acceptEdits'], ['auto'], ['plan'], ['default']]);
  });

  it('auto 遇到不支持的模型：退回逐项询问并提示一次', async () => {
    const fake = createFakeClaude();
    const s = track(open(fake, { accessMode: 'auto', model: 'haiku' }));
    for (let i = 0; i < 2; i++) {
      const { turnId } = await s.session.startTurn({ text: 'go' }, settings({ accessMode: 'auto', model: 'haiku' }));
      expect(await s.completed(turnId)).toMatchObject({ outcome: 'completed' });
    }
    expect(fake.last().options).toMatchObject({ model: 'haiku', permissionMode: 'default' });
    expect(fake.last().callsOf('setPermissionMode')).toEqual([]);
    const warnings = s.of('session.warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toMatch(/haiku.*「自动」.*「逐项询问」/);
  });

  it('auto 被 CLI 拒绝（setPermissionMode 抛错）：退回逐项询问并提示，回合照常进行', async () => {
    const fake = createFakeClaude({ rejectModes: ['auto'] });
    const s = track(open(fake, { accessMode: 'fullAccess' }));
    const first = await s.session.startTurn({ text: 'go' }, settings({ accessMode: 'fullAccess' }));
    await s.completed(first.turnId);
    const second = await s.session.startTurn({ text: 'go' }, settings({ accessMode: 'auto' }));
    expect(await s.completed(second.turnId)).toMatchObject({ outcome: 'completed' });
    expect(fake.last().callsOf('setPermissionMode')).toEqual([['auto'], ['default']]);
    expect(s.of('session.warning')[0]!.message).toMatch(/permission mode auto is not available/);
  });

  it('模型：变了就 setModel，回到默认传 undefined；切换失败时以 AGENT_MODEL_UNAVAILABLE 拒绝这一轮', async () => {
    const fake = createFakeClaude();
    const s = track(open(fake));
    for (const model of [null, 'sonnet', 'sonnet', null]) {
      const { turnId } = await s.session.startTurn({ text: 'go' }, settings({ model }));
      await s.completed(turnId);
    }
    expect(fake.last().callsOf('setModel')).toEqual([['sonnet'], [undefined]]);

    fake.last().setModel = () => Promise.reject(new Error('unknown model'));
    await expect(s.session.startTurn({ text: 'go' }, settings({ model: 'claude-nope' }))).rejects.toMatchObject({
      agentCode: 'AGENT_MODEL_UNAVAILABLE',
    });
    expect(s.of('turn.started')).toHaveLength(4);
  });

  it('强度：起 Query 时给；变了就带恢复句柄重启 Query；认不出的强度按默认', async () => {
    const fake = createFakeClaude({ sessionId: 'sess-e' });
    const s = track(open(fake));
    const first = await s.session.startTurn({ text: 'go' }, settings({ effort: 'high', model: 'sonnet' }));
    await s.completed(first.turnId);
    expect(fake.last().options).toMatchObject({ effort: 'high', model: 'sonnet' });

    const second = await s.session.startTurn({ text: 'go' }, settings({ effort: 'max', model: 'sonnet' }));
    expect(await s.completed(second.turnId)).toMatchObject({ outcome: 'completed' });
    expect(fake.queries).toHaveLength(2);
    const [old, current] = fake.queries;
    expect(old!.closed).toBe(true);
    await until(() => old!.inputEnded);
    expect(old!.inputs).toHaveLength(1);
    expect(current!.options).toMatchObject({ effort: 'max', model: 'sonnet', resume: 'sess-e' });
    expect(current!.inputs).toHaveLength(1);

    const third = await s.session.startTurn({ text: 'go' }, settings({ effort: 'turbo', model: 'sonnet' }));
    await s.completed(third.turnId);
    expect(fake.queries).toHaveLength(3);
    expect(fake.last().options).not.toHaveProperty('effort');
    expect(s.session.describePersistence()).toEqual({ driverId: 'claude', data: { sessionId: 'sess-e' } });
  });
});

describe('ClaudeSession：恢复、错误与退出', () => {
  it('恢复句柄：第一轮之前就能给出；起 Query 时带 resume；别的 Driver 的句柄不认', async () => {
    const fake = createFakeClaude();
    const s = track(open(fake, { resume: { driverId: 'claude', data: { sessionId: 'old-1' } } }));
    expect(s.session.describePersistence()).toEqual({ driverId: 'claude', data: { sessionId: 'old-1' } });
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    expect(await s.completed(turnId)).toMatchObject({ outcome: 'completed' });
    expect(fake.last().options.resume).toBe('old-1');
    expect(s.session.describePersistence()).toEqual({ driverId: 'claude', data: { sessionId: 'old-1' } });

    const other = track(open(createFakeClaude(), { resume: { driverId: 'codex', data: { threadId: 'thr-1' } } }));
    expect(other.session.describePersistence()).toBeNull();
  });

  it('原生会话恢复不了：提示，换新会话重发这一轮，句柄换成新的', async () => {
    const fake = createFakeClaude({ sessionId: 'new-1', resumable: () => false });
    const s = track(open(fake, { resume: { driverId: 'claude', data: { sessionId: 'gone-1' } } }));
    const { turnId } = await s.session.startTurn({ text: '继续' }, settings());
    expect(await s.completed(turnId)).toMatchObject({ outcome: 'completed' });
    expect(fake.queries).toHaveLength(2);
    const [failed, fresh] = fake.queries;
    expect(failed!.options.resume).toBe('gone-1');
    expect(failed!.closed).toBe(true);
    expect(fresh!.options).not.toHaveProperty('resume');
    expect(fresh!.inputs[0]!.uuid).toBe(failed!.inputs[0]!.uuid);
    expect(s.of('session.warning')[0]!.message).toMatch(/无法恢复.*No conversation found with session ID: gone-1/);
    expect(s.of('turn.started')).toHaveLength(1);
    expect(s.of('turn.completed')).toHaveLength(1);
    expect(s.session.describePersistence()).toEqual({ driverId: 'claude', data: { sessionId: 'new-1' } });
  });

  const ERRORS: Array<[SDKAssistantMessageError, string | null]> = [
    ['authentication_failed', 'AGENT_AUTH_REQUIRED'],
    ['oauth_org_not_allowed', 'AGENT_AUTH_REQUIRED'],
    ['account_on_hold', 'AGENT_AUTH_REQUIRED'],
    ['verification_required', 'AGENT_AUTH_REQUIRED'],
    ['cloud_credential_error', 'AGENT_AUTH_REQUIRED'],
    ['billing_error', 'AGENT_BILLING_REQUIRED'],
    ['model_not_found', 'AGENT_MODEL_UNAVAILABLE'],
    ['rate_limit', 'AGENT_RATE_LIMITED'],
    ['overloaded', 'AGENT_RATE_LIMITED'],
    ['invalid_request', null],
    ['server_error', null],
    ['unknown', null],
    ['max_output_tokens', null],
  ];

  it.each(ERRORS)('出错的回合：%s → %s；错误原文随 turn.completed 带出，不重复成一条回复', async (error, code) => {
    const fake = createFakeClaude({
      turn: (t) => {
        t.apiError(error, `API Error: ${error}`);
        t.result({ is_error: true, result: `API Error: ${error}` });
      },
    });
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    expect(await s.completed(turnId)).toEqual({ type: 'turn.completed', turnId, outcome: 'failed', error: `API Error: ${error}`, errorCode: code });
    expect(s.items()).toEqual([]);
  });

  it('API 重试发 session.error（willRetry）；启动就失败的结果按 startup_failure_reason 分类', async () => {
    const fake = createFakeClaude({
      turn: (t) => {
        t.emit({
          type: 'system',
          subtype: 'api_retry',
          attempt: 1,
          max_retries: 10,
          retry_delay_ms: 500,
          error_status: 529,
          error: 'overloaded',
          session_id: t.query.sessionId,
          uuid: 'u',
        } as unknown as SDKMessage);
        t.result({ subtype: 'error_during_execution', errors: ['Claude Code 版本太旧'], startup_failure_reason: 'cli_version_too_old' });
      },
    });
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    expect(await s.completed(turnId)).toMatchObject({ outcome: 'failed', error: 'Claude Code 版本太旧', errorCode: 'AGENT_OUTDATED' });
    expect(s.of('session.error')).toEqual([
      {
        type: 'session.error',
        turnId,
        message: expect.stringContaining('overloaded'),
        messageRef: expect.objectContaining({ key: 'driversClaude.apiRetry' }),
        willRetry: true,
        code: 'AGENT_RATE_LIMITED',
      },
    ]);
  });

  it('进程出错退出：挂着的审批结清，发 session.exited 带原因', async () => {
    const fake = createFakeClaude({ turn: async (t) => void (await t.ask('Bash', { command: 'ls' })) });
    const s = track(open(fake));
    await s.session.startTurn({ text: 'go' }, settings());
    const request = await s.approval(0);
    fake.last().crash(new Error('Claude Code process exited with code 1'));
    const exited = await until(() => s.of('session.exited')[0]);
    expect(exited.error).toBe('Claude Code process exited with code 1');
    expect(s.of('approval.resolved').map((e) => e.approvalId)).toEqual([request.approvalId]);
    // 进程退出即会话结束：之后的 close() 不再发第二条 session.exited，也不能再开回合。
    await s.session.close();
    expect(s.of('session.exited')).toHaveLength(1);
    await expect(s.session.startTurn({ text: 'go' }, settings())).rejects.toThrow(/已关闭/);
  });

  it('进程自己结束：session.exited 带 stderr 的最后一行', async () => {
    const fake = createFakeClaude();
    const s = track(open(fake));
    const { turnId } = await s.session.startTurn({ text: 'go' }, settings());
    await s.completed(turnId);
    fake.last().options.stderr!('warming up\nfatal: lost connection\n');
    fake.last().end();
    expect(await until(() => s.of('session.exited')[0])).toEqual({ type: 'session.exited', error: 'fatal: lost connection' });
  });

  it('close：结清审批、关掉 Query、只发一次 session.exited；之后不能再开回合', async () => {
    const answers: Array<PermissionResult | null> = [];
    const fake = createFakeClaude({ turn: async (t) => void answers.push(await t.ask('Bash', { command: 'ls' })) });
    const s = open(fake);
    await s.session.startTurn({ text: 'go' }, settings());
    const request = await s.approval(0);
    await s.session.close();
    await s.session.close();
    expect(s.of('approval.resolved').map((e) => e.approvalId)).toEqual([request.approvalId]);
    expect(answers[0]).toMatchObject({ behavior: 'deny' });
    expect(fake.last().closed).toBe(true);
    await until(() => fake.last().inputEnded);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.of('session.exited')).toEqual([{ type: 'session.exited', error: null }]);
    await expect(s.session.startTurn({ text: 'go' }, settings())).rejects.toThrow(/已关闭/);
  });
});

describe('ClaudeSession：图片与受限调用', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-claude-session-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('图片读成 base64 的 image 块放在文字前面；image/jpg 归一成 image/jpeg；不支持的格式直接拒绝', async () => {
    const png = path.join(dir, 'a.png');
    const jpg = path.join(dir, 'b.jpg');
    await fs.writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(jpg, Buffer.from([0xff, 0xd8, 0xff]));
    const fake = createFakeClaude();
    const s = track(open(fake));

    await expect(
      s.session.startTurn({ text: '看图', images: [{ path: path.join(dir, 'c.bmp'), mimeType: 'image/bmp' }] }, settings()),
    ).rejects.toThrow(/不支持这种图片格式/);
    expect(fake.queries).toHaveLength(0);
    expect(s.events).toEqual([]);

    const { turnId } = await s.session.startTurn(
      { text: '看图', images: [{ path: png, mimeType: 'image/png' }, { path: jpg, mimeType: 'image/jpg' }] },
      settings(),
    );
    await s.completed(turnId);
    expect(fake.last().inputs[0]!.message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]).toString('base64') } },
      { type: 'text', text: '看图' },
    ]);
  });

  it('受限调用（cwd-write-only）：acceptEdits 加沙箱，不给 MCP 服务，要问的一律拒绝、不发审批', async () => {
    const answers: Array<PermissionResult | null> = [];
    const fake = createFakeClaude({
      turn: async (t) => {
        answers.push(await t.ask('Bash', { command: 'curl https://example.com' }));
        answers.push(await t.ask('Write', { file_path: '/etc/hosts', content: '' }));
        t.result();
      },
    });
    const s = track(
      open(fake, {
        cwd: dir,
        accessMode: 'fullAccess',
        confinement: 'cwd-write-only',
        mcpServers: { baocut: { url: 'http://127.0.0.1:4100/mcp', headers: {} } },
      }),
    );
    const { turnId } = await s.session.startTurn({ text: '生成一张图' }, settings({ accessMode: 'fullAccess' }));
    expect(await s.completed(turnId)).toMatchObject({ outcome: 'completed' });
    const query = fake.last();
    expect(query.options).toMatchObject({
      cwd: dir,
      permissionMode: 'acceptEdits',
      allowDangerouslySkipPermissions: false,
      sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false },
    });
    expect(query.options).not.toHaveProperty('mcpServers');
    expect(query.callsOf('setPermissionMode')).toEqual([]);
    expect(answers.map((a) => a?.behavior)).toEqual(['deny', 'deny']);
    expect(s.of('approval.requested')).toEqual([]);
  });
});

describe('ClaudeDriver → ClaudeSession', () => {
  it('经 Driver 建的会话用找到的 claude 与它的环境', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-claude-wire-'));
    try {
      const cli = await createFakeClaudeCli(path.join(dir, 'fake'));
      const fake = createFakeClaude();
      const driver = new ClaudeDriver(silentLogger, { locate: cli.locate, queryFactory: fake.factory });
      const session = await driver.createSession({ cwd: dir, accessMode: 'ask', model: null, effort: null, resume: null });
      const events: AgentEvent[] = [];
      session.subscribe((e) => events.push(e));
      const { turnId } = await session.startTurn({ text: 'hi' }, settings());
      await until(() => events.find((e) => e.type === 'turn.completed' && e.turnId === turnId));
      expect(fake.last().options.pathToClaudeCodeExecutable).toBe(cli.command);
      expect(fake.last().options.env).toMatchObject({ FAKE_CLAUDE_DIR: cli.dir });
      await session.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
