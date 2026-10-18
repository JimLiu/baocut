import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyVideoTopicEvent } from '@baocut/client';
import { RpcError, newId, type EngineErrorBody, type VideoTopicEvent, type VideoTopicSnapshot, type Project } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { storedZip } from '@baocut/runtime-storage/testing';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { resolveEngineHostCommand } from './engine-host.ts';

/**
 * 端到端：真实的 Runtime、网关、客户端与 Rust 视频引擎进程。
 * 需要先 `npm run build:engine`，素材用 ffmpeg 现场生成；缺任何一个就跳过（并在输出里说明）。
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
if (!engine) console.warn('跳过视频端到端测试：没有构建 engine-host（npm run build:engine）');
if (!ffmpeg) console.warn('跳过视频端到端测试：没有 ffmpeg');

/** 直接读视频库的 meta 表（只读）：所属项目与曾用的 videoId 不在公共协议里。别的读者（Space 的扫描、引擎）正占着锁时等它放开。 */
function videoMeta(videoDir: string): Record<string, string | undefined> {
  const db = new DatabaseSync(path.join(videoDir, 'video.db'), { readOnly: true, timeout: 5000 });
  try {
    const rows = db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  } finally {
    db.close();
  }
}

async function until<T>(read: () => T | undefined | null | false, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function eventually<T>(read: () => Promise<T | undefined | null | false>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
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

describe.skipIf(!engine || !ffmpeg)('视频（真实引擎）', () => {
  let fixtures: string;
  let clip: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fixtures-'));
    clip = path.join(fixtures, 'clip.mp4');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x180:rate=30:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
      '-shortest',
      clip,
    ]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-test-'));
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      videoSnapshotDelayMs: 50,
    });
    client = await connect();
    ({ project } = await client.request('projects.create', { name: '视频测试' }));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function connect(): Promise<BaoCutClient> {
    const { endpoint, token } = runtime.discovery;
    const next = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await next.connect();
    return next;
  }

  /** 经订阅维护的镜像，与界面拿到的一致。 */
  function watch(target: BaoCutClient, videoId: string) {
    let current: VideoTopicSnapshot | null = null;
    const events: VideoTopicEvent['type'][] = [];
    target.subscribeVideo(videoId, {
      snapshot: (snapshot) => {
        current = snapshot;
      },
      event: (event) => {
        events.push(event.type);
        current = current && applyVideoTopicEvent(current, event);
      },
    });
    return { get: () => current, events, ready: until(() => current) };
  }

  const sequences = new Map<string, string>();

  async function importClip(videoId: string, revision: string, commandId = newId('cmd')) {
    return client.request('edits.apply', {
      videoId,
      commandId,
      expectedRevision: revision,
      operations: [
        { type: 'importAsset', path: clip, ref: 'clip' },
        { type: 'addItem', sequenceId: sequences.get(videoId)!, asset: { ref: 'clip' }, alignment: 'nearest-frame' },
      ],
    });
  }

  async function create(target: BaoCutClient = client, name?: string) {
    const opened = await target.request('videos.create', { projectId: project.id, ...(name ? { name } : {}) });
    sequences.set(opened.ref.videoId, opened.snapshot.video.rootSequenceId);
    return opened;
  }

  it('关闭视频时清理 blobs/：没有引用的 blob 删掉，仍被引用的与新鲜的 staging 留着；还有租约时不关闭也不清理', async () => {
    const { ref, snapshot } = await create(client, 'GC');
    await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: snapshot.video.revision,
      operations: [{ type: 'importAsset', path: clip, storage: 'managed' }],
    });
    const blobs = path.join(ref.path, 'blobs');
    const [managed] = await fs.readdir(blobs).then((names) => names.filter((name) => name !== '.staging'));
    const orphan = path.join(blobs, `${'a'.repeat(64)}.mp4`);
    const fresh = path.join(blobs, '.staging', 'import_fresh');
    await fs.writeFile(orphan, 'orphan');
    await fs.writeFile(fresh, 'being written');

    // 有租约：打开者走了也不关闭，不清理。
    runtime.videos.retain(ref.videoId);
    await client.request('videos.close', { videoId: ref.videoId });
    expect(runtime.videos.mirror(ref.videoId)).not.toBeNull();
    await expect(fs.stat(orphan)).resolves.toBeTruthy();

    // 租约放下后按宽限期关闭，关闭前清理。
    runtime.videos.release(ref.videoId);
    await until(() => runtime.videos.mirror(ref.videoId) === null);
    await until(() => !existsSync(orphan));
    expect(existsSync(path.join(blobs, managed!))).toBe(true);
    expect(existsSync(fresh)).toBe(true);
  });

  it('新建、导入并添加；回执到达时镜像已经应用了事件，与引擎重新读出的快照一致', async () => {
    const { ref, snapshot } = await create(client, '第一部');
    expect(ref.relPath).toBe('第一部');
    expect(ref.source.projectId).toBe(project.id);
    const root = snapshot.video.sequences[snapshot.video.rootSequenceId]!;
    expect(root.tracks.map((t) => t.kind)).toEqual(['visual', 'audio']);

    const view = watch(client, ref.videoId);
    await view.ready;
    const { receipt, replayed } = await importClip(ref.videoId, snapshot.video.revision);
    expect(replayed).toBe(false);
    // 引擎起的修改名是英文与引用，界面按读者的语言显示（命令与协议规范 §3.1）。
    expect([receipt.label, receipt.labelRef]).toEqual(['Add clip', { key: 'engine.labelAddClip' }]);
    expect(receipt.actor).toEqual({ kind: 'user', id: 'user_local' });
    // 事件先于响应：拿到回执时镜像已经是新版本（产品设计：收到回执之前不显示「已保存」）。
    expect(view.get()!.video.revision).toBe(receipt.videoRevision);
    expect(view.get()!.eventSeq).toBe(receipt.eventSeq);
    expect(runtime.videos.mirror(ref.videoId)).toEqual(view.get());

    // 关掉再打开：引擎从磁盘读出的快照与镜像一致。
    const before = view.get()!;
    await client.request('videos.close', { videoId: ref.videoId });
    expect(runtime.videos.mirror(ref.videoId)).toBeNull();
    const reopened = await client.request('videos.open', { projectId: project.id, path: '第一部' });
    expect(reopened.ref.videoId).toBe(ref.videoId);
    expect(reopened.ref.relPath).toBe('第一部');
    expect(reopened.ref.path).toBe(ref.path);
    expect(reopened.snapshot).toEqual(before);

    // Space 把视频目录列成一个条目。
    await runtime.space.rescan();
    const entries = runtime.space.snapshot().entries.filter((e) => e.source.projectId === project.id);
    expect(entries.map((e) => [e.kind, e.relPath])).toEqual([['video', '第一部']]);
    const fromSpace = await client.request('videos.open', { entryId: entries[0]!.id });
    expect(fromSpace.ref.videoId).toBe(ref.videoId);
    expect(fromSpace.ref.relPath).toBe('第一部');
  });

  it('同名新建加序号；同一个 commandId 新建只建一次', async () => {
    const commandId = newId('cmd');
    const a = await client.request('videos.create', { projectId: project.id, name: '同名', commandId });
    const again = await client.request('videos.create', { projectId: project.id, name: '同名', commandId });
    const b = await client.request('videos.create', { projectId: project.id, name: '同名' });
    expect(again.ref.videoId).toBe(a.ref.videoId);
    expect(b.ref.relPath).toBe('同名 2');
  });

  it('重试与冲突：同一个命令返回同一份回执、不发新事件；旧版本号被拒绝', async () => {
    const { ref, snapshot } = await create();
    const view = watch(client, ref.videoId);
    await view.ready;
    const commandId = newId('cmd');
    const first = await importClip(ref.videoId, snapshot.video.revision, commandId);
    const again = await importClip(ref.videoId, snapshot.video.revision, commandId);
    expect(again.replayed).toBe(true);
    expect(again.receipt).toEqual(first.receipt);
    expect(view.events).toEqual(['video.event']);

    const stale = await rejection(importClip(ref.videoId, snapshot.video.revision));
    expect(stale.code).toBe('conflict');
    expect((stale.details as EngineErrorBody).code).toBe('PROJECT_REVISION_CONFLICT');

    const bad = await rejection(
      client.request('edits.apply', {
        videoId: ref.videoId,
        commandId: newId('cmd'),
        expectedRevision: first.receipt.videoRevision,
        operations: [
          {
            type: 'moveItem',
            sequenceId: snapshot.video.rootSequenceId,
            itemId: 'item_nope',
            at: { unit: 'seconds', value: 1 },
            alignment: 'nearest-frame',
          } as never,
        ],
      }),
    );
    expect(bad.code).toBe('invalid-request');
    expect((bad.details as EngineErrorBody).code).toBe('INVALID_TIME_VALUE');
  });

  it('撤销与重做：按操作者算可撤销的一步，经主题同步', async () => {
    const { ref, snapshot } = await create();
    const view = watch(client, ref.videoId);
    await view.ready;
    const added = await importClip(ref.videoId, snapshot.video.revision);
    const itemId = added.receipt.createdIds.find((id) => id.startsWith('item'))!;
    const moved = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: added.receipt.videoRevision,
      operations: [
        {
          type: 'moveItem',
          sequenceId: snapshot.video.rootSequenceId,
          itemId,
          at: { unit: 'seconds', value: '1' },
          alignment: 'nearest-frame',
        },
      ],
    });
    expect((await client.request('edits.undoState', { videoId: ref.videoId })).undo).toMatchObject({
      label: 'Move clips',
      labelRef: { key: 'engine.labelMoveClips' },
    });

    const undone = await client.request('edits.undo', { videoId: ref.videoId, commandId: newId('cmd'), target: 'undo' });
    expect(undone.receipt.undoOf).toBe(moved.receipt.transactionId);
    const item = view.get()!.video.sequences[snapshot.video.rootSequenceId]!.items.find((i) => i.id === itemId)!;
    expect(item.type === 'video' && item.span.fromFrame).toBe(0);

    const state = await client.request('edits.undoState', { videoId: ref.videoId });
    expect(state.redo?.label).toBe('Move clips');
    await client.request('edits.undo', { videoId: ref.videoId, commandId: newId('cmd'), target: 'redo' });
    const redone = view.get()!.video.sequences[snapshot.video.rootSequenceId]!.items.find((i) => i.id === itemId)!;
    expect(redone.type === 'video' && redone.span.fromFrame).toBe(30);

    const { entries } = await client.request('videos.history', { videoId: ref.videoId });
    expect(entries.map((e) => e.label)).toEqual(['Redo: Move clips', 'Undo: Move clips', 'Move clips', 'Add clip']);
    expect(entries[1]!.labelRef).toEqual({
      key: 'engine.labelUndo',
      params: { label: { key: 'engine.labelMoveClips', text: 'Move clips' } },
    });
  });

  it('调用方给的修改名带着引用经网关存下（命令与协议规范 §3.1）', async () => {
    const { ref, snapshot } = await create();
    const labelRef = { key: 'editLabel.renameVideo' };
    const renamed = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: snapshot.video.revision,
      operations: [{ type: 'renameVideo', name: '改名' }],
      label: 'Rename video',
      labelRef,
    });
    expect([renamed.receipt.label, renamed.receipt.labelRef]).toEqual(['Rename video', labelRef]);
    const { entries } = await client.request('videos.history', { videoId: ref.videoId });
    expect(entries[0]!.labelRef).toEqual(labelRef);

    const bad = await rejection(
      client.request('edits.apply', {
        videoId: ref.videoId,
        commandId: newId('cmd'),
        expectedRevision: renamed.receipt.videoRevision,
        operations: [{ type: 'renameVideo', name: '再改' }],
        label: 'Rename video',
        labelRef: { key: 'no-area' },
      }),
    );
    expect(bad.code).toBe('invalid-request');
  });

  it('文档正文不进快照，按需读出；不给版本时读当前版本', async () => {
    const { ref, snapshot } = await create();
    const body = {
      schema: 'baocut.caption/1',
      clock: 'sequence',
      timescale: 1_000_000,
      cues: [{ id: 'c1', start: 0, end: 1, text: '你好' }],
    };
    const put = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: snapshot.video.revision,
      operations: [{ type: 'putDocument', kind: 'caption', name: '字幕', body }],
    });
    const documentId = put.receipt.createdIds.find((id) => id.startsWith('doc'))!;
    const read = await client.request('documents.read', { videoId: ref.videoId, documentId });
    expect(read.body).toEqual(body);
    expect(read.document.kind).toBe('caption');
    expect(read.revision).toBe(read.document.currentRevision);
    await expect(client.request('documents.read', { videoId: ref.videoId, documentId: 'doc_missing' })).rejects.toThrow();
  });

  /** 视频目录 `blobs/` 下复制进来的 bytes（不含 `.staging`）。 */
  async function collectedBlobs(videoDir: string): Promise<string[]> {
    const names = await fs.readdir(path.join(videoDir, 'blobs')).catch(() => [] as string[]);
    return names.filter((name) => name !== '.staging');
  }

  it('默认导入链接原文件：blobs/ 下没有新 bytes，素材经媒体通道取得，支持 Range', async () => {
    const { ref, snapshot } = await create();
    const added = await importClip(ref.videoId, snapshot.video.revision);
    const assetId = added.receipt.createdIds.find((id) => id.startsWith('asset'))!;
    const asset = runtime.videos.mirror(ref.videoId)!.video.assets[assetId]!;
    expect(asset.revisions[asset.currentRevision]!.storage).toMatchObject({ mode: 'linked', locator: { path: clip } });
    expect(await collectedBlobs(ref.path)).toEqual([]);
    const handle = await client.request('media.resolve', { videoId: ref.videoId, assetId });
    expect(handle.fileName).toBe('clip.mp4');
    expect(handle.mimeType).toBe('video/mp4');
    const response = await fetch(handle.url, { headers: { Range: 'bytes=0-9' } });
    expect(response.status).toBe(206);
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it('取素材位置时视频被关掉：回「视频没有打开」，不抛内部错误', async () => {
    const { ref, snapshot } = await create();
    const added = await importClip(ref.videoId, snapshot.video.revision);
    const assetId = added.receipt.createdIds.find((id) => id.startsWith('asset'))!;
    const [opener] = runtime.videos.usage(ref.videoId)!.openers;
    // 请求先到引擎、还没回话时关掉视频（空闲关闭就是这样落在一批 media.resolve 中间的）：等一轮事件循环让它先发出去。
    const refused = rejection(runtime.videos.assetFile(ref.videoId, assetId));
    await new Promise((resolve) => setImmediate(resolve));
    await runtime.videos.close(ref.videoId, { connectionId: opener!, kind: 'desktop', name: 'test' });
    const error = await refused;
    expect(error.code).toBe('not-found');
    expect(error.details).toMatchObject({ code: 'VIDEO_NOT_OPEN' });
  });

  it('显式 managed 才复制进视频目录；之后原文件删掉也照样取得', async () => {
    const { ref, snapshot } = await create();
    const copy = path.join(fixtures, 'managed-copy.mp4');
    await fs.copyFile(clip, copy);
    const imported = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: snapshot.video.revision,
      operations: [{ type: 'importAsset', path: copy, storage: 'managed', ref: 'clip' }],
    });
    const assetId = imported.receipt.refs!.clip!;
    const asset = runtime.videos.mirror(ref.videoId)!.video.assets[assetId]!;
    const revision = asset.revisions[asset.currentRevision]!;
    expect(revision.storage).toEqual({ mode: 'managed' });
    expect(await collectedBlobs(ref.path)).toEqual([`${revision.contentHash.replace('sha256:', '')}.mp4`]);
    await fs.rm(copy);
    const handle = await client.request('media.resolve', { videoId: ref.videoId, assetId });
    expect((await fetch(handle.url)).status).toBe(200);

    // 显式 managed 要求绝对路径。
    const relative = await rejection(
      client.request('edits.apply', {
        videoId: ref.videoId,
        commandId: newId('cmd'),
        expectedRevision: imported.receipt.videoRevision,
        operations: [{ type: 'importAsset', path: '../clip.mp4', storage: 'managed' }],
      }),
    );
    expect((relative.details as EngineErrorBody).code).toBe('INVALID_OPERATION');
  });

  it('链接素材按类型放行：图片、音视频、字体与 Lottie 可以预览，字幕与别的文件不放行', async () => {
    const { ref, snapshot } = await create();
    const image = path.join(fixtures, 'still.png');
    const tone = path.join(fixtures, 'tone.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', image]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', tone]);
    const files = {
      image,
      tone,
      logo: path.join(fixtures, 'logo.svg'),
      font: path.join(fixtures, 'title.otf'),
      captions: path.join(fixtures, 'captions.vtt'),
      note: path.join(fixtures, 'note.json'),
    };
    await fs.writeFile(files.logo, "<svg xmlns='http://www.w3.org/2000/svg'/>");
    await fs.writeFile(files.font, Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(60)]));
    await fs.writeFile(files.captions, 'WEBVTT\n\n00:00.000 --> 00:01.000\n你好\n');
    await fs.writeFile(files.note, '{"secret":true}');
    const linked = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: snapshot.video.revision,
      operations: [
        { type: 'importAsset', path: clip, ref: 'clip' },
        ...Object.entries(files).map(([key, file]) => ({ type: 'importAsset' as const, path: file, ref: key })),
      ],
    });
    const refs = linked.receipt.refs!;
    const video = runtime.videos.mirror(ref.videoId)!.video;
    for (const id of Object.values(refs)) {
      const asset = video.assets[id]!;
      expect(asset.revisions[asset.currentRevision]!.storage.mode, asset.name).toBe('linked');
    }
    expect(await collectedBlobs(ref.path)).toEqual([]);

    const served: Record<string, string> = {
      clip: 'video/mp4',
      image: 'image/png',
      tone: 'audio/wav',
      logo: 'image/svg+xml',
      font: 'font/otf',
    };
    for (const [key, mimeType] of Object.entries(served)) {
      const handle = await client.request('media.resolve', { videoId: ref.videoId, assetId: refs[key]! });
      expect(handle.mimeType, key).toBe(mimeType);
      expect((await fetch(handle.url)).status, key).toBe(200);
    }
    for (const key of ['captions', 'note']) {
      const refused = await rejection(client.request('media.resolve', { videoId: ref.videoId, assetId: refs[key]! }));
      expect(refused.code, key).toBe('forbidden');
    }
  });

  it('链接的符号链接按它指向的真实文件放行：指向别的文件（哪怕长度相同）就不放行', async (context) => {
    const { ref, snapshot } = await create();
    const alias = path.join(fixtures, 'alias.mp4');
    await fs.rm(alias, { force: true });
    try {
      await fs.symlink(clip, alias);
    } catch (error) {
      if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('Windows does not grant this process permission to create file symlinks');
      }
      throw error;
    }
    const linked = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: snapshot.video.revision,
      operations: [{ type: 'importAsset', path: alias, ref: 'alias' }],
    });
    const assetId = linked.receipt.refs!.alias!;
    const handle = await client.request('media.resolve', { videoId: ref.videoId, assetId });
    expect([handle.fileName, handle.mimeType]).toEqual(['alias.mp4', 'video/mp4']);
    expect((await fetch(handle.url)).status).toBe(200);

    // 换成指向一份同样长度、却不是媒体的文件：引擎的长度核对拦不住，扩展名不对就不放行。
    const secret = path.join(fixtures, 'secret.txt');
    await fs.writeFile(secret, Buffer.alloc((await fs.stat(clip)).size, 0x61));
    await fs.rm(alias);
    await fs.symlink(secret, alias);
    const refused = await rejection(client.request('media.resolve', { videoId: ref.videoId, assetId }));
    expect(refused.code).toBe('forbidden');
  });

  it('链接的文件不见了：视频照常打开，素材标为缺失，别的素材不受影响', async () => {
    const { ref, snapshot } = await create();
    const away = path.join(fixtures, 'away.mp4');
    await fs.copyFile(clip, away);
    const kept = path.join(fixtures, 'kept.svg');
    await fs.writeFile(kept, "<svg xmlns='http://www.w3.org/2000/svg' width='1'/>");
    const imported = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: snapshot.video.revision,
      operations: [
        { type: 'importAsset', path: away, ref: 'away' },
        { type: 'addItem', sequenceId: snapshot.video.rootSequenceId, asset: { ref: 'away' }, alignment: 'nearest-frame' },
        { type: 'importAsset', path: kept, storage: 'managed', ref: 'kept' },
      ],
    });
    const before = runtime.videos.mirror(ref.videoId)!;
    await client.request('videos.close', { videoId: ref.videoId });
    await fs.rm(away);

    const reopened = await client.request('videos.open', { projectId: project.id, path: ref.relPath });
    expect(reopened.snapshot).toEqual(before);
    const missing = await rejection(client.request('media.resolve', { videoId: ref.videoId, assetId: imported.receipt.refs!.away! }));
    const body = missing.details as EngineErrorBody;
    expect(body.code).toBe('ASSET_MISSING');
    expect(body.details).toMatchObject({ reason: 'missing', path: away });
    // 不必等到取用失败：素材状态直接列出缺失的版本，收进视频的不在其中。
    expect(await client.request('videos.assetStatus', { videoId: ref.videoId })).toEqual({
      missing: [{ assetId: imported.receipt.refs!.away!, revision: '1', reason: 'missing', path: away }],
    });
    const handle = await client.request('media.resolve', { videoId: ref.videoId, assetId: imported.receipt.refs!.kept! });
    expect((await fetch(handle.url)).status).toBe(200);
    // 照样能编辑。
    await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: imported.receipt.videoRevision,
      operations: [{ type: 'renameVideo', name: '缺了素材也能改' }],
    });
  });

  it('项目里的素材按相对视频目录登记：整个项目搬走之后，视频照常打开、素材照样取得', async () => {
    const { ref, snapshot } = await create(client, '搬家');
    const inside = path.join(project.path, '素材', 'logo.svg');
    await fs.mkdir(path.dirname(inside), { recursive: true });
    await fs.writeFile(inside, "<svg xmlns='http://www.w3.org/2000/svg' width='2'/>");
    const imported = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: snapshot.video.revision,
      operations: [
        { type: 'importAsset', path: inside, ref: 'inside' },
        { type: 'importAsset', path: clip, ref: 'outside' },
      ],
    });
    const insideId = imported.receipt.refs!.inside!;
    const outsideId = imported.receipt.refs!.outside!;
    const assets = runtime.videos.mirror(ref.videoId)!.video.assets;
    const storageOf = (id: string) => assets[id]!.revisions[assets[id]!.currentRevision]!.storage;
    expect(storageOf(insideId)).toMatchObject({ mode: 'linked', locator: { path: '../素材/logo.svg' } });
    // 项目外的文件仍记绝对路径。
    expect(storageOf(outsideId)).toMatchObject({ mode: 'linked', locator: { path: clip } });
    await client.request('videos.close', { videoId: ref.videoId });

    const movedDir = path.join(dir, '搬走的项目');
    await fs.rename(project.path, movedDir);
    const { project: moved } = await client.request('projects.open', { path: movedDir });
    expect(moved.id).toBe(project.id);
    await runtime.videos.claimProjectVideos(moved);
    const reopened = await client.request('videos.open', { projectId: moved.id, path: '搬家' });
    expect(reopened.ref.videoId).toBe(ref.videoId);
    expect(await client.request('videos.assetStatus', { videoId: ref.videoId })).toEqual({ missing: [] });
    for (const assetId of [insideId, outsideId]) {
      const handle = await client.request('media.resolve', { videoId: ref.videoId, assetId });
      expect((await fetch(handle.url)).status).toBe(200);
    }
  });

  it('链接的 JSON 只放行 Lottie 动画', async () => {
    const { ref, snapshot } = await create();
    const sticker = path.join(fixtures, 'sticker.json');
    await fs.writeFile(sticker, JSON.stringify({ v: '5.8.1', w: 64, h: 64, fr: 30, ip: 0, op: 30, layers: [] }));
    const linked = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: snapshot.video.revision,
      operations: [{ type: 'importAsset', path: sticker, storage: 'linked', ref: 'sticker' }],
    });
    const handle = await client.request('media.resolve', { videoId: ref.videoId, assetId: linked.receipt.refs!.sticker! });
    const response = await fetch(handle.url);
    expect((await response.json()) as unknown).toMatchObject({ v: '5.8.1', op: 30 });
    expect(runtime.videos.mirror(ref.videoId)!.video.assets[linked.receipt.refs!.sticker!]!.kind).toBe('lottie');
  });

  it('`.lottie` 压缩包按 Lottie 收：链接时只放行里面确实有动画的', async () => {
    const { ref, snapshot } = await create();
    const animation = JSON.stringify({ v: '5.8.1', w: 64, h: 48, fr: 30, ip: 0, op: 45, layers: [] });
    const archive = path.join(fixtures, 'wave.lottie');
    await fs.writeFile(
      archive,
      storedZip([
        ['manifest.json', '{"animations":[{"id":"wave"}]}'],
        ['animations/wave.json', animation],
      ]),
    );
    const linked = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: snapshot.video.revision,
      operations: [{ type: 'importAsset', path: archive, storage: 'linked', ref: 'wave' }],
    });
    const assetId = linked.receipt.refs!.wave!;
    const asset = runtime.videos.mirror(ref.videoId)!.video.assets[assetId]!;
    const revision = asset.revisions[asset.currentRevision]!;
    expect([asset.kind, revision.mediaType, revision.video?.displayWidth, revision.video?.displayHeight]).toEqual([
      'lottie',
      'application/zip',
      64,
      48,
    ]);
    expect(revision.duration).toEqual({ ticks: '3', timescale: 2 });
    const handle = await client.request('media.resolve', { videoId: ref.videoId, assetId });
    expect(handle.mimeType).toBe('application/zip');
    expect((await fetch(handle.url)).status).toBe(200);

    // 原处换成一份长度相同、却不是 Lottie 的 zip：不放行。
    const bytes = await fs.readFile(archive);
    const other = storedZip([
      ['manifest.json', '{"animations":[{"id":"wave"}]}'],
      ['xnimations/wave.json', animation],
    ]);
    expect(other.length).toBe(bytes.length);
    await fs.writeFile(archive, other);
    const refused = await rejection(client.request('media.resolve', { videoId: ref.videoId, assetId }));
    expect(refused.code).toBe('forbidden');

    // 读不开的 `.lottie` 不收。
    const broken = path.join(fixtures, 'broken.lottie');
    await fs.writeFile(broken, storedZip([['manifest.json', '{}']]));
    const failed = await rejection(
      client.request('edits.apply', {
        videoId: ref.videoId,
        commandId: newId('cmd'),
        expectedRevision: linked.receipt.videoRevision,
        operations: [{ type: 'importAsset', path: broken, storage: 'linked' }],
      }),
    );
    expect((failed.details as EngineErrorBody).code).toBe('MEDIA_PROBE_FAILED');
  });

  it('素材分析：波形峰值与缩略图由 Runtime 算出，按内容摘要缓存；只分析音视频', async () => {
    const { ref, snapshot } = await create();
    const added = await importClip(ref.videoId, snapshot.video.revision);
    const assetId = added.receipt.createdIds.find((id) => id.startsWith('asset'))!;
    let peaks = await client.request('media.peaks', { videoId: ref.videoId, assetId });
    for (let i = 0; peaks.status === 'pending' && i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      peaks = await client.request('media.peaks', { videoId: ref.videoId, assetId });
    }
    if (peaks.status !== 'ready') throw new Error(`峰值没有算好：${peaks.status}`);
    expect(peaks.binsPerSecond).toBe(50);
    expect(Math.abs(Buffer.from(peaks.peaks, 'base64').length - 100)).toBeLessThanOrEqual(3);

    const thumbnail = await client.request('media.thumbnail', { videoId: ref.videoId, assetId, at: 1.04 });
    expect(thumbnail.at).toBe(1);
    expect([...Buffer.from(thumbnail.data, 'base64').subarray(0, 2)]).toEqual([0xff, 0xd8]);

    const asset = runtime.videos.mirror(ref.videoId)!.video.assets[assetId]!;
    const hex = asset.revisions[asset.currentRevision]!.contentHash.replace('sha256:', '');
    const cached = await fs.readdir(path.join(dir, 'cache', 'media', hex));
    expect(cached.sort()).toEqual(['peaks-v1.json', 'thumb-1000.jpg']);

    const sticker = path.join(fixtures, 'analysis-sticker.json');
    await fs.writeFile(sticker, JSON.stringify({ v: '5.8.1', w: 64, h: 64, fr: 30, ip: 0, op: 30, layers: [] }));
    const linked = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: added.receipt.videoRevision,
      operations: [{ type: 'importAsset', path: sticker, storage: 'linked', ref: 'sticker' }],
    });
    const refused = await rejection(client.request('media.peaks', { videoId: ref.videoId, assetId: linked.receipt.refs!.sticker! }));
    expect(refused.code).toBe('forbidden');
    const missing = await rejection(client.request('media.thumbnail', { videoId: ref.videoId, assetId: 'asset_missing', at: 0 }));
    expect(missing.code).toBe('not-found');
  });

  it('连接断开后经过宽限期关闭视频；没打开的视频不能编辑或订阅', async () => {
    const other = await connect();
    const { ref, snapshot } = await create(other);
    other.close();
    await until(() => runtime.videos.mirror(ref.videoId) === null);
    const closed = await rejection(importClip(ref.videoId, snapshot.video.revision));
    expect(closed.code).toBe('not-found');
    // 锁已经释放：可以重新打开并编辑。
    await client.request('videos.open', { projectId: project.id, path: ref.relPath });
    await importClip(ref.videoId, snapshot.video.revision);
  });

  it('复制出来的项目：副本里的视频换新 videoId，内容、修订与历史不变，原视频不变', async () => {
    const { ref } = await create(client, '样片');
    await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: '0',
      operations: [{ type: 'renameVideo', name: '改过的' }],
    });
    const history = await client.request('videos.history', { videoId: ref.videoId });
    expect(videoMeta(path.join(project.path, '样片')).projectId).toBe(project.id);
    await client.request('videos.close', { videoId: ref.videoId });

    const copyDir = path.join(dir, '副本');
    await fs.cp(project.path, copyDir, { recursive: true });
    const { project: copy } = await client.request('projects.open', { path: copyDir });
    expect(copy.id).not.toBe(project.id);
    // 打开项目时在后台预处理；接上那一趟（或再跑一趟）后，库里已经换了标识。
    await runtime.videos.claimProjectVideos(copy);
    const meta = videoMeta(path.join(copy.path, '样片'));
    expect(meta.projectId).toBe(copy.id);
    expect(JSON.parse(meta.previousVideoIds!)).toEqual([ref.videoId]);

    const copied = await client.request('videos.open', { projectId: copy.id, path: '样片' });
    expect(copied.ref.videoId).not.toBe(ref.videoId);
    expect(copied.ref.source.projectId).toBe(copy.id);
    expect(copied.snapshot.video).toMatchObject({ name: '改过的', revision: '1' });
    expect((await client.request('videos.history', { videoId: copied.ref.videoId })).entries).toEqual(history.entries);

    // 原视频的 id 不变，两个同时打开互不相干。
    const original = await client.request('videos.open', { projectId: project.id, path: '样片' });
    expect(original.ref.videoId).toBe(ref.videoId);
    expect(original.ref.path).not.toBe(copied.ref.path);
    expect(videoMeta(path.join(project.path, '样片')).previousVideoIds).toBeUndefined();
  });

  it('没有记所属项目的旧视频：打开时采用当前项目，不换 videoId', async () => {
    const { ref } = await create(client, '旧片');
    await client.request('videos.close', { videoId: ref.videoId });
    const file = path.join(project.path, '旧片', 'video.db');
    const db = new DatabaseSync(file);
    db.exec(`DELETE FROM meta WHERE key = 'projectId'`);
    db.close();
    expect(videoMeta(path.dirname(file)).projectId).toBeUndefined();

    const reopened = await client.request('videos.open', { projectId: project.id, path: '旧片' });
    expect(reopened.ref.videoId).toBe(ref.videoId);
    await client.request('videos.close', { videoId: ref.videoId });
    expect(videoMeta(path.dirname(file)).projectId).toBe(project.id);
  });

  it('引擎进程崩溃后重启并重新打开视频，主题上发整体替换，之后可以继续编辑', async () => {
    const { ref, snapshot } = await create();
    const view = watch(client, ref.videoId);
    await view.ready;
    const added = await importClip(ref.videoId, snapshot.video.revision);
    const pid = runtime.videos.enginePid!;
    process.kill(pid, 'SIGKILL');
    await until(() => view.events.includes('video.replaced'));
    expect(runtime.videos.enginePid).not.toBe(pid);
    expect(view.get()!.video.revision).toBe(added.receipt.videoRevision);
    const itemId = added.receipt.createdIds.find((id) => id.startsWith('item'))!;
    const deleted = await client.request('edits.apply', {
      videoId: ref.videoId,
      commandId: newId('cmd'),
      expectedRevision: added.receipt.videoRevision,
      operations: [{ type: 'deleteItems', itemIds: [itemId] }],
    });
    expect(view.get()!.video.revision).toBe(deleted.receipt.videoRevision);
  });

  // ---- 版本记录（架构设计 §5.12、视频格式规范 §9） ----

  async function renameVideo(videoId: string, revision: string, name: string, commandId = newId('cmd')) {
    const { receipt } = await client.request('edits.apply', {
      videoId,
      commandId,
      expectedRevision: revision,
      operations: [{ type: 'renameVideo', name }],
    });
    return receipt.videoRevision;
  }

  async function versionsOf(videoId: string, count: number) {
    return eventually(async () => {
      const list = await client.request('videos.versions.list', { videoId });
      return list.versions.length === count && list;
    });
  }

  it('版本记录：编辑之后去抖写快照、开版本；保存版本单独成版；回到版本是一笔可以撤销的修改；关闭前写快照', async () => {
    const { ref, snapshot } = await create(client, '版本');
    const snapshotFile = path.join(ref.path, '.bcut-snapshot', 'video.json');
    // 打开时写下基线，还没有版本。
    await until(() => existsSync(snapshotFile));
    expect((await client.request('videos.versions.list', { videoId: ref.videoId })).versions).toEqual([]);

    let revision = await renameVideo(ref.videoId, snapshot.video.revision, '第一稿');
    const first = await versionsOf(ref.videoId, 1);
    expect(first.versions[0]).toMatchObject({ version: 1, kind: 'segment', open: true });
    expect(first.versions[0]!.actions).toEqual([expect.objectContaining({ actor: 'user_local', count: 1 })]);
    expect(await client.request('videos.versions.status', { videoId: ref.videoId })).toMatchObject({ state: 'synced', latestVersion: 1 });
    const text = await client.request('videos.versions.get', { videoId: ref.videoId, version: 1 });
    expect(text.diff).toContain('第一稿');

    const saved = await client.request('videos.versions.save', { videoId: ref.videoId, commandId: newId('cmd'), name: '初稿' });
    expect(saved).toMatchObject({ version: 2, replayed: false });
    revision = saved.receipt.videoRevision;
    revision = await renameVideo(ref.videoId, revision, '第二稿');
    const third = await versionsOf(ref.videoId, 3);
    expect(third.versions.map((v) => v.kind)).toEqual(['segment', 'save', 'segment']);
    expect(third.versions[1]).toMatchObject({ name: '初稿', checkpointId: saved.checkpointId });

    // 回到保存的那一版：名字回到「第一稿」，单独成一个 restore 版本；撤销它回到「第二稿」。
    const restored = await client.request('videos.versions.restore', { videoId: ref.videoId, commandId: newId('cmd'), version: 2 });
    expect(restored.receipt?.label).toBe('Restore version 2');
    expect(restored.version).toBe(4);
    expect(runtime.videos.mirror(ref.videoId)!.video.name).toBe('第一稿');
    await client.request('edits.undo', { videoId: ref.videoId, commandId: newId('cmd'), target: 'undo' });
    expect(runtime.videos.mirror(ref.videoId)!.video.name).toBe('第二稿');

    // 关闭时在放下写锁之前写快照：磁盘上的快照就是关闭时的状态。
    await client.request('videos.close', { videoId: ref.videoId });
    expect(await fs.readFile(snapshotFile, 'utf8')).toContain('第二稿');
    expect(revision).toBeTruthy();
  });

  it('快照被外部改过：引擎不覆盖它，编辑与关闭照常', async () => {
    const { ref, snapshot } = await create(client, '外部');
    const snapshotFile = path.join(ref.path, '.bcut-snapshot', 'video.json');
    await until(() => existsSync(snapshotFile));
    await fs.writeFile(snapshotFile, '{ "edited": "outside" }\n');
    await renameVideo(ref.videoId, snapshot.video.revision, '库里改的');
    const status = await eventually(async () => {
      const current = await client.request('videos.versions.status', { videoId: ref.videoId });
      return current.state === 'conflict' && current;
    });
    expect(status.changedPaths).toEqual(['video.json']);
    await client.request('videos.close', { videoId: ref.videoId });
    expect(await fs.readFile(snapshotFile, 'utf8')).toBe('{ "edited": "outside" }\n');
  });

  it('只有快照的视频（video.db 被删了）：打开时按快照重建，videoId 不变，版本记录照常可用', async () => {
    const { ref, snapshot } = await create(client, '重建');
    await renameVideo(ref.videoId, snapshot.video.revision, '重建之前');
    await versionsOf(ref.videoId, 1);
    await client.request('videos.close', { videoId: ref.videoId });
    for (const name of ['video.db', 'video.db-wal', 'video.db-shm']) await fs.rm(path.join(ref.path, name), { force: true });

    const reopened = await client.request('videos.open', { projectId: project.id, path: ref.relPath });
    expect(reopened.ref.videoId).toBe(ref.videoId);
    expect(reopened.snapshot.video.name).toBe('重建之前');
    const list = await client.request('videos.versions.list', { videoId: ref.videoId });
    expect(list.versions.map((v) => v.kind)).toEqual(['rebuild', 'segment']);
    // 更早的版本仍可回到：回到第 1 版开始之前，名字是新建时的。
    const restored = await client.request('videos.versions.restore', { videoId: ref.videoId, commandId: newId('cmd'), version: 1, before: true });
    expect(restored.receipt?.label).toBe('Restore to before version 1');
    expect(runtime.videos.mirror(ref.videoId)!.video.name).toBe('重建');
  });

  it('按回合切分：智能体新任务开始后的第一次写开新版本，版本头部记下改过视频的会话', async () => {
    await client.request('settings.set', { values: { 'versions.cadence': 'turn' } });
    const { ref, snapshot } = await create(client, '回合');
    const revision = await renameVideo(ref.videoId, snapshot.video.revision, '用户改的');
    await versionsOf(ref.videoId, 1);

    runtime.videos.noteTask({ taskId: 'task_turn', conversationId: 'conv_turn', conversationTitle: '剪个开头', status: 'running' });
    await runtime.videos.applyAs(
      { videoId: ref.videoId, commandId: newId('cmd'), expectedRevision: revision, operations: [{ type: 'renameVideo', name: '智能体改的' }] },
      { kind: 'agent', id: 'agent:test' },
      { taskId: 'task_turn' },
    );
    const list = await versionsOf(ref.videoId, 2);
    expect(list.versions[0]).toMatchObject({ version: 2, conversations: [{ id: 'conv_turn', title: '剪个开头' }] });
    expect(list.versions[1]!.conversations).toEqual([]);
  });

  it('关闭之后立刻重新打开：先等关闭写完快照、放下写锁，重新打开的视频照常可改', async () => {
    const { ref, snapshot } = await create(client, '重开');
    const revision = await renameVideo(ref.videoId, snapshot.video.revision, '关之前');
    // 去抖还没到：关闭时要先写快照，重新打开就落在这段时间里。
    const closing = client.request('videos.close', { videoId: ref.videoId });
    const reopened = await client.request('videos.open', { projectId: project.id, path: ref.relPath });
    expect(await closing).toEqual({ closed: true });
    expect(reopened.ref.videoId).toBe(ref.videoId);
    await renameVideo(ref.videoId, revision, '重开之后');
    expect(runtime.videos.mirror(ref.videoId)!.video.name).toBe('重开之后');
    // 关闭时写下的那一版带着关之前的改名；重开之后的改名也记进版本。
    const list = await eventually(async () => {
      const current = await client.request('videos.versions.list', { videoId: ref.videoId });
      return current.versions.reduce((n, v) => n + v.actions.reduce((m, a) => m + a.count, 0), 0) === 2 && current;
    });
    expect(list.versions.flatMap((v) => v.actions.map((a) => a.label))).toEqual(expect.arrayContaining(['Rename video']));
  });

  it('不属于项目的会话里的视频：不写快照、没有版本，保存版本被拒', async () => {
    const { conversation } = await client.request('conversations.create', { projectId: null });
    const opened = await client.request('videos.create', { conversationId: conversation.id, name: '会话视频' });
    const videoId = opened.ref.videoId;
    await renameVideo(videoId, opened.snapshot.video.revision, '改过');
    await expect(client.request('videos.versions.save', { videoId, commandId: newId('cmd'), name: '存一版' })).rejects.toMatchObject({
      details: { code: 'VERSIONS_NEED_PROJECT' },
    });
    expect(await client.request('videos.versions.list', { videoId })).toEqual({ versions: [], unreadable: [] });
    await client.request('videos.close', { videoId });
    expect(existsSync(path.join(opened.ref.path, '.bcut-snapshot'))).toBe(false);
  });
});
