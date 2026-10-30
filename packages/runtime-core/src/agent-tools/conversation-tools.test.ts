import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { newId, type AgentMode, type Id, type TimelineItem } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { ToolDriver, tool, until, type ToolSession } from './testing/fake-agent.ts';

/**
 * 会话自己的工具，经真实的 MCP 端点调用；不需要视频引擎与模型。
 *
 * `conversations_set_title`（产品设计 §3.1、架构设计 §3.10）：会话里的智能体读懂本机素材之后给会话起标题。侧栏读到的会话记录
 * （`conversations.list`）跟着换；只换按第一句话自动起的标题、只换一次，用户改过的不动；规划模式也能用。
 *
 * `conversations_ask`（架构设计 §3.12「提问」）：会话里放一张带预览的提问卡，回答、跳过、直接回复与停止都回到工具结果。
 */

describe('会话自己的工具', () => {
  let dir: string;
  let driver: ToolDriver;
  let runtime: RunningRuntime;
  let client: BaoCutClient;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-conversation-tools-')));
    driver = new ToolDriver();
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [driver],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
  });

  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 一个不属于项目的会话，发出第一句话，等到它的原生会话。 */
  async function agent(text: string, accessMode: AgentMode = 'auto'): Promise<{ conversationId: Id; session: ToolSession }> {
    const { conversation } = await client.request('conversations.create', { projectId: null });
    const before = driver.sessions.length;
    await client.request('conversations.send', { conversationId: conversation.id, text, commandId: newId('cmd'), accessMode });
    const session = await until(() => driver.sessions[before]);
    return { conversationId: conversation.id, session };
  }

  /** 等会话里出现一张待回答的提问卡。 */
  async function pendingQuestion(conversationId: Id): Promise<Extract<TimelineItem, { kind: 'approval' }>> {
    return until(async () => {
      const { items } = await client.request('conversations.get', { conversationId });
      return items.find(
        (i): i is Extract<TimelineItem, { kind: 'approval' }> =>
          i.kind === 'approval' && i.status === 'pending' && i.request.kind === 'question',
      );
    });
  }

  /** 侧栏读到的标题。 */
  async function sidebarTitle(conversationId: Id): Promise<string> {
    const { conversations } = await client.request('conversations.list', {});
    return conversations.find((c) => c.id === conversationId)!.title;
  }

  it('按第一句话起的标题换成智能体起的；只换一次', async () => {
    const { conversationId, session } = await agent('Transcribe this video and translate it into Chinese\n/Users/me/clip.mp4');
    expect(await sidebarTitle(conversationId)).toBe('Transcribe this video and translate it i…');

    const first = await tool(session, 'conversations_set_title', { title: '  城市骑行通勤的五个误区 ' });
    expect(first.isError).toBe(false);
    expect(first.body).toMatchObject({ changed: true, title: '城市骑行通勤的五个误区' });
    expect(await sidebarTitle(conversationId)).toBe('城市骑行通勤的五个误区');

    const second = await tool(session, 'conversations_set_title', { title: '另一个标题' });
    expect(second.body).toMatchObject({ changed: false, title: '城市骑行通勤的五个误区' });
    expect(second.body.next).toContain('不要再调用');
    expect(await sidebarTitle(conversationId)).toBe('城市骑行通勤的五个误区');
  });

  it('用户改过的标题不动', async () => {
    const { conversationId, session } = await agent('转录这个视频');
    await client.request('conversations.update', { conversationId, title: '我的片子' });
    const result = await tool(session, 'conversations_set_title', { title: '城市骑行通勤的五个误区' });
    expect(result.body).toMatchObject({ changed: false, title: '我的片子' });
    expect(await sidebarTitle(conversationId)).toBe('我的片子');
  });

  it('规划模式下也能用：只改会话自己的标题，不确认', async () => {
    const { conversationId, session } = await agent('总结一下这个视频', 'plan');
    const result = await tool(session, 'conversations_set_title', { title: '季度财报电话会要点' });
    expect(result.isError).toBe(false);
    expect(result.body.changed).toBe(true);
    expect(result.body.approval).toBeUndefined();
    expect(await sidebarTitle(conversationId)).toBe('季度财报电话会要点');
  });

  it('超过 40 个字符或不止一行时拒绝，标题不变', async () => {
    const { conversationId, session } = await agent('转录这个视频');
    for (const title of ['长'.repeat(41), '第一行\n第二行']) {
      const result = await tool(session, 'conversations_set_title', { title });
      expect(result.isError).toBe(true);
      expect(result.body.error.code).toBe('INVALID_ARGUMENTS');
    }
    expect(await sidebarTitle(conversationId)).toBe('转录这个视频');
  });

  it('conversations_ask：带预览的提问等用户回答，答案回到工具结果', async () => {
    const { conversationId, session } = await agent('给这个视频挑个封面');
    const cwd = runtime.harness.conversationOf(conversationId)!.cwd;
    await fs.mkdir(path.join(cwd, 'frames'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'frames', 'a.jpg'), 'jpg');
    await fs.writeFile(path.join(cwd, 'take.mp3'), 'mp3');
    const asked = tool(session, 'conversations_ask', {
      questions: [
        {
          header: '封面',
          question: '用哪一帧做封面？',
          options: [
            { label: '开场特写', description: '推荐', preview: 'frames/a.jpg' },
            { label: '城市远景', preview: path.join(cwd, 'take.mp3') },
          ],
        },
        { header: '标题', question: '标题放哪？', options: [{ label: '上方' }, { label: '下方' }], multiSelect: true, allowOther: false },
      ],
    });
    const card = await pendingQuestion(conversationId);
    expect(card.request).toEqual({
      kind: 'question',
      reason: null,
      rule: null,
      questions: [
        {
          id: 'q1',
          header: '封面',
          question: '用哪一帧做封面？',
          multiSelect: false,
          allowOther: true,
          options: [
            { label: '开场特写', description: '推荐', preview: { kind: 'image', path: 'frames/a.jpg' } },
            { label: '城市远景', description: null, preview: { kind: 'audio', path: 'take.mp3' } },
          ],
        },
        {
          id: 'q2',
          header: '标题',
          question: '标题放哪？',
          multiSelect: true,
          allowOther: false,
          options: [
            { label: '上方', description: null },
            { label: '下方', description: null },
          ],
        },
      ],
    });
    expect(runtime.harness.conversationOf(conversationId)!.activity).toBe('awaiting-answer');

    // 不许自填的题只认选项名：拒收，提问保持待回答。
    const approvalId = card.approvalId;
    await expect(
      client.request('agents.answerQuestion', { conversationId, approvalId, answers: { q1: ['开场特写'], q2: ['中间'] } }),
    ).rejects.toThrow();
    const answers = { q1: ['我自己拍一张'], q2: ['上方', '下方'] };
    expect(await client.request('agents.answerQuestion', { conversationId, approvalId, answers })).toEqual({ status: 'answered' });
    const result = await asked;
    expect(result.isError).toBe(false);
    expect(result.body).toMatchObject({
      status: 'answered',
      answers: [
        { header: '封面', question: '用哪一帧做封面？', answer: ['我自己拍一张'] },
        { header: '标题', question: '标题放哪？', answer: ['上方', '下方'] },
      ],
    });
    expect(runtime.harness.conversationOf(conversationId)!.activity).toBe('running');
  });

  it('conversations_ask：跳过、直接回复都回到工具结果；同时只问一次；停止任务时按取消', async () => {
    const { conversationId, session } = await agent('剪一版');
    const ask = () =>
      tool(session, 'conversations_ask', {
        questions: [{ header: '节奏', question: '要快一点还是慢一点？', options: [{ label: '快' }, { label: '慢' }] }],
      });

    const skipped = ask();
    const first = await pendingQuestion(conversationId);
    expect((await ask()).body.error.code).toBe('QUESTION_PENDING');
    await client.request('agents.respondToApproval', { conversationId, approvalId: first.approvalId, decision: 'decline' });
    expect((await skipped).body).toMatchObject({ status: 'declined', byMessage: false });

    Object.assign(session.capabilities, { steer: true });
    const replied = ask();
    await pendingQuestion(conversationId);
    await client.request('conversations.steer', { conversationId, text: '快一点，但别太赶', commandId: newId('cmd') });
    expect((await replied).body).toMatchObject({ status: 'declined', byMessage: true });
    expect(session.inputs.at(-1)).toContain('快一点，但别太赶');

    const stopped = ask();
    await pendingQuestion(conversationId);
    await client.request('tasks.stop', { taskId: runtime.harness.agentRun(conversationId).taskId! });
    expect((await stopped).body.error.code).toBe('APPROVAL_CANCELLED');
    const { items } = await client.request('conversations.get', { conversationId });
    expect(items.filter((i) => i.kind === 'approval').map((i) => i.status)).toEqual(['declined', 'declined', 'cancelled']);
  });

  it('conversations_ask：预览要是工作目录里的图片、视频或音频，选项名不能重复；规划模式也能问', async () => {
    const { conversationId, session } = await agent('挑配乐', 'plan');
    const cwd = runtime.harness.conversationOf(conversationId)!.cwd;
    await fs.writeFile(path.join(cwd, 'notes.txt'), 'x');
    const outside = path.join(dir, 'outside.png');
    await fs.writeFile(outside, 'png');
    const call = (options: Record<string, unknown>[]) =>
      tool(session, 'conversations_ask', { questions: [{ header: '配乐', question: '用哪段？', options }] });
    const withPreview = (preview: string) => call([{ label: '甲', preview }, { label: '乙' }]);
    expect((await withPreview('missing.mp3')).body.error.code).toBe('FILE_NOT_FOUND');
    expect((await withPreview(outside)).body.error.code).toBe('PATH_OUTSIDE_WORKSPACE');
    expect((await withPreview('notes.txt')).body.error.code).toBe('INVALID_ARGUMENTS');
    expect((await call([{ label: '甲' }, { label: '甲' }])).body.error.code).toBe('INVALID_ARGUMENTS');
    expect((await call([{ label: '甲' }])).body.error.code).toBe('INVALID_ARGUMENTS');
    expect((await client.request('conversations.get', { conversationId })).items.some((i) => i.kind === 'approval')).toBe(false);

    const asked = call([{ label: '甲' }, { label: '乙' }]);
    const card = await pendingQuestion(conversationId);
    await client.request('agents.answerQuestion', { conversationId, approvalId: card.approvalId, answers: { q1: ['乙'] } });
    expect((await asked).body).toMatchObject({ status: 'answered', answers: [{ answer: ['乙'] }] });
  });
});
