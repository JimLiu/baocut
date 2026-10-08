import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { editorWasmAvailable } from '@baocut/jobs';
import { newId, type CatalogCallResult, type Id, type JobRecord, type Project, type VideoItem } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { OPERATION_TYPES } from './edit-ops.ts';
import { TOOL_RISK } from './tool-scope.ts';
import { ToolDriver, tool, until, type Loose } from './testing/fake-agent.ts';

/**
 * 对象的读写工具端到端（架构设计 §3.5，Agent 面设计 §4.3）：`assets_import`、`documents_put`、`videos_frames`、
 * `videos_history`、`videos_import_package`、`edits_ops` 经终端的 `catalog.call`（`LocalPrincipal`）落到真实的引擎里；
 * 取帧与写文档另经会话里的智能体（规划模式）核对风险。需要 engine-host 与 ffmpeg，缺了就跳过。
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

const words = [
  { id: 'w1', start: 0, end: 500, text: 'Hello' },
  { id: 'w2', start: 500, end: 1000, text: 'there.' },
  { id: 'w3', start: 1100, end: 1500, text: 'Good' },
  { id: 'w4', start: 1500, end: 1900, text: 'morning.' },
];
const speechBody = (list: typeof words) => ({
  schema: 'baocut.speech/1',
  clock: 'source-asset',
  timescale: 1000,
  speakers: [],
  words: list,
  sentences: null,
  chapters: [],
});

async function header(file: string, length: number): Promise<Buffer> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

describe.skipIf(!engine || !ffmpeg)('对象的读写工具（终端目录，真实引擎）', () => {
  let fixtures: string;
  let clip: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-object-tools-fixtures-'));
    clip = path.join(fixtures, 'clip.mp4');
    // 1920×1080：取帧的默认长边上限（1280）要真的缩小。
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=2'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', clip],
    ]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-object-tools-')));
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'cli', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '对象工具' }));
    await fs.mkdir(path.join(project.path, 'media'));
    await fs.copyFile(clip, path.join(project.path, 'media', 'clip.mp4'));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function call(name: string, args: unknown, cwd = project.path): Promise<CatalogCallResult> {
    return client.request('catalog.call', { name, args, cwd });
  }

  async function ok(name: string, args: unknown, cwd = project.path): Promise<Loose> {
    const outcome = await call(name, args, cwd);
    if (!outcome.ok) throw new Error(`${name} 失败：${JSON.stringify(outcome.error)}`);
    return outcome.result;
  }

  async function code(name: string, args: unknown): Promise<string | undefined> {
    const outcome = await call(name, args);
    return outcome.ok ? undefined : outcome.error.code;
  }

  const video = (videoId: Id) => runtime.videos.mirror(videoId)!.video;
  const items = (videoId: Id) => video(videoId).sequences[video(videoId).rootSequenceId]!.items;

  /** 新建一个视频，把 media/clip.mp4 导入并放到 0 秒。 */
  async function placedVideo(name: string): Promise<{ videoId: Id; assetId: Id; itemId: Id }> {
    const created = await ok('videos_create', { name });
    const imported = await ok('assets_import', { video: created.videoId, path: 'media/clip.mp4', place: { at: '0' } });
    return { videoId: created.videoId, assetId: imported.assetId, itemId: imported.itemId };
  }

  it('风险与效果：写入的两件 sugar 与 edits_apply 同级，取帧与查询只读', async () => {
    expect(TOOL_RISK.documents_put).toBe(TOOL_RISK.edits_apply);
    expect(TOOL_RISK.assets_import).toBe(TOOL_RISK.edits_apply);
    expect(TOOL_RISK.videos_import_package).toBe(TOOL_RISK.videos_create);
    for (const name of ['videos_frames', 'videos_history', 'edits_ops']) expect(TOOL_RISK[name]).toBe('read');
    const { tools } = await client.request('catalog.list', {});
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['videos_frames', 'videos_history', 'videos_import_package', 'documents_put', 'assets_import', 'edits_ops']),
    );
  });

  it('assets_import 编译成 importAsset + addItem（一笔）；不给 place 只登记；at 放到那一秒', async () => {
    const created = await ok('videos_create', { name: '导入' });
    const videoId = created.videoId as Id;
    const placed = await ok('assets_import', { video: videoId, path: 'media/clip.mp4', place: {} });
    expect(placed).toMatchObject({ status: 'committed', assetId: expect.any(String), itemId: expect.any(String) });
    expect(placed.revision).toMatchObject({ before: created.revision });
    const item = items(videoId).find((i) => i.id === placed.itemId) as VideoItem;
    expect(item).toMatchObject({ type: 'video', assetRef: { id: placed.assetId }, span: { fromFrame: 0 } });
    expect(video(videoId).assets[placed.assetId]).toBeDefined();

    // 只登记：itemId 为 null，时间线不变。
    const before = items(videoId).length;
    const registered = await ok('assets_import', { video: videoId, path: 'media/clip.mp4', name: '再导一次', storage: 'managed' });
    expect(registered).toMatchObject({ status: 'committed', itemId: null, assetId: expect.any(String) });
    expect(items(videoId)).toHaveLength(before);

    // at 是秒数：落在 5 秒（30 fps 的第 150 帧），接在指定的轨道上。
    const atFive = await ok('assets_import', {
      video: videoId,
      path: 'media/clip.mp4',
      place: { track: item.trackId, at: '5' },
      revision: registered.revision.after,
    });
    expect(items(videoId).find((i) => i.id === atFive.itemId)).toMatchObject({ trackId: item.trackId, span: { fromFrame: 150 } });

    expect(await code('assets_import', { video: videoId })).toBe('INVALID_ARGUMENTS');
    expect(await code('assets_import', { video: videoId, path: 'media/clip.mp4', artifactId: 'sha256:00' })).toBe('INVALID_ARGUMENTS');
    expect(await code('assets_import', { video: videoId, path: 'media/clip.mp4', revision: '1' })).toBeDefined();
  });

  it('videos_frames：时刻 → 最上层的视频片段 → 素材帧，写进 cwd 的 .baocut-out/frames/<videoId>/', async () => {
    const { videoId, assetId, itemId } = await placedVideo('取帧');
    const frames = await ok('videos_frames', { video: videoId, at: ['0.5', '1', '3'] });
    const framesDir = path.join(project.path, '.baocut-out', 'frames', videoId);
    expect(frames).toMatchObject({ videoId, composited: false, note: expect.stringContaining('不是合成') });
    expect(frames.frames).toHaveLength(3);
    expect(frames.frames[0]).toMatchObject({ at: '0.5', item: itemId, asset: assetId, width: 1280, height: 720 });
    expect(frames.frames[0].file).toBe(path.join(framesDir, 'at-500ms.png'));
    expect(await header(frames.frames[0].file, 4)).toEqual(PNG);
    expect(frames.frames[1].file).toBe(path.join(framesDir, 'at-1000ms.png'));
    // 3 秒处时间线上没有视频片段：不是错误，file 为 null。
    expect(frames.frames[2]).toEqual({ at: '3', file: null });

    // 上面一条视觉轨（order 更大）上的片段盖住下面的：取它。
    const inspected = await ok('videos_inspect', { video: videoId });
    const added = await ok('edits_apply', {
      video: videoId,
      expectedRevision: inspected.revision,
      label: '加一条视觉轨',
      operations: [{ type: 'addTrack', kind: 'visual', name: '上层' }],
    });
    const tracks = () => video(videoId).sequences[video(videoId).rootSequenceId]!.tracks;
    const upperTrack = tracks().find((t) => added.createdIds.includes(t.id))!;
    const lowerTrack = (items(videoId).find((i) => i.id === itemId) as VideoItem).trackId;
    expect(upperTrack.order).toBeGreaterThan(tracks().find((t) => t.id === lowerTrack)!.order);
    const upper = await ok('assets_import', { video: videoId, path: 'media/clip.mp4', place: { track: upperTrack.id, at: '0.5' } });
    expect(items(videoId).find((i) => i.id === upper.itemId)).toMatchObject({ trackId: upperTrack.id });
    const stacked = await ok('videos_frames', { video: videoId, at: ['0.2', '1'] });
    expect(stacked.frames.map((f: Loose) => f.item)).toEqual([itemId, upper.itemId]);

    // range + count：等间隔、从起点开始；jpeg 与 maxWidth。
    const ranged = await ok('videos_frames', { video: videoId, range: '0:2', count: 4, format: 'jpeg', maxWidth: 640 });
    expect(ranged.frames.map((f: Loose) => f.at)).toEqual(['0', '0.5', '1', '1.5']);
    for (const frame of ranged.frames) {
      expect(frame).toMatchObject({ width: 640, height: 360 });
      expect(frame.file.endsWith('.jpg')).toBe(true);
      expect(await header(frame.file, 3)).toEqual(JPEG);
    }

    expect(await code('videos_frames', { video: videoId, at: ['1'], range: '0:1' })).toBe('INVALID_ARGUMENTS');
    expect(await code('videos_frames', { video: videoId })).toBe('INVALID_ARGUMENTS');
    expect(await code('videos_frames', { video: videoId, range: '2:1' })).toBe('INVALID_ARGUMENTS');
    expect(await code('videos_frames', { video: videoId, at: ['1'], count: 2 })).toBe('INVALID_ARGUMENTS');
    expect(await code('videos_frames', { video: videoId, at: Array.from({ length: 25 }, (_, i) => String(i)) })).toBe('INVALID_ARGUMENTS');
  });

  it('documents_put 编译成 putDocument：新建、替换（kind 不变）、相同正文不产生新版本；参数不全时拒绝', async () => {
    const { videoId, assetId } = await placedVideo('文档');
    const created = await ok('documents_put', {
      video: videoId,
      kind: 'speech',
      language: 'en',
      sourceAsset: assetId,
      body: speechBody(words),
    });
    expect(created).toMatchObject({ status: 'committed', documentId: expect.any(String), label: '新建文档「speech」' });
    const documentId = created.documentId as Id;
    expect(video(videoId).documents[documentId]).toMatchObject({ kind: 'speech', language: 'en', sourceAssetId: assetId });
    const firstRevision = video(videoId).documents[documentId]!.currentRevision;

    const fixed = words.map((w) => (w.id === 'w1' ? { ...w, text: 'Hi' } : w));
    const replaced = await ok('documents_put', { video: videoId, document: documentId, body: speechBody(fixed), label: '改一个词' });
    expect(replaced).toMatchObject({ status: 'committed', documentId, label: '改一个词' });
    expect(video(videoId).documents[documentId]).toMatchObject({ kind: 'speech', language: 'en' });
    expect(video(videoId).documents[documentId]!.currentRevision).not.toBe(firstRevision);
    const read = await ok('documents_read', { video: videoId, documentId });
    expect(read.body.words[0].text).toBe('Hi');
    // 正文与原来相同：文档不产生新版本。
    const current = video(videoId).documents[documentId]!.currentRevision;
    await call('documents_put', { video: videoId, document: documentId, body: speechBody(fixed) });
    expect(video(videoId).documents[documentId]!.currentRevision).toBe(current);

    expect(await code('documents_put', { video: videoId, document: documentId, kind: 'translation', body: {} })).toBe('INVALID_ARGUMENTS');
    expect(await code('documents_put', { video: videoId, body: {} })).toBe('INVALID_ARGUMENTS');
    expect(await code('documents_put', { video: videoId, kind: 'translation', sourceDocument: documentId, body: {} })).toBe(
      'INVALID_ARGUMENTS',
    );
    expect(await code('documents_put', { video: videoId, document: 'doc_nope', body: {} })).toBe('DOCUMENT_NOT_FOUND');
    expect(await code('documents_put', { video: videoId, kind: 'translation', language: 'en', sourceDocument: 'doc_nope', body: {} })).toBe(
      'DOCUMENT_NOT_FOUND',
    );
  });

  it.skipIf(!editorWasmAvailable())(
    '翻译的路径：documents_read → documents_put（alignment 为 null，Runtime 补上）→ captions_create',
    async () => {
      const { videoId, assetId } = await placedVideo('翻译');
      const speech = await ok('documents_put', {
        video: videoId,
        kind: 'speech',
        language: 'en',
        sourceAsset: assetId,
        body: speechBody(words),
      });
      const read = await ok('documents_read', { video: videoId, documentId: speech.documentId });
      const basis = read.translationBasis;
      expect(basis.sentences).toHaveLength(2);
      const texts = ['你好。', '早上好。'];
      const translated = await ok('documents_put', {
        video: videoId,
        kind: 'translation',
        language: 'zh-Hans',
        sourceDocument: speech.documentId,
        body: {
          schema: 'baocut.translation/2',
          language: 'zh-Hans',
          sourceBasis: basis.sourceBasis,
          units: basis.sentences.map((s: Loose, i: number) => ({
            id: `t-${s.id}`,
            sourceSentenceId: s.id,
            sourceFingerprint: s.fingerprint,
            naturalText: texts[i],
            alignment: null,
            status: 'draft',
          })),
        },
      });
      expect(translated).toMatchObject({ status: 'committed', filledAlignments: 2, label: '新建文档「zh-Hans 译文」' });
      expect(video(videoId).documents[translated.documentId]).toMatchObject({ kind: 'translation', sourceDocumentId: speech.documentId });
      const captions = await ok('captions_create', { video: videoId, documentId: translated.documentId });
      expect(captions).toMatchObject({ documentId: expect.any(String), cueCount: expect.any(Number) });
    },
  );

  it('videos_history：最近的修改在前，带撤销状态与检查点；limit 截断', async () => {
    const { videoId } = await placedVideo('历史');
    const inspected = await ok('videos_inspect', { video: videoId });
    await ok('edits_apply', {
      video: videoId,
      expectedRevision: inspected.revision,
      label: '留个检查点',
      operations: [{ type: 'createCheckpoint', name: '初剪', note: '放好素材' }],
    });
    const history = await ok('videos_history', { video: videoId });
    expect(history.videoId).toBe(videoId);
    expect(history.entries.map((e: Loose) => e.label).slice(0, 2)).toEqual(['留个检查点', '导入 clip.mp4 并放到时间线上']);
    expect(history.entries[0]).toMatchObject({ by: 'user', undone: false, undoAvailable: true, committedAt: expect.any(String) });
    expect(history.checkpoints).toEqual([expect.objectContaining({ name: '初剪', note: '放好素材', revision: expect.any(String) })]);
    expect((await ok('videos_history', { video: videoId, limit: 1 })).entries).toHaveLength(1);
  });

  it('edits_ops：按操作族列出全部操作的说明、JSON Schema 与示例；op 只看一个', async () => {
    const all = await ok('edits_ops', {});
    const listed = all.families.flatMap((f: Loose) => f.operations.map((o: Loose) => o.type));
    expect([...listed].sort()).toEqual([...OPERATION_TYPES].sort());
    expect(all.conventions).toContain('秒');
    const one = await ok('edits_ops', { op: 'addItem' });
    expect(one.operation).toMatchObject({ type: 'addItem', family: 'items', example: { type: 'addItem' } });
    expect(one.operation.schema).toMatchObject({ type: 'object', properties: { type: expect.any(Object), asset: expect.any(Object) } });
    expect(await code('edits_ops', { op: 'noSuchOp' })).toBe('INVALID_ARGUMENTS');
  });

  it('videos_import_package：便携包打开成新视频；name 定目录名与视频名，不给时用包里的', async () => {
    const { videoId } = await placedVideo('原片');
    const { jobId } = await client.request('exports.create', { videoId, settings: { kind: 'portable' }, commandId: newId('cmd') });
    const job = await until(async () => {
      const record: JobRecord = await client.request('exports.get', { jobId });
      return ['completed', 'failed', 'cancelled'].includes(record.state) && record;
    });
    expect(job.state).toBe('completed');
    const packageFile = job.result!.outputs![0]!.path!;
    expect(path.dirname(packageFile)).toBe(path.join(project.path, 'exports'));

    const renamed = await ok('videos_import_package', { file: path.relative(project.path, packageFile), name: '审阅副本' });
    expect(renamed.videoId).not.toBe(videoId);
    expect(renamed).toMatchObject({ name: '审阅副本', video: '审阅副本' });
    expect((await fs.stat(path.join(project.path, '审阅副本', 'video.db'))).isFile()).toBe(true);
    expect(Object.keys(video(renamed.videoId).assets)).toHaveLength(Object.keys(video(videoId).assets).length);

    const plain = await ok('videos_import_package', { file: packageFile });
    expect(plain.name).toBe('原片');
    expect(plain.video).not.toBe('原片');

    expect(await code('videos_import_package', { file: 'exports/missing.baocut' })).toBeDefined();
  });
});

