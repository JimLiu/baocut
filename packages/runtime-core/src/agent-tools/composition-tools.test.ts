import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { resolveElectronBinary } from '@baocut/code-runtime';
import {
  newId,
  type CatalogCallResult,
  type CompositionItem,
  type Id,
  type PackageManifest,
  type Project,
  type VideoSnapshot,
} from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { TarWriter, entryStream, listArchive, readEntry } from '../exports/package-archive.ts';
import { resolveExportWorkerCommand } from '../exports/video-export.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { TOOL_RISK } from './tool-scope.ts';
import type { Loose } from './testing/fake-agent.ts';

/**
 * 代码画面工具端到端（架构设计 §8，代码包规范 §6、§7）：`compositions_import` 经终端的 `catalog.call` 验证、烘焙、导入并放置
 * 一个透明叠加层，`compositions_preview` 按局部时间取帧，错误码按验证项给出；最后真的导出成片，叠加层盖在底下的画面上。
 * 需要 engine-host、Render Worker、ffmpeg 与 Electron，缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const worker = resolveExportWorkerCommand(engine);
const electron = resolveElectronBinary();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const W = 1280;
const H = 720;

/** 自己写的 HyperFrames 合同的最小合成：透明背景上一个品红方块，x 随时间线性移动（t 秒时左边在 100 + 400t）。 */
function overlayHtml(options: { root?: boolean; scene?: string; extraHead?: string } = {}): string {
  const rootAttrs =
    options.root === false
      ? 'id="root"'
      : `id="root" data-composition-id="main" data-start="0" data-width="${W}" data-height="${H}" data-fps="30" data-duration="2"`;
  const scene = options.scene ?? "box.style.transform = 'translateX(' + (100 + 400 * t).toFixed(3) + 'px)';";
  return `<!doctype html>
<html><head><meta charset="utf-8">${options.extraHead ?? ''}<style>
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
#root { position: relative; width: ${W}px; height: ${H}px; }
#box { position: absolute; top: 260px; left: 0; width: 200px; height: 200px; background: #ff00ff; }
</style></head><body>
<div ${rootAttrs}><div id="box"></div></div>
<script>
(function () {
  var box = document.getElementById('box');
  function renderScene(t) { ${scene} }
  function SeekableTimeline(duration, render) { this._duration = duration; this._time = 0; this._render = render; this._scale = 1; this._paused = true; }
  SeekableTimeline.prototype.seek = function (t) { this._time = Math.min(Math.max(Number(t) || 0, 0), this._duration); this._render(this._time); return this; };
  SeekableTimeline.prototype.time = function () { return this._time; };
  SeekableTimeline.prototype.progress = function (p) { if (p === undefined) return this._time / this._duration; return this.seek(p * this._duration); };
  SeekableTimeline.prototype.duration = function () { return this._duration; };
  SeekableTimeline.prototype.pause = function () { this._paused = true; return this; };
  SeekableTimeline.prototype.play = function () { this._paused = false; return this; };
  SeekableTimeline.prototype.timeScale = function (v) { if (v === undefined) return this._scale; this._scale = v; return this; };
  var tl = new SeekableTimeline(2, renderScene);
  tl.seek(0);
  window.__timelines = window.__timelines || {};
  window.__timelines.main = tl;
})();
</script></body></html>`;
}

