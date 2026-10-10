import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { newId, type AgentMode, type Autonomy, type EditorContext, type Id, type VideoEvent, type Project } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { allToolNames } from './all-tool-sets.ts';
import { ToolDriver, mcp, post, tool, until } from './testing/fake-agent.ts';

/**
 * 端到端：假智能体拿着会话令牌，经真实的 MCP 端点调用视频工具，修改落到真实的 Rust 引擎里，
 * 界面那边的视频主题与会话里的变更卡都要跟上。需要 engine-host 与 ffmpeg，缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!engine || !ffmpeg)('智能体工具（真实引擎）', () => {
  let fixtures: string;
  let clip: string;
  let dir: string;
  let runtime: RunningRuntime;
  let driver: ToolDriver;
  let client: BaoCutClient;
  let project: Project;
  let conversationId: Id;
  let videoId: Id;
  let videoPath: string;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fixtures-'));
    clip = path.join(fixtures, 'clip.mp4');
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', clip],
    ]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-test-'));
    driver = new ToolDriver();
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [driver],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '工具测试' }));
    await fs.copyFile(clip, path.join(project.path, 'clip.mp4'));
    const opened = await client.request('videos.create', { projectId: project.id, name: '样片' });
    videoId = opened.ref.videoId;
    videoPath = opened.ref.relPath;
    ({
      conversation: { id: conversationId },
    } = await client.request('conversations.create', { projectId: project.id }));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 发一条消息，等假智能体的回合开始。 */
  async function send(text: string, options: { autonomy?: Autonomy; accessMode?: AgentMode; context?: EditorContext } = {}) {
    const { taskId } = await client.request('conversations.send', { conversationId, text, commandId: newId('cmd'), ...options });
    const session = await until(() => driver.sessions[0]);
    await until(() => session.turnId);
    return { taskId, session };
  }

  async function items() {
    return (await client.request('conversations.get', { conversationId })).items;
  }

  it('会话带着工具通道与指导建立；端点只认令牌、拒绝网页', async () => {
    const { session } = await send('hi');
    const server = session.options.mcpServers?.baocut;
    expect(server?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(session.options.developerInstructions).toContain('videos_inspect');

    const init = await mcp(session, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '0' },
    });
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'baocut' }, capabilities: { tools: {} } });
    const listed = await mcp(session, 'tools/list');
    const tools = listed.result!.tools as { name: string; inputSchema: { type: string } }[];
    // 工具桥列出目录里的全部工具（每一项的 surfaces 都含 agent）。
    expect(tools.map((t) => t.name).sort()).toEqual(allToolNames());
    expect(tools.every((t) => t.inputSchema.type === 'object')).toBe(true);

    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await post(server!.url, {}, body)).status).toBe(401);
    expect((await post(server!.url, { Authorization: 'Bearer nope' }, body)).status).toBe(401);
    expect((await post(server!.url, { ...server!.headers, Origin: 'https://evil.example' }, body)).status).toBe(403);
    expect((await fetch(server!.url, { headers: server!.headers })).status).toBe(405);
    const notification = await post(server!.url, server!.headers, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.status).toBe(202);
    expect((await mcp(session, 'resources/list')).error?.code).toBe(-32601);
  });

  it('智能体经工具改视频：回执、界面主题、变更卡与任务来源都对得上', async () => {
    const videoEvents: VideoEvent[] = [];
    client.subscribeVideo(videoId, {
      snapshot: () => {},
      event: (event) => {
        if (event.type === 'video.event') videoEvents.push(event.event);
      },
    });
    const context: EditorContext = { videoId, videoName: '样片', videoPath, revision: '0', selection: [], playheadSeconds: 0, uiLanguage: 'zh-Hans' };
    const { taskId, session } = await send('把 clip.mp4 放到 1 秒处', { context });
    expect(session.inputs[0]).toContain('<baocut-editor-context>');
    expect(session.inputs[0]).toContain('用户的界面语言是 zh-Hans。');
    expect((await items()).find((i) => i.kind === 'user-message')).toMatchObject({ text: '把 clip.mp4 放到 1 秒处', context });

    const listed = await tool(session, 'videos_list', {});
    expect(listed.body.videos).toEqual([{ path: videoPath, videoId, name: '样片', open: true }]);

    const inspected = await tool(session, 'videos_inspect', { video: videoPath });
    expect(inspected.isError).toBe(false);
    expect(inspected.body).toMatchObject({ videoId, items: [], sequence: { fps: '30' } });

    const applied = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: inspected.body.revision,
      label: '放入 clip.mp4',
      operations: [
        { type: 'importAsset', path: 'clip.mp4', ref: 'c' },
        { type: 'addItem', asset: { ref: 'c' }, at: 1 },
      ],
    });
    expect(applied.isError).toBe(false);
    expect(applied.body).toMatchObject({ status: 'committed', label: '放入 clip.mp4', durationSeconds: { before: 0, after: 3 } });
    expect(applied.body.timeResolution[0]).toMatchObject({ actualFrame: 30, actualSeconds: 1 });

    // 界面那边：同一个视频的主题收到这笔修改，操作者是这个会话的智能体，任务号是当前任务。
    const event = await until(() => videoEvents.find((e) => e.transactionId === applied.body.transactionId));
    expect(event.actor).toEqual({ kind: 'agent', id: `agent:${conversationId}` });
    expect(event.taskId).toBe(taskId);
    const mirror = runtime.videos.mirror(videoId)!.video;
    const placed = mirror.sequences[mirror.rootSequenceId]!.items.find((item) => item.type === 'video');
    expect(placed).toMatchObject({ span: { fromFrame: 30, durationFrames: 60 } });

    // 会话里：一张变更卡，内容取自回执。
    const card = (await items()).find((i) => i.kind === 'video-change');
    expect(card).toMatchObject({
      taskId,
      videoId,
      videoName: '样片',
      target: { projectId: project.id, path: videoPath },
      transactionId: applied.body.transactionId,
      previousRevision: inspected.body.revision,
      videoRevision: applied.body.revision.after,
      durationSeconds: { before: 0, after: 3 },
      undoOf: null,
    });

    // 旧版本上的修改被拒绝，视频不变。
    const stale = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: inspected.body.revision,
      label: '删掉',
      operations: [{ type: 'deleteItems', itemIds: applied.body.createdIds }],
    });
    expect(stale.isError).toBe(true);
    expect(stale.body.error).toMatchObject({ code: 'PROJECT_REVISION_CONFLICT', retryability: 'after-refresh' });

    // 撤销自己的那一步：也是一笔修改，也有变更卡。
    const undone = await tool(session, 'edits_undo', { video: videoId });
    expect(undone.body).toMatchObject({ undoOf: applied.body.transactionId, durationSeconds: { before: 3, after: 0 } });
    await until(() => runtime.videos.mirror(videoId)!.video.sequences[mirror.rootSequenceId]!.items.length === 0);
    expect((await items()).filter((i) => i.kind === 'video-change')).toHaveLength(2);

    // 参数与操作写错：如实返回，不提交。
    const bad = await tool(session, 'edits_apply', { video: videoId, label: 'x', operations: [] });
    expect(bad.body.error.code).toBe('INVALID_ARGUMENTS');
    const badTime = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: undone.body.revision.after,
      label: 'x',
      operations: [{ type: 'moveItem', itemId: 'nope', at: 'soon' }],
    });
    expect(badTime.body.error).toMatchObject({ code: 'INVALID_OPERATION', operationIndex: 0 });
    const missing = await tool(session, 'videos_inspect', { video: '../elsewhere' });
    expect(missing.body.error.code).toMatch(/VIDEO_NOT_FOUND|VIDEO_OUTSIDE_WORKSPACE/);

    // 回合结束后工具不可用。
    session.finish();
    await until(() => runtime.harness.agentRun(conversationId).taskId === null);
    const after = await tool(session, 'videos_inspect', { video: videoId });
    expect(after.body.error.code).toBe('NO_ACTIVE_TASK');
  });

  it('videos_create 新建视频后会话里记一条 video-created：打开编辑器的位置与新建时的版本', async () => {
    const { taskId, session } = await send('新建一部视频');
    const created = await tool(session, 'videos_create', { name: '新片' });
    expect(created.isError, JSON.stringify(created.body)).toBe(false);
    const record = (await items()).find((i) => i.kind === 'video-created');
    expect(record).toEqual({
      kind: 'video-created',
      id: `created/${created.body.videoId}`,
      createdAt: expect.any(String),
      taskId,
      videoId: created.body.videoId,
      videoName: '新片',
      target: { projectId: project.id, path: created.body.video },
      videoRevision: created.body.revision,
    });
    // 新建不是一笔修改：没有变更卡。
    expect((await items()).some((i) => i.kind === 'video-change')).toBe(false);

    // 不属于项目的会话（架构设计 §3.10）：视频建在它的工作目录里，不建项目；Space 按会话来源列出。
    const { conversation: looseConversation } = await client.request('conversations.create', { projectId: null, title: '帮我加字幕' });
    const loose = looseConversation.id;
    const scratch = looseConversation.cwd;
    await fs.writeFile(path.join(scratch, 'notes.txt'), '笔记');
    const projectsBefore = runtime.harness.listProjects().length;
    const { taskId: looseTask } = await client.request('conversations.send', {
      conversationId: loose,
      text: '也建一部',
      commandId: newId('cmd'),
    });
    const looseSession = await until(() => driver.sessions[1]);
    await until(() => looseSession.turnId);
    const looseCreated = await tool(looseSession, 'videos_create', { name: '会话里的片' });
    expect(looseCreated.isError, JSON.stringify(looseCreated.body)).toBe(false);
    expect((await client.request('conversations.get', { conversationId: loose })).conversation).toMatchObject({ projectId: null, cwd: scratch });
    expect(runtime.harness.listProjects()).toHaveLength(projectsBefore);
    await fs.access(path.join(scratch, looseCreated.body.video, 'video.db'));
    expect((await client.request('conversations.get', { conversationId: loose })).items.find((i) => i.kind === 'video-created')).toMatchObject({
      taskId: looseTask,
      videoId: looseCreated.body.videoId,
      target: { conversationId: loose, path: looseCreated.body.video },
    });
    const second = await tool(looseSession, 'videos_create', { name: '第二部' });
    expect(second.isError, JSON.stringify(second.body)).toBe(false);
    expect(runtime.harness.listProjects()).toHaveLength(projectsBefore);
    const listedLoose = await tool(looseSession, 'videos_list', {});
    expect(listedLoose.body.workspace).toBe(await fs.realpath(scratch));
    await until(async () => {
      const entries = (await client.request('space.list', { kind: ['video'] })).entries.filter((e) => e.source.conversationId === loose);
      return entries.length === 2 && entries.every((e) => e.source.projectId === null);
    });

    // 用户明确要建项目：projects_adopt_session 以最早建的视频命名，会话绑定到它，视频与文件搬进项目（智能体开着的先放下）。
    const adopted = await tool(looseSession, 'projects_adopt_session', {});
    expect(adopted.isError, JSON.stringify(adopted.body)).toBe(false);
    expect(adopted.body).toMatchObject({ name: '会话里的片', created: true });
    const bound = (await client.request('conversations.get', { conversationId: loose })).conversation;
    const boundProject = runtime.harness.listProjects().find((p) => p.id === bound.projectId)!;
    expect(boundProject).toMatchObject({ id: adopted.body.projectId, name: '会话里的片' });
    expect(path.dirname(boundProject.path)).toBe(await fs.realpath(path.join(dir, 'projects')));
    expect(bound.cwd).toBe(boundProject.path);
    expect(runtime.harness.listProjects()).toHaveLength(projectsBefore + 1);
    await fs.access(path.join(boundProject.path, looseCreated.body.video, 'video.db'));
    await fs.access(path.join(boundProject.path, second.body.video, 'video.db'));
    expect(await fs.readFile(path.join(boundProject.path, 'notes.txt'), 'utf8')).toBe('笔记');
    const looseItems = (await client.request('conversations.get', { conversationId: loose })).items;
    expect(looseItems.find((i) => i.kind === 'video-created')).toMatchObject({
      videoId: looseCreated.body.videoId,
      target: { projectId: boundProject.id, path: looseCreated.body.video },
    });
    // 再调一次原样返回；之后的新视频建在项目里。
    expect((await tool(looseSession, 'projects_adopt_session', {})).body).toMatchObject({ projectId: boundProject.id, created: false });
    const third = await tool(looseSession, 'videos_create', { name: '第三部' });
    expect(third.isError, JSON.stringify(third.body)).toBe(false);
    expect(runtime.harness.listProjects()).toHaveLength(projectsBefore + 1);
    const listedBound = await tool(looseSession, 'videos_list', {});
    expect(listedBound.body.workspace).toBe(boundProject.path);
    expect(listedBound.body.videos).toHaveLength(3);
    // Space：视频条目在项目来源下，旧的会话来源没有了。
    await until(async () => {
      const entries = (await client.request('space.list', { kind: ['video'], projectId: boundProject.id })).entries;
      return entries.length === 3 && entries.every((e) => e.source.projectId === boundProject.id && e.source.conversationId === null);
    });
    // 回合结束：回合里指向项目的旧路径删掉。
    looseSession.finish();
    await until(async () => !(await fs.lstat(scratch).then(() => true, () => false)));
    // 删掉会话：项目与视频都在。
    await client.request('conversations.delete', { conversationId: loose });
    await fs.access(path.join(boundProject.path, looseCreated.body.video, 'video.db'));
    expect(runtime.harness.listProjects().some((p) => p.id === boundProject.id)).toBe(true);
  });

  it('删除还有视频的无项目会话：视频搬进以视频命名的新项目，不随会话消失', async () => {
    const { conversation } = await client.request('conversations.create', { projectId: null, title: '临时' });
    await client.request('conversations.send', { conversationId: conversation.id, text: '建一部', commandId: newId('cmd') });
    const session = await until(() => driver.sessions.at(-1)?.turnId ? driver.sessions.at(-1) : undefined);
    const created = await tool(session!, 'videos_create', { name: '留下来' });
    expect(created.isError, JSON.stringify(created.body)).toBe(false);
    session!.finish();
    await client.request('conversations.delete', { conversationId: conversation.id });
    const project = runtime.harness.listProjects().find((p) => p.name === '留下来');
    expect(project).toBeTruthy();
    await until(() => fs.access(path.join(project!.path, created.body.video, 'video.db')).then(() => true, () => false));
  });

  it('智能体设置转场、效果、章节与闪避；删掉片段时回执说明转场为什么没了', async () => {
    const { session } = await send('加个转场和章节');
    const inspected = await tool(session, 'videos_inspect', { video: videoId });
    const visualTrack = inspected.body.tracks.find((t: { kind: string }) => t.kind === 'visual').id;
    const audioTrack = inspected.body.tracks.find((t: { kind: string }) => t.kind === 'audio').id;
    const placed = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: inspected.body.revision,
      label: '放入并切开',
      operations: [
        { type: 'importAsset', path: 'clip.mp4', ref: 'c' },
        { type: 'addItem', asset: { ref: 'c' }, at: 0, trackId: visualTrack },
      ],
    });
    const [itemId] = placed.body.createdIds.filter((id: string) => id.startsWith('item'));
    const split = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: placed.body.revision.after,
      label: '切开',
      operations: [{ type: 'splitItem', itemId, at: 1 }],
    });
    const rightId = split.body.createdIds.find((id: string) => id.startsWith('item'));

    const applied = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: split.body.revision.after,
      label: '转场、效果、章节与闪避',
      operations: [
        { type: 'setTransition', leftItemId: itemId, rightItemId: rightId, kind: 'dissolve', duration: 0.2, audioCrossfade: true },
        { type: 'setEffects', itemId: rightId, fx: { saturation: -1 } },
        {
          type: 'setChapters',
          chapters: [
            { at: 0, title: '开场' },
            { at: 1.02, title: '后半' },
          ],
        },
        { type: 'setDucking', trigger: { kind: 'items', trackIds: [visualTrack] }, target: { trackIds: [audioTrack] }, attack: 0.1 },
      ],
    });
    expect(applied.isError).toBe(false);

    const after = await tool(session, 'videos_inspect', { video: videoId });
    expect(after.body.transitions).toEqual([
      expect.objectContaining({ leftItemId: itemId, rightItemId: rightId, kind: 'dissolve', durationFrames: 6, audioCrossfade: true }),
    ]);
    expect(after.body.chapters.map((c: { title: string; atFrame: number }) => [c.title, c.atFrame])).toEqual([
      ['开场', 0],
      ['后半', 31],
    ]);
    expect(after.body.ducking).toEqual([
      expect.objectContaining({ trigger: { kind: 'items', trackIds: [visualTrack] }, depth: 10, attackSeconds: 0.1, releaseSeconds: 0.35 }),
    ]);
    expect(after.body.items.find((i: { id: string }) => i.id === rightId).fx).toEqual(['saturation']);
    // 界面与 Runtime 的镜像经事件拿到同样的对象。
    await until(() => runtime.videos.mirror(videoId)!.video.sequences[after.body.sequence.id]!.transitions.length === 1);
    const mirrored = runtime.videos.mirror(videoId)!.video.sequences[after.body.sequence.id]!;
    expect(mirrored.markers.map((m) => m.label)).toEqual(['开场', '后半']);
    expect(mirrored.ducking).toHaveLength(1);

    const deleted = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: after.body.revision,
      label: '删掉后半',
      operations: [{ type: 'deleteItems', itemIds: [rightId] }],
    });
    expect(deleted.body.removedTransitions).toEqual([{ id: after.body.transitions[0].id, reason: 'item-deleted' }]);
    await until(() => runtime.videos.mirror(videoId)!.video.sequences[after.body.sequence.id]!.transitions.length === 0);
  });

  it('智能体用 setStyle 在铺满画布与画中画之间切换片段，画中画的位置保留', async () => {
    const { session } = await send('把视频改成画中画');
    const inspected = await tool(session, 'videos_inspect', { video: videoId });
    const placed = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: inspected.body.revision,
      label: '放入并铺满',
      operations: [
        { type: 'importAsset', path: 'clip.mp4', ref: 'c' },
        { type: 'addItem', asset: { ref: 'c' }, at: 0 },
      ],
    });
    const itemId = placed.body.createdIds.find((id: string) => id.startsWith('item'));
    const full = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: placed.body.revision.after,
      label: '铺满',
      operations: [{ type: 'setStyle', itemId, mode: 'fullscreen', fit: 'contain', bg: 'blur' }],
    });
    expect(full.isError).toBe(false);
    const digest = async () =>
      (await tool(session, 'videos_inspect', { video: videoId })).body.items.find((i: { id: string }) => i.id === itemId);
    expect(await digest()).toMatchObject({ place: { mode: 'fullscreen' } });

    const pip = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: full.body.revision.after,
      label: '画中画',
      operations: [
        { type: 'setStyle', itemId, mode: 'pip' },
        { type: 'setTransform', itemId, x: 80, y: 80, w: 30 },
      ],
    });
    expect(pip.isError).toBe(false);
    expect(await digest()).toMatchObject({ place: { mode: 'pip', x: 80, y: 80, w: 30 } });

    // 不透明度超出 [0, 1] 整笔不生效。
    const bad = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: pip.body.revision.after,
      label: '不透明度',
      operations: [{ type: 'setStyle', itemId, opacity: 2 }],
    });
    expect(bad.isError).toBe(true);
  });

  it('清理：deleteTrack 只删空轨道；assets_prune 先列出没有引用的素材，apply 时删掉，还在用的拒绝', async () => {
    const { session } = await send('清理一下没用的轨道和素材');
    await fs.writeFile(path.join(project.path, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
    const inspected = await tool(session, 'videos_inspect', { video: videoId });
    const placed = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: inspected.body.revision,
      label: '放一段、多导一份、加两条轨道',
      operations: [
        { type: 'importAsset', path: 'clip.mp4', ref: 'used' },
        { type: 'addItem', asset: { ref: 'used' }, at: 0 },
        { type: 'importAsset', path: 'logo.svg', name: '没放上去', storage: 'managed' },
        { type: 'addTrack', kind: 'visual', name: '空轨', ref: 'empty' },
        { type: 'addTrack', kind: 'audio', name: '音乐' },
      ],
    });
    expect(placed.isError).toBe(false);
    const after = await tool(session, 'videos_inspect', { video: videoId });
    const used = after.body.items.find((i: { type: string }) => i.type === 'video');
    const emptyTrack = after.body.tracks.find((t: { name?: string }) => t.name === '空轨').id;

    // 有片段的轨道：拒绝，details 给出片段与下一步的操作。
    const busy = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: after.body.revision,
      label: '删轨道',
      operations: [{ type: 'deleteTrack', trackId: used.trackId }],
    });
    expect(busy.body.error).toMatchObject({
      code: 'INVALID_OPERATION',
      details: { rule: 'track-not-empty', itemIds: [used.id], next: ['deleteItems', 'moveItem'] },
    });
    const dropped = await tool(session, 'edits_apply', {
      video: videoId,
      expectedRevision: after.body.revision,
      label: '删空轨道',
      operations: [{ type: 'deleteTrack', trackId: emptyTrack }],
    });
    expect(dropped.body).toMatchObject({ status: 'committed', deletedIds: [emptyTrack], removedTracks: [emptyTrack] });

    // 只列出：只有没放上去的那一份，视频不变。
    const listed = await tool(session, 'assets_prune', { video: videoId });
    expect(listed.isError).toBe(false);
    expect(listed.body.assets).toEqual([
      expect.objectContaining({ name: '没放上去', kind: 'image', storage: 'managed', byteLength: expect.any(Number) }),
    ]);
    expect(listed.body.revision).toBe(dropped.body.revision.after);
    const spare = listed.body.assets[0].assetId;

    // 还在用的素材：拒绝，不弹确认、不提交。
    const refused = await tool(session, 'assets_prune', { video: videoId, assetIds: [used.asset.id], apply: true });
    expect(refused.body.error).toMatchObject({ code: 'INVALID_OPERATION', details: { rule: 'asset-in-use', assetIds: [used.asset.id] } });

    const pruned = await tool(session, 'assets_prune', { video: videoId, apply: true });
    expect(pruned.body).toMatchObject({ status: 'committed', deletedIds: [spare], removedAssets: [spare] });
    await until(() => !runtime.videos.mirror(videoId)!.video.assets[spare]);
    expect((await tool(session, 'assets_prune', { video: videoId })).body.assets).toEqual([]);
  });

  it('space_list / space_search：会话里的智能体只看本会话来源目录（项目）里的条目，规划模式也能用', async () => {
    const { project: other } = await client.request('projects.create', { name: '别的项目' });
    const elsewhere = await client.request('videos.create', { projectId: other.id, name: '别处' });
    await client.request('space.rescan', {});
    await runtime.space.idle();
    expect((await client.request('space.list', { kind: ['video'] })).entries).toHaveLength(2);

    const { session } = await send('列一下', { accessMode: 'plan' });
    const listed = await tool(session, 'space_list', { kind: ['video'] });
    expect(listed.isError).toBe(false);
    expect(listed.body.entries).toEqual([
      expect.objectContaining({ kind: 'video', name: '样片', projectId: project.id, videoId, path: videoPath }),
    ]);
    expect((await tool(session, 'space_list', { videoId: elsewhere.ref.videoId })).body.entries).toEqual([]);
    const searched = await tool(session, 'space_search', { query: '剪辑' });
    expect(searched.body).toMatchObject({ hits: [], truncated: false });
    expect((await tool(session, 'space_search', { query: ' ' })).isError).toBe(true);
  });

  it('规划模式只读；停止之后一律拒绝', async () => {
    const { taskId, session } = await send('看看', { autonomy: 'plan' });
    const inspected = await tool(session, 'videos_inspect', { video: videoPath });
    expect(inspected.isError).toBe(false);
    const refused = await tool(session, 'edits_apply', {
      video: videoPath,
      expectedRevision: inspected.body.revision,
      label: '加轨道',
      operations: [{ type: 'addTrack', kind: 'visual' }],
    });
    expect(refused.body.error.code).toBe('PLAN_ONLY');
    expect((await tool(session, 'videos_create', { name: '另一部' })).body.error.code).toBe('PLAN_ONLY');
    expect((await items()).some((i) => i.kind === 'video-created')).toBe(false);

    await client.request('tasks.stop', { taskId });
    const stopped = await tool(session, 'videos_inspect', { video: videoPath });
    expect(stopped.body.error.code).toBe('TASK_STOPPED');
    expect(runtime.videos.mirror(videoId)!.video.revision).toBe(inspected.body.revision);
  });

  it('访问模式：修改按决策表自动、询问或拒绝；允许后执行，拒绝、打断与停止都返回明确的错误；中途切换对之后的调用生效', async () => {
    const { taskId, session } = await send('加几条轨道', { accessMode: 'ask' });
    const revision = () => runtime.videos.mirror(videoId)!.video.revision;
    const addTrack = () =>
      tool(session, 'edits_apply', {
        video: videoPath,
        expectedRevision: revision(),
        label: '加轨道',
        operations: [{ type: 'addTrack', kind: 'visual' }],
      });
    /** 等到下一条待处理的审批（统一列表与会话里的审批卡同一个 id）。 */
    const nextPending = async () => {
      const pending = await until(() => runtime.harness.approvals.pending()[0]);
      expect(pending).toMatchObject({
        subject: { kind: 'conversation', conversationId, taskId },
        action: { kind: 'tool', name: 'edits_apply', targets: [videoPath] },
        risk: 'edit',
        expiresAt: null,
      });
      const card = (await items()).find((i) => i.kind === 'approval' && i.approvalId === pending.approvalId);
      expect(card).toMatchObject({ status: 'pending', request: { kind: 'tool', tool: 'edits_apply', files: [videoPath] }, risk: 'edit' });
      return pending;
    };

    // ask：修改要问。用旧的处理方式（agents.respondToApproval）允许，之后才执行。
    const before = revision();
    const first = addTrack();
    const asked = await nextPending();
    expect(revision()).toBe(before);
    expect(await client.request('agents.respondToApproval', { conversationId, approvalId: asked.approvalId, decision: 'accept' })).toEqual({
      status: 'accepted',
    });
    const allowed = await first;
    expect(allowed.isError).toBe(false);
    expect(allowed.body).toMatchObject({ status: 'committed', approval: { mode: 'ask', risk: 'edit', decidedBy: 'user' } });
    expect(revision()).not.toBe(before);

    // 用统一的 approvals.respond 拒绝：工具返回 APPROVAL_DENIED，不改视频。
    const afterFirst = revision();
    const second = addTrack();
    await client.request('approvals.respond', { approvalId: (await nextPending()).approvalId, decision: 'deny' });
    expect((await second).body.error).toMatchObject({ code: 'APPROVAL_DENIED', mode: 'ask', risk: 'edit' });
    expect(revision()).toBe(afterFirst);

    // 打断回复：待处理的取消，工具返回 APPROVAL_CANCELLED。
    const third = addTrack();
    await nextPending();
    await client.request('agents.interrupt', { conversationId });
    expect((await third).body.error).toMatchObject({ code: 'APPROVAL_CANCELLED', mode: 'ask', risk: 'edit' });
    expect(runtime.harness.approvals.pending()).toEqual([]);

    // 任务进行中切到「自动接受修改」：之后的修改不再问，会话里记一条提示。
    await client.request('conversations.update', { conversationId, accessMode: 'autoAcceptEdits' });
    const auto = await addTrack();
    expect(auto.body).toMatchObject({ status: 'committed', approval: { mode: 'autoAcceptEdits', risk: 'edit', decidedBy: 'auto' } });
    expect((await items()).find((i) => i.kind === 'notice' && i.modeChange)).toMatchObject({
      taskId,
      modeChange: { from: 'ask', to: 'autoAcceptEdits' },
    });
    expect((await client.request('conversations.get', { conversationId })).conversation.accessMode).toBe('autoAcceptEdits');

    // 切回 ask（旧值 controlled）后再问；主停止取消待处理的。
    await client.request('conversations.update', { conversationId, accessMode: 'controlled' });
    const fourth = addTrack();
    const last = await nextPending();
    await client.request('tasks.stop', { taskId });
    expect((await fourth).body.error).toMatchObject({ code: 'APPROVAL_CANCELLED' });
    expect((await items()).find((i) => i.kind === 'approval' && i.approvalId === last.approvalId)).toMatchObject({ status: 'cancelled' });
    expect(
      (await items()).filter((i) => i.kind === 'approval').map((i) => i.kind === 'approval' && [i.status, i.decidedBy ?? null]),
    ).toEqual([
      ['accepted', 'user'],
      ['declined', 'user'],
      ['cancelled', null],
      ['cancelled', null],
    ]);
  });

  it('videos_inspect 按 videoId：关掉了的视频按来源目录找到并打开；别的目录里的找不到', async () => {
    const { session } = await send('看看视频');
    // 两个关掉了的视频（流程新建、放下租约之后就是这样）：第一次按 videoId 要扫来源目录，顺带记下看过的每个视频的目录。
    const closed: { videoId: Id; relPath: string; name: string }[] = [];
    for (const name of ['流程新建的', '另一个']) {
      const created = await client.request('videos.create', { projectId: project.id, name });
      await client.request('videos.close', { videoId: created.ref.videoId });
      closed.push({ videoId: created.ref.videoId, relPath: created.ref.relPath, name });
    }
    await until(() => closed.every((v) => runtime.videos.ref(v.videoId) === null));

    for (const { videoId: closedId, relPath, name } of closed) {
      const inspected = await tool(session, 'videos_inspect', { video: closedId });
      expect(inspected.isError, JSON.stringify(inspected.body)).toBe(false);
      expect(inspected.body).toMatchObject({ videoId: closedId, name });
      expect(runtime.videos.ref(closedId)?.relPath).toBe(relPath);
    }

    // 不在会话来源目录里的：找不到，也不会被打开。
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-other-'));
    try {
      const outside = await client.request('videos.create', {
        projectId: (await client.request('projects.open', { path: other })).project.id,
      });
      await client.request('videos.close', { videoId: outside.ref.videoId });
      await until(() => runtime.videos.ref(outside.ref.videoId) === null);
      const missing = await tool(session, 'videos_inspect', { video: outside.ref.videoId });
      expect(missing.body.error).toMatchObject({ code: 'VIDEO_NOT_FOUND' });
      expect(runtime.videos.ref(outside.ref.videoId)).toBeNull();
      const nonsense = await tool(session, 'videos_inspect', { video: newId('video') });
      expect(nonsense.body.error.code).toBe('VIDEO_NOT_FOUND');
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it('videos_delete：风险 high，自动接受修改时也要问；拒绝不动，允许后移进回收站；来源目录之外的视频找不到', async () => {
    const { session } = await send('删掉样片', { accessMode: 'autoAcceptEdits' });
    // 界面开着它时删除被拒绝（VIDEO_IN_USE）：先关掉。
    await client.request('videos.close', { videoId });
    const dir = path.join(project.path, videoPath);
    const asked = async () => {
      const pending = await until(() => runtime.harness.approvals.pending()[0]);
      expect(pending).toMatchObject({ action: { kind: 'tool', name: 'videos_delete', targets: [videoPath] }, risk: 'high' });
      return pending;
    };

    const denied = tool(session, 'videos_delete', { video: videoPath });
    await client.request('approvals.respond', { approvalId: (await asked()).approvalId, decision: 'deny' });
    expect((await denied).body.error).toMatchObject({ code: 'APPROVAL_DENIED', risk: 'high' });
    await fs.access(path.join(dir, 'video.db'));

    const allowed = tool(session, 'videos_delete', { video: videoPath });
    await client.request('approvals.respond', { approvalId: (await asked()).approvalId, decision: 'allow' });
    const done = await allowed;
    expect(done.isError).toBe(false);
    expect(done.body).toMatchObject({ status: 'trashed', videoId, name: '样片', approval: { risk: 'high', decidedBy: 'user' } });
    await expect(fs.stat(dir)).rejects.toThrow();
    expect((await client.request('space.list', { trash: 'only' })).entries.map((e) => e.id)).toEqual([done.body.entryId]);

    // 不在会话来源目录里的（或不存在的）：不问，直接找不到。
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-other-'));
    try {
      const outside = await client.request('videos.create', {
        projectId: (await client.request('projects.open', { path: other })).project.id,
      });
      const missing = await tool(session, 'videos_delete', { video: path.join(other, outside.ref.relPath) });
      expect(missing.body.error).toMatchObject({ code: 'VIDEO_NOT_FOUND' });
      expect(runtime.harness.approvals.pending()).toEqual([]);
      await client.request('videos.close', { videoId: outside.ref.videoId });
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it('会话删除后令牌失效，智能体打开的视频按宽限期关闭', async () => {
    const { session } = await send('读一下');
    // 界面先关掉它，只剩智能体打开着。
    await client.request('videos.close', { videoId });
    await tool(session, 'videos_inspect', { video: videoPath });
    expect(runtime.videos.ref(videoId)).not.toBeNull();

    session.finish();
    await client.request('conversations.delete', { conversationId });
    const server = session.options.mcpServers!.baocut!;
    expect((await post(server.url, server.headers, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
    await until(() => runtime.videos.ref(videoId) === null);
  });
});