describe.skipIf(!engine || !ffmpeg)('对象的读写工具：会话里的智能体（真实引擎）', () => {
  let fixtures: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let driver: ToolDriver;
  let project: Project;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-object-agent-fixtures-'));
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2'],
      ...['-c:v', 'mpeg4', path.join(fixtures, 'clip.mp4')],
    ]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-object-agent-')));
    driver = new ToolDriver();
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [driver],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '智能体取帧' }));
    await fs.copyFile(path.join(fixtures, 'clip.mp4'), path.join(project.path, 'clip.mp4'));
  });

  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('规划模式：videos_frames 与查询照常，documents_put 与 assets_import 拒绝（PLAN_ONLY）', async () => {
    const opened = await client.request('videos.create', { projectId: project.id, name: '样片' });
    const videoId = opened.ref.videoId;
    await client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: opened.snapshot.video.revision,
      operations: [
        { type: 'importAsset', path: path.join(project.path, 'clip.mp4'), ref: 'a' },
        { type: 'addItem', sequenceId: opened.snapshot.video.rootSequenceId, asset: { ref: 'a' }, alignment: 'nearest-frame' },
      ],
    });
    const {
      conversation: { id: conversationId },
    } = await client.request('conversations.create', { projectId: project.id });
    await client.request('conversations.send', { conversationId, text: '看看画面', commandId: newId('cmd'), autonomy: 'plan' });
    const session = await until(() => driver.sessions.find((s) => s.turnId));
    await until(() => runtime.harness.agentRun(conversationId).taskId);
    const video = opened.ref.relPath;

    const frames = await tool(session, 'videos_frames', { video, at: ['1'] });
    expect(frames.isError).toBe(false);
    expect(path.dirname(frames.body.frames[0].file)).toBe(path.join(await fs.realpath(project.path), '.baocut-out', 'frames', videoId));
    expect(frames.body.frames[0]).toMatchObject({ width: 320, height: 180 });
    expect((await tool(session, 'videos_history', { video })).isError).toBe(false);
    expect((await tool(session, 'edits_ops', { op: 'putDocument' })).body.operation.type).toBe('putDocument');

    const revision = runtime.videos.mirror(videoId)!.video.revision;
    const put = await tool(session, 'documents_put', { video, kind: 'notes', body: { text: '计划' } });
    expect(put.body.error.code).toBe('PLAN_ONLY');
    const imported = await tool(session, 'assets_import', { video, path: 'clip.mp4' });
    expect(imported.body.error.code).toBe('PLAN_ONLY');
    expect(runtime.videos.mirror(videoId)!.video.revision).toBe(revision);
  });
});