describe.skipIf(!engine || !worker || !ffmpeg || !electron)('代码画面工具（终端目录，真实引擎与 Electron）', () => {
  let fixtures: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;
  let videoId: Id;
  let imported: Loose;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-composition-tools-fixtures-'));
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${W}x${H}:rate=30:duration=3`],
      ...['-c:v', 'mpeg4', '-q:v', '3', path.join(fixtures, 'clip.mp4')],
    ]);
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-composition-tools-')));
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
    ({ project } = await client.request('projects.create', { name: '代码画面' }));
    await fs.mkdir(path.join(project.path, 'media'));
    await fs.copyFile(path.join(fixtures, 'clip.mp4'), path.join(project.path, 'media', 'clip.mp4'));
  }, 120_000);

  afterAll(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  async function call(name: string, args: unknown): Promise<CatalogCallResult> {
    return client.request('catalog.call', { name, args, cwd: project.path });
  }

  async function ok(name: string, args: unknown): Promise<Loose> {
    const outcome = await call(name, args);
    if (!outcome.ok) throw new Error(`${name} 失败：${JSON.stringify(outcome.error)}`);
    return outcome.result;
  }

  async function failure(name: string, args: unknown): Promise<Loose> {
    const outcome = await call(name, args);
    if (outcome.ok) throw new Error(`${name} 应当失败，却成功了：${JSON.stringify(outcome.result)}`);
    return outcome.error;
  }

  const snapshot = () => runtime.videos.mirror(videoId)!.video;

  it('compositions_import：验证、烘焙透明预渲染、导入两个素材并放一个合成片段', async () => {
    expect(TOOL_RISK.compositions_import).toBe(TOOL_RISK.assets_import);
    expect(TOOL_RISK.compositions_preview).toBe('read');
    const { tools } = await client.request('catalog.list', {});
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['compositions_import', 'compositions_preview']));

    const created = await ok('videos_create', { name: '叠加层', width: W, height: H, fps: 30 });
    videoId = created.videoId;
    const clip = await ok('assets_import', { video: videoId, path: 'media/clip.mp4', place: { at: '0' } });
    expect(clip.itemId).toEqual(expect.any(String));

    imported = await ok('compositions_import', {
      video: videoId,
      files: [{ path: 'index.html', content: overlayHtml() }],
      name: '移动方块',
    });
    expect(imported).toMatchObject({
      status: 'committed',
      videoId,
      capabilities: { alpha: true, contract: 'hyperframes/1', width: W, height: H, durationFrames: 60 },
      verification: { status: 'passed' },
      itemId: expect.any(String),
      trackId: expect.any(String),
      bundle: { width: W, height: H, durationFrames: 60, synthesizedManifest: true, compositionId: 'main' },
      prerender: { frames: 60, hasAlpha: true, encoding: { alpha: true } },
    });
    // 叠加层不和底下的片段挤在同一条轨上。
    expect(imported.trackId).not.toBe(snapshot().sequences[snapshot().rootSequenceId]!.items.find((i) => i.id === clip.itemId)!.trackId);

    const video = snapshot();
    const item = video.sequences[video.rootSequenceId]!.items.find((i) => i.id === imported.itemId) as CompositionItem;
    expect(item).toMatchObject({
      type: 'composition',
      source: { kind: 'bundle', assetRef: { id: imported.bundle.assetId, revision: imported.bundle.revision } },
      prerender: { id: imported.prerender.assetId, revision: imported.prerender.revision },
      span: { fromFrame: 0, durationFrames: 60 },
    });
    const bundleAsset = video.assets[imported.bundle.assetId]!;
    expect(bundleAsset.kind).toBe('bundle');
    const bundleRevision = bundleAsset.revisions[imported.bundle.revision]!;
    expect((bundleRevision.bundle as { contentHash: string }).contentHash).toBe(imported.bundle.contentHash);
    expect(bundleRevision.provenance.origin).toBe('agent-import');
    const prerender = video.assets[imported.prerender.assetId]!;
    expect(prerender.kind).toBe('video');
    const prerenderRevision = prerender.revisions[imported.prerender.revision]!;
    expect(prerenderRevision.video?.hasAlpha).toBe(true);
    expect(prerenderRevision.provenance.origin).toBe('composition-bake');
  }, 180_000);

  it('compositions_preview：同一时刻摘要相同、不同时刻不同、超过时长夹到末帧', async () => {
    const preview = await ok('compositions_preview', {
      video: videoId,
      assetId: imported.bundle.assetId,
      at: ['0.5', '0.5', '1.5', '2.5'],
    });
    expect(preview).toMatchObject({ videoId, compositionId: 'main', width: W, height: H, durationSeconds: 2 });
    const frames = preview.frames as Array<{ at: string; file: string; sha256: string; clamped: boolean }>;
    expect(frames).toHaveLength(4);
    const framesDir = path.join(project.path, '.baocut-out', 'frames', videoId);
    for (const frame of frames) {
      expect(path.dirname(frame.file)).toBe(framesDir);
      const head = Buffer.alloc(4);
      const handle = await fs.open(frame.file, 'r');
      await handle.read(head, 0, 4, 0);
      await handle.close();
      expect(head).toEqual(PNG);
    }
    expect(frames[0]!.sha256).toBe(frames[1]!.sha256);
    expect(frames[0]!.sha256).not.toBe(frames[2]!.sha256);
    expect(frames[0]!.clamped).toBe(false);
    expect(frames[3]!.clamped).toBe(true);

    // 导入之前也能看：内联文件。
    const inline = await ok('compositions_preview', {
      video: videoId,
      files: [{ path: 'index.html', content: overlayHtml() }],
      at: ['1.5'],
    });
    expect(inline.frames[0].sha256).toBe(frames[2]!.sha256);
  }, 180_000);

  it('错误码：没有根元素、引用网络、画面不确定', async () => {
    const revision = snapshot().revision;
    const noRoot = await failure('compositions_import', {
      video: videoId,
      files: [{ path: 'index.html', content: overlayHtml({ root: false }) }],
      manifest: { width: W, height: H, fps: 30, durationSeconds: 2 },
    });
    expect(noRoot.code).toBe('COMPOSITION_ROOT_MISSING');
    expect(noRoot.next).toEqual(expect.any(String));

    const network = await failure('compositions_import', {
      video: videoId,
      files: [{ path: 'index.html', content: overlayHtml({ extraHead: '<script src="https://example.invalid/x.js"></script>' }) }],
    });
    expect(network.code).toBe('BUNDLE_NETWORK_REFERENCE');
    expect(network.next).toContain('包内');

    const random = await failure('compositions_import', {
      video: videoId,
      files: [
        {
          path: 'index.html',
          content: overlayHtml({
            scene: "box.style.transform = 'translateX(' + (Date.now() % 997) + 'px) translateY(' + (performance.now() % 211) + 'px)';",
          }),
        },
      ],
    });
    expect(random.code).toBe('COMPOSITION_NONDETERMINISTIC');
    // 都没有写进视频。
    expect(snapshot().revision).toBe(revision);

    expect((await failure('compositions_import', { video: videoId })).code).toBe('INVALID_ARGUMENTS');
    expect((await failure('compositions_import', { video: videoId, files: [{ path: '../escape.html', content: '<p>x</p>' }] })).code).toBe(
      'INVALID_ARGUMENTS',
    );
  }, 180_000);

  /** 导出成片 t = 1 s 的一帧（rgb24），给下面两条用。 */
  let exportedFrame: Buffer | undefined;

  it('导出成片：时长对、预渲染里的方块画在该在的位置', async () => {
    const submitted = await ok('export', { video: videoId, kind: 'video', format: 'mp4' });
    let job: Loose = await ok('jobs_wait', { jobId: submitted.jobId, timeoutSec: 50 });
    for (let i = 0; i < 4 && !job.settled; i++) job = await ok('jobs_wait', { jobId: submitted.jobId, timeoutSec: 50 });
    expect(job, JSON.stringify(job.error ?? null)).toMatchObject({ state: 'completed' });
    const out = job.outputs[0].path as string;
    const duration = Number(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out], {
        encoding: 'utf8',
      }).trim(),
    );
    expect(Math.abs(duration - 3)).toBeLessThan(0.15);

    // t = 1 s：方块的左边在 500 px（500–700 × 260–460）。
    const raw = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-ss', '1', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      {
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    expect(raw.length).toBe(W * H * 3);
    const magenta = (x: number, y: number) => {
      const i = (y * W + x) * 3;
      return raw[i]! > 180 && raw[i + 1]! < 90 && raw[i + 2]! > 180;
    };
    let inside = 0;
    let insideTotal = 0;
    for (let y = 290; y < 430; y += 4) {
      for (let x = 530; x < 670; x += 4) {
        insideTotal++;
        if (magenta(x, y)) inside++;
      }
    }
    expect(inside / insideTotal).toBeGreaterThan(0.9);
    exportedFrame = raw;
  }, 240_000);

  // 合成实例的替身没有背景板（frame-render 的 element.rs 给合成 `bg: None`）：透明预渲染直接盖在底下的画面上。
  it('导出成片：方块以外透出底下的画面', () => {
    const raw = exportedFrame;
    expect(raw).toBeDefined();
    if (!raw) return;
    const magenta = (x: number, y: number) => {
      const i = (y * W + x) * 3;
      return raw[i]! > 180 && raw[i + 1]! < 90 && raw[i + 2]! > 180;
    };
    // 方块以外是底下的 testsrc：不是品红，也不是一片黑。
    let outsideMagenta = 0;
    let outsideLit = 0;
    let outsideTotal = 0;
    for (let y = 0; y < H; y += 8) {
      for (let x = 0; x < 400; x += 8) {
        outsideTotal++;
        if (magenta(x, y)) outsideMagenta++;
        const i = (y * W + x) * 3;
        if (raw[i]! + raw[i + 1]! + raw[i + 2]! > 60) outsideLit++;
      }
    }
    expect(outsideMagenta / outsideTotal).toBeLessThan(0.5);
    expect(outsideLit / outsideTotal).toBeGreaterThan(0.5);
  });

  it('compositions_import 带 replace：原地换掉片段的代码包与预渲染，其余设置都保留', async () => {
    const itemId = imported.itemId as Id;
    await ok('edits_apply', {
      video: videoId,
      expectedRevision: snapshot().revision,
      label: '调淡并改名',
      operations: [
        { type: 'setStyle', itemId, opacity: 0.9 },
        { type: 'updateItem', itemId, name: '片头方块' },
      ],
    });
    const before = snapshot().sequences[snapshot().rootSequenceId]!;
    const old = before.items.find((i) => i.id === itemId) as CompositionItem;
    const count = before.items.length;

    // 混用 place 或指向不是合成的片段都拒绝，而且不写进视频。
    const revision = snapshot().revision;
    const green = [{ path: 'index.html', content: overlayHtml({ extraHead: '<style>#box { background: #00ff00; }</style>' }) }];
    const clipId = before.items.find((i) => i.type === 'video')!.id;
    for (const args of [
      { replace: { itemId }, place: { at: '1' } },
      { replace: { itemId: clipId } },
      { replace: { itemId: 'item_missing' } },
    ]) {
      expect((await failure('compositions_import', { video: videoId, files: green, ...args })).code).toBe('INVALID_ARGUMENTS');
    }
    expect(snapshot().revision).toBe(revision);

    const replaced = await ok('compositions_import', { video: videoId, files: green, name: '绿方块', replace: { itemId } });
    expect(replaced).toMatchObject({
      itemId,
      trackId: old.trackId,
      item: { itemId, trackId: old.trackId, fromFrame: 0, durationFrames: 60, startSeconds: 0, endSeconds: 2 },
      replaced: {
        itemId,
        layer: 'source',
        previousBundleRef: { id: imported.bundle.assetId, revision: imported.bundle.revision },
        bundleRef: { id: replaced.bundle.assetId, revision: replaced.bundle.revision },
        previousPrerender: { id: imported.prerender.assetId, revision: imported.prerender.revision },
        oldDurationFrames: 60,
        newDurationFrames: 60,
      },
    });
    expect(replaced.bundle.assetId).not.toBe(imported.bundle.assetId);

    const after = snapshot().sequences[snapshot().rootSequenceId]!;
    expect(after.items).toHaveLength(count);
    const item = after.items.find((i) => i.id === itemId) as CompositionItem;
    expect(item).toMatchObject({
      name: '片头方块',
      trackId: old.trackId,
      span: old.span,
      place: { ...old.place, opacity: 0.9 },
      source: { kind: 'bundle', assetRef: { id: replaced.bundle.assetId, revision: replaced.bundle.revision } },
      prerender: { id: replaced.prerender.assetId, revision: replaced.prerender.revision },
    });
    // 历史里这一笔写的是替换。
    const history = await ok('videos_history', { video: videoId });
    expect(JSON.stringify(history)).toContain('绿方块');
  }, 240_000);

  // 编辑操作建不出第二个序列（嵌套序列不在类型集合里，视频格式规范 §3.4），便携包能带进来：引擎打开包时收下快照里的每个序列。
  it('compositions_import 带 replace：片段在帧率不同的另一个序列里时，按那个序列的帧率烘焙与换算', async () => {
    // 导出便携包，在快照里加一个 24 fps 的序列，放一个合成片段（沿用根序列里那个片段的代码包与预渲染），重新打包。
    const submitted = await ok('export', { video: videoId, kind: 'portable', format: 'baocut' });
    let job: Loose = await ok('jobs_wait', { jobId: submitted.jobId, timeoutSec: 50 });
    for (let i = 0; i < 4 && !job.settled; i++) job = await ok('jobs_wait', { jobId: submitted.jobId, timeoutSec: 50 });
    expect(job, JSON.stringify(job.error ?? null)).toMatchObject({ state: 'completed' });
    const exported = job.outputs[0].path as string;
    const entries = await listArchive(exported);
    const entryOf = (name: string) => entries.find((e) => e.path === name)!;
    const manifest = JSON.parse((await readEntry(exported, entryOf('video.manifest.json'), 1 << 24)).toString('utf8')) as PackageManifest;
    const packed = JSON.parse((await readEntry(exported, entryOf('video.snapshot.json'), 1 << 26)).toString('utf8')) as VideoSnapshot;
    const root = packed.sequences[packed.rootSequenceId]!;
    expect(root.fps).toEqual({ num: 30, den: 1 });
    const source = root.items.find((i) => i.id === imported.itemId) as CompositionItem;
    const sequenceId = newId('seq');
    const trackId = newId('track');
    const itemId = newId('item');
    const sourceTrack = root.tracks.find((t) => t.id === source.trackId)!;
    packed.sequences[sequenceId] = {
      ...root,
      id: sequenceId,
      name: '24 fps',
      fps: { num: 24, den: 1 },
      tracks: [{ ...sourceTrack, id: trackId }],
      items: [{ ...source, id: itemId, trackId, name: '第二序列方块', span: { fromFrame: 0, durationFrames: 48 } }],
      transitions: [],
      markers: [],
      ducking: [],
    };
    const text = Buffer.from(JSON.stringify(packed), 'utf8');
    const rewritten = path.join(fixtures, 'second-sequence.baocut');
    const writer = await TarWriter.create(rewritten, Math.floor(Date.now() / 1000));
    let snapshotFile: { byteLength: number; sha256: string } | undefined;
    for (const entry of entries) {
      if (entry.path === 'video.manifest.json') continue;
      if (entry.path === 'video.snapshot.json') snapshotFile = await writer.addBuffer(entry.path, text);
      else await writer.addStream(entry.path, entry.size, entryStream(exported, entry));
    }
    manifest.files = manifest.files.map((f) => (f.path === 'video.snapshot.json' ? { ...f, ...snapshotFile! } : f));
    await writer.addBuffer('video.manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'));
    await writer.finish();

    const { project: other } = await client.request('projects.create', { name: '两个序列' });
    const opened = await client.request('videos.importPackage', { projectId: other.id, path: rewritten });
    const secondVideo = opened.ref.videoId;
    const video = () => runtime.videos.mirror(secondVideo)!.video;
    expect(Object.keys(video().sequences)).toHaveLength(2);
    expect(video().sequences[sequenceId]!.fps).toEqual({ num: 24, den: 1 });

    const blue = [{ path: 'index.html', content: overlayHtml({ extraHead: '<style>#box { background: #0000ff; }</style>' }) }];
    const outcome = await client.request('catalog.call', {
      name: 'compositions_import',
      args: { video: secondVideo, files: blue, name: '蓝方块', replace: { itemId } },
      cwd: other.path,
    });
    if (!outcome.ok) throw new Error(`compositions_import 失败：${JSON.stringify(outcome.error)}`);
    const replaced = outcome.result as Loose;
    // 2 秒的合成：按 24 fps 烘焙出 48 帧，换算到所在序列也是 48 帧、到 2 秒结束。
    expect(replaced).toMatchObject({
      itemId,
      trackId,
      prerender: { frames: 48, fps: { num: 24, den: 1 } },
      item: { itemId, trackId, fromFrame: 0, durationFrames: 48, startSeconds: 0, endSeconds: 2 },
      replaced: { itemId, oldDurationFrames: 48, newDurationFrames: 48 },
    });
    const after = video();
    const item = after.sequences[sequenceId]!.items.find((i) => i.id === itemId) as CompositionItem;
    expect(item).toMatchObject({
      span: { fromFrame: 0, durationFrames: 48 },
      prerender: { id: replaced.prerender.assetId, revision: replaced.prerender.revision },
    });
    const prerender = after.assets[replaced.prerender.assetId]!.revisions[replaced.prerender.revision]!;
    expect(prerender.video?.frameRate).toEqual({ kind: 'cfr', rate: { num: 24, den: 1 } });
    // 根序列里那个片段不动。
    expect(after.sequences[after.rootSequenceId]!.items.find((i) => i.id === imported.itemId)).toMatchObject({ span: source.span });
  }, 240_000);
});
