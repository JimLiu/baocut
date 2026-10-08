import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import {
  RpcError,
  newId,
  type EditOperation,
  type ExportCreateRequest,
  type JobRecord,
  type PackageManifest,
  type Project,
  type VideoSnapshot,
} from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { listArchive, readEntry } from './package-archive.ts';

/**
 * 端到端：便携包与工程导出（架构设计 §5.8、§9.13）。真实的 Runtime、网关与视频引擎；素材是 ffmpeg 现场生成的小文件。
 * 导出 → 打开得到同样的内容与素材摘要；包里没有本机路径；预检（缺失、不可读、被改、目标已存在）、跳过缺失、取消。
 * 缺 engine-host 或 ffmpeg 时跳过。
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
if (!engine) console.warn('跳过便携包端到端测试：没有构建 engine-host（npm run build:engine）');
if (!ffmpeg) console.warn('跳过便携包端到端测试：没有 ffmpeg');

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** 命令行入口（apps/cli）：测试里用 node 直接跑源文件。 */
const CLI_MAIN = fileURLToPath(new URL('../../../../apps/cli/src/main.ts', import.meta.url));

/** 跑一次 CLI，只给它 PATH 与指向测试目录的 HOME、BAOCUT_HOME：经 runtime.json 找到测试里的 Runtime。 */
function cli(home: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI_MAIN, ...args],
      { env: { PATH: process.env.PATH ?? '', HOME: home, BAOCUT_HOME: home }, timeout: 60_000 },
      (error, stdout, stderr) => resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
  });
}

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
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

function sine(file: string, frequency: number, seconds: number): void {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:duration=${seconds}:sample_rate=8000`,
    file,
  ]);
}

function clip(file: string, seconds: number): void {
  execFileSync('ffmpeg', [
    ...['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=160x90:rate=30:duration=${seconds}`],
    ...['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=48000`],
    ...['-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', file],
  ]);
}

/** 值里所有的字符串（含对象的键）。 */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

/** 看起来像本机绝对路径的字符串：`/` 开头、`~/` 开头、Windows 盘符、`file:` URL。 */
function looksAbsolute(text: string): boolean {
  return text.startsWith('/') || text.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('file:');
}

async function readJsonEntry<T>(file: string, name: string): Promise<T> {
  const entry = (await listArchive(file)).find((e) => e.path === name);
  if (!entry) throw new Error(`包里没有 ${name}`);
  return JSON.parse((await readEntry(file, entry, 1 << 26)).toString('utf8')) as T;
}

describe.skipIf(!engine || !ffmpeg)('便携包与工程导出（真实引擎）', () => {
  let fixtures: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-portable-fixtures-'));
    sine(path.join(fixtures, 'a.wav'), 440, 2);
    sine(path.join(fixtures, 'b.wav'), 660, 1);
    sine(path.join(fixtures, 'c.wav'), 880, 1);
    clip(path.join(fixtures, 'clip.mp4'), 2);
    await fs.mkdir(path.join(fixtures, 'bundle', 'sub'), { recursive: true });
    await fs.writeFile(path.join(fixtures, 'bundle', 'index.html'), '<p>hi</p>');
    await fs.writeFile(path.join(fixtures, 'bundle', 'sub', 'data.json'), '{"a":1}');
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-portable-'));
    await boot();
    ({ project } = await client.request('projects.create', { name: '便携包测试' }));
  });

  /** 在 `dir` 上启动 Runtime 并连上（重启也用它）。 */
  async function boot(): Promise<void> {
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
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
  }

  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await fs.chmod(path.join(project?.path ?? dir, 'media', 'b.wav'), 0o644).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 素材复制到项目目录的 media/ 里（链接素材留在那里）。 */
  async function fixture(name: string): Promise<string> {
    const target = path.join(project.path, 'media', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(fixtures, name), target);
    return target;
  }

  const snapshotOf = (videoId: string): VideoSnapshot => runtime.videos.mirror(videoId)!.video;

  async function edit(videoId: string, operations: EditOperation[]) {
    return client.request('edits.apply', { videoId, commandId: newId('cmd'), expectedRevision: snapshotOf(videoId).revision, operations });
  }

  async function finish(jobId: string): Promise<JobRecord> {
    return until(async () => {
      const job = await client.request('exports.get', { jobId });
      return TERMINAL.has(job.state) && job;
    });
  }

  async function exportOnce(request: Omit<ExportCreateRequest, 'commandId'>): Promise<JobRecord> {
    const { jobId } = await client.request('exports.create', request);
    const job = await finish(jobId);
    if (job.state !== 'completed') throw new Error(`导出没有完成：${job.state} ${JSON.stringify(job.error)}`);
    return job;
  }

  const codeOf = async (request: ExportCreateRequest) =>
    (await rejection(client.request('exports.create', request))).details as {
      code: string;
      items?: Array<{ reason: string; name?: string }>;
    };

  /**
   * 一个视频：链接的录音（项目里）、收进视频的视频片段（来自项目之外，出处里写着本机路径）、收进视频的另一段（像从本机媒体
   * 新建的视频那样，来源记着原文件的路径，原文件在项目、主目录之外）、代码包目录、两个版本的转写文档；时间线上有视频与录音两个实例。
   */
  async function richVideo(): Promise<{ videoId: string; documentId: string }> {
    const a = await fixture('a.wav');
    const { ref } = await client.request('videos.create', { projectId: project.id, name: '便携' });
    const videoId = ref.videoId;
    const sequenceId = snapshotOf(videoId).rootSequenceId;
    const words = [{ id: 'w1', start: 0, end: 500, text: 'Hello' }];
    const body = (text: string) => ({
      schema: 'baocut.speech/1',
      clock: 'source-asset',
      timescale: 1000,
      speakers: [],
      words: [{ ...words[0]!, text }],
      sentences: null,
      chapters: [],
    });
    const put = await edit(videoId, [
      { type: 'importAsset', path: a, ref: 'a' },
      {
        type: 'importAsset',
        path: path.join(fixtures, 'clip.mp4'),
        ref: 'clip',
        storage: 'managed',
        provenance: {
          origin: 'link-import',
          source: { url: 'https://example.com/v', localPath: path.join(project.path, 'downloads', 'v.mp4') },
        },
      },
      {
        type: 'importAsset',
        path: path.join(fixtures, 'c.wav'),
        storage: 'managed',
        provenance: { origin: 'file-import', source: { path: path.join(fixtures, 'c.wav'), jobId: 'job_x' } },
      },
      { type: 'importAsset', path: path.join(fixtures, 'bundle'), ref: 'bundle' },
      { type: 'addItem', sequenceId, asset: { ref: 'clip' }, alignment: 'nearest-frame' },
      { type: 'addItem', sequenceId, asset: { ref: 'a' }, alignment: 'nearest-frame' },
      { type: 'putDocument', kind: 'speech', name: '转写', language: 'en', sourceAsset: { ref: 'a' }, body: body('Hello') },
    ]);
    const documentId = put.receipt.createdIds.find((id) => id.startsWith('doc'))!;
    await edit(videoId, [{ type: 'putDocument', documentId, kind: 'speech', name: '转写', language: 'en', body: body('Hello again') }]);
    return { videoId, documentId };
  }

  it('导出再打开：内容与素材摘要相同，素材都收进了新视频；包里没有本机路径（OUT-02）', async () => {
    const { videoId, documentId } = await richVideo();
    const original = snapshotOf(videoId);

    const job = await exportOnce({ videoId, settings: { kind: 'portable' } });
    const [output] = job.result!.outputs!;
    expect(output!.path).toBe(path.join(project.path, 'exports', '便携.baocut'));
    expect(output!.format).toBe('baocut');
    expect(output!.mediaType).toBe('application/x-baocut-package');
    expect(output!.media).toMatchObject({ kind: 'package', assets: 4, missingAssets: 0, documents: 2 });
    expect(output!.validation!.package).toMatchObject({ files: expect.any(Number) });
    expect(output!.validation!.package!.verifiedFiles).toBe(output!.validation!.package!.files);
    expect((await fs.stat(output!.path!)).size).toBe(output!.byteLength);
    // 出处里的本机路径换成了占位，并且有警告。
    expect(job.warnings.map((w) => w.code)).toContain('PACKAGE_LOCAL_PATH_REMOVED');
    // 目标目录里没有留下临时文件。
    expect((await fs.readdir(path.join(project.path, 'exports'))).filter((f) => f.startsWith('.'))).toEqual([]);
    // Space 里是这个视频导出的一个便携包条目，带文件大小（测试里不监听目录，先重扫一次）。
    await client.request('space.rescan', {});
    const listed = await until(async () => {
      const { entries } = await client.request('space.list', { videoId, kind: 'package' });
      return entries.length > 0 && entries;
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      kind: 'package',
      relPath: 'exports/便携.baocut',
      size: output!.byteLength,
      origin: { source: 'exported', videoId },
      media: { mediaType: 'application/x-baocut-package' },
    });

    // 包里的清单、快照与文档：没有一处像绝对路径，也不含主目录、临时目录与项目目录。
    const file = output!.path!;
    const manifest = await readJsonEntry<PackageManifest>(file, 'video.manifest.json');
    const snapshot = await readJsonEntry<VideoSnapshot>(file, 'video.snapshot.json');
    expect(manifest).toMatchObject({ format: 'baocut.package', packageVersion: 1, videoId, videoRevision: original.revision });
    const entries = await listArchive(file);
    const texts = [JSON.stringify(manifest), JSON.stringify(snapshot)];
    for (const entry of entries.filter((e) => e.path.startsWith('documents/')))
      texts.push((await readEntry(file, entry, 1 << 26)).toString('utf8'));
    for (const value of [manifest, snapshot]) {
      const absolute = strings(value).filter(looksAbsolute);
      expect(absolute).toEqual([]);
    }
    for (const text of texts) {
      for (const local of [os.homedir(), os.tmpdir(), await fs.realpath(os.tmpdir()), project.path, fixtures, dir]) {
        expect(text.includes(local), local).toBe(false);
      }
    }
    // 没有密钥、任务与会话：包里只有固定布局的文件。
    for (const entry of entries) expect(entry.path).toMatch(/^(video\.manifest\.json|video\.snapshot\.json|assets\/.+|documents\/.+)$/);
    expect(Object.values(snapshot.assets).every((a) => Object.values(a.revisions).every((r) => r.storage.mode === 'managed'))).toBe(true);

    // 打开到另一个项目里。
    const { project: other } = await client.request('projects.create', { name: '另一个项目' });
    const opened = await client.request('videos.importPackage', { projectId: other.id, path: file });
    expect(opened.ref.videoId).not.toBe(videoId);
    expect(path.dirname(opened.ref.path)).toBe(await fs.realpath(other.path));
    expect(opened.ref.name).toBe('便携');
    const imported = snapshotOf(opened.ref.videoId);
    expect(imported.revision).toBe(original.revision);
    expect(imported.sequences).toEqual(original.sequences);
    expect(imported.rootSequenceId).toBe(original.rootSequenceId);
    expect(Object.keys(imported.assets).sort()).toEqual(Object.keys(original.assets).sort());
    for (const [assetId, asset] of Object.entries(original.assets)) {
      for (const [revision, version] of Object.entries(asset.revisions)) {
        const copy = imported.assets[assetId]!.revisions[revision]!;
        expect(copy.contentHash).toBe(version.contentHash);
        expect(copy.byteLength).toBe(version.byteLength);
        expect(copy.storage.mode).toBe('managed');
      }
    }
    expect(Object.keys(imported.documents)).toEqual(Object.keys(original.documents));
    for (const revision of Object.keys(original.documents[documentId]!.revisions)) {
      const before = await client.request('documents.read', { videoId, documentId, revision });
      const after = await client.request('documents.read', { videoId: opened.ref.videoId, documentId, revision });
      expect(after.body).toEqual(before.body);
      expect(imported.documents[documentId]!.revisions[revision]!.contentHash).toBe(
        original.documents[documentId]!.revisions[revision]!.contentHash,
      );
    }
    const status = await client.request('videos.assetStatus', { videoId: opened.ref.videoId });
    expect(status).toMatchObject({ missing: [] });

    // 再导出打开的视频：文档与素材文件逐个相同。
    const again = await exportOnce({ videoId: opened.ref.videoId, settings: { kind: 'portable' } });
    const second = await readJsonEntry<PackageManifest>(again.result!.outputs![0]!.path!, 'video.manifest.json');
    const digests = (m: PackageManifest) =>
      m.files
        .filter((f) => f.path !== 'video.snapshot.json')
        .map((f) => `${f.path} ${f.sha256}`)
        .sort();
    expect(digests(second)).toEqual(digests(manifest));

    // 坏包：改掉一个字节，打开时以摘要不符拒绝，不留下视频目录。
    const broken = path.join(other.path, 'broken.baocut');
    const bytes = await fs.readFile(file);
    const docEntry = entries.find((e) => e.path.startsWith('documents/'))!;
    bytes[docEntry.offset] = bytes[docEntry.offset]! ^ 1;
    await fs.writeFile(broken, bytes);
    const before = await fs.readdir(other.path);
    const refused = await rejection(client.request('videos.importPackage', { projectId: other.id, path: 'broken.baocut' }));
    expect(refused.details).toMatchObject({ code: 'PACKAGE_DIGEST_MISMATCH' });
    expect(await fs.readdir(other.path)).toEqual(before);
  });

  it('预检逐项拒绝读不到的素材；跳过时清单如实标缺失，打开后是缺失的链接素材；目标已存在时拒绝', async () => {
    const [a, b, c] = [await fixture('a.wav'), await fixture('b.wav'), await fixture('c.wav')];
    const { ref } = await client.request('videos.create', { projectId: project.id, name: '缺素材' });
    const videoId = ref.videoId;
    await edit(videoId, [
      { type: 'importAsset', path: a, ref: 'a' },
      { type: 'importAsset', path: b, ref: 'b' },
      { type: 'importAsset', path: c, ref: 'c' },
      { type: 'addItem', sequenceId: snapshotOf(videoId).rootSequenceId, asset: { ref: 'a' }, alignment: 'nearest-frame' },
    ]);
    await fs.rm(a);
    await fs.chmod(b, 0);
    await fs.appendFile(c, Buffer.from([1]));
    const refused = await codeOf({ videoId, settings: { kind: 'portable' } });
    expect(refused.code).toBe('ASSET_MISSING');
    const reasons = Object.fromEntries(refused.items!.map((i) => [i.name, i.reason]));
    const root = process.getuid?.() === 0;
    expect(reasons).toEqual({ 'a.wav': 'missing', 'b.wav': root ? 'changed' : 'unreadable', 'c.wav': 'changed' });
    // 预检不过：没有建任务，也没有写任何文件。
    expect(await fs.readdir(path.join(project.path, 'exports')).catch(() => [])).toEqual([]);

    const job = await exportOnce({ videoId, settings: { kind: 'portable', missingAssets: 'skip' } });
    const out = job.result!.outputs![0]!;
    expect(out.media).toMatchObject({ kind: 'package', assets: 0, missingAssets: 3 });
    expect(job.warnings.filter((w) => w.code === 'PACKAGE_ASSET_MISSING')).toHaveLength(3);
    const manifest = await readJsonEntry<PackageManifest>(out.path!, 'video.manifest.json');
    expect(manifest.entries.filter((e) => e.kind === 'asset').map((e) => e.inclusion)).toEqual(['missing', 'missing', 'missing']);
    const snapshot = await readJsonEntry<VideoSnapshot>(out.path!, 'video.snapshot.json');
    for (const asset of Object.values(snapshot.assets)) {
      for (const version of Object.values(asset.revisions)) {
        expect(version.storage).toEqual({ mode: 'linked', locator: { path: asset.name }, frozen: false });
      }
    }

    // 目标已存在：指定的文件名拒绝，默认名加序号。
    const taken = await codeOf({
      videoId,
      settings: { kind: 'portable', missingAssets: 'skip' },
      destination: { fileName: '缺素材.baocut' },
    });
    expect(taken.code).toBe('EXPORT_DESTINATION_EXISTS');
    const second = await exportOnce({ videoId, settings: { kind: 'portable', missingAssets: 'skip' } });
    expect(second.result!.outputs![0]!.path).toBe(path.join(project.path, 'exports', '缺素材 (2).baocut'));

    // 打开跳过了素材的包：视频照样建出来，那些素材是缺失的链接素材。
    const opened = await client.request('videos.importPackage', { projectId: project.id, path: out.path! });
    const imported = snapshotOf(opened.ref.videoId);
    for (const asset of Object.values(imported.assets)) {
      for (const version of Object.values(asset.revisions)) expect(version.storage.mode).toBe('linked');
    }
  });

  it('取消：不留下半个包，也不留临时文件', async () => {
    const big = path.join(project.path, 'media', 'big.json');
    await fs.mkdir(path.dirname(big), { recursive: true });
    const handle = await fs.open(big, 'w');
    await handle.truncate(400 * 1024 * 1024);
    await handle.close();
    const { ref } = await client.request('videos.create', { projectId: project.id, name: '大' });
    await edit(ref.videoId, [{ type: 'importAsset', path: big }]);
    const { jobId } = await client.request('exports.create', { videoId: ref.videoId, settings: { kind: 'portable' } });
    await until(async () => (await client.request('exports.get', { jobId })).state === 'running');
    await client.request('jobs.cancel', { jobId });
    const job = await finish(jobId);
    expect(job.state).toBe('cancelled');
    expect(await fs.readdir(path.join(project.path, 'exports'))).toEqual([]);
  });

  it('工程导出：序列写成 xmeml，素材按路径引用，表达不了的逐项警告', async () => {
    const a = await fixture('a.wav');
    const { ref } = await client.request('videos.create', { projectId: project.id, name: '工程' });
    const videoId = ref.videoId;
    const sequenceId = snapshotOf(videoId).rootSequenceId;
    await edit(videoId, [
      { type: 'importAsset', path: path.join(fixtures, 'clip.mp4'), ref: 'clip' },
      { type: 'importAsset', path: a, ref: 'a' },
      { type: 'addItem', sequenceId, asset: { ref: 'clip' }, alignment: 'nearest-frame' },
      { type: 'addItem', sequenceId, asset: { ref: 'a' }, alignment: 'nearest-frame' },
    ]);
    const clipItem = snapshotOf(videoId).sequences[sequenceId]!.items.find((i) => i.type === 'video')!;
    await edit(videoId, [
      {
        type: 'setAudioMix',
        sequenceId,
        itemId: snapshotOf(videoId).sequences[sequenceId]!.items.find((i) => i.type === 'audio')!.id,
        volume: 0.5,
      },
      { type: 'addTrack', sequenceId, kind: 'visual', name: '标题' },
    ]);
    const titleTrack = snapshotOf(videoId).sequences[sequenceId]!.tracks.find((t) => t.name === '标题')!.id;
    await edit(videoId, [
      {
        type: 'insertItems',
        sequenceId,
        items: [
          {
            type: 'text',
            trackId: titleTrack,
            span: { fromFrame: 0, durationFrames: 15 },
            place: { x: 50, y: 50, w: 20 },
            text: '标题',
            style: { fontSize: 60, fontColor: '#ffffff' },
          },
        ],
      },
    ]);

    const job = await exportOnce({ videoId, settings: { kind: 'project', format: 'xmeml' } });
    const out = job.result!.outputs![0]!;
    expect(out.path).toBe(path.join(project.path, 'exports', '工程.xmeml.xml'));
    expect(out.mediaType).toBe('application/xml');
    // 视频片段、它的内嵌声音、录音：三个片段。
    expect(out.media).toMatchObject({ kind: 'project', clips: 3 });
    const xml = await fs.readFile(out.path!, 'utf8');
    expect(xml).toContain('<xmeml version="5">');
    expect(xml).toContain('<timebase>30</timebase>');
    expect(xml).toContain(`<pathurl>file://localhost${encodeURI(path.join(fixtures, 'clip.mp4'))}</pathurl>`);
    expect(xml.match(/<clipitem /g)).toHaveLength(3);
    expect(xml).toContain(`<start>${clipItem.type === 'video' ? clipItem.span.fromFrame : 0}</start>`);
    const omitted = job.warnings.filter((w) => w.code === 'PROJECT_ITEM_OMITTED');
    expect(omitted.some((w) => w.detail?.includes('音量'))).toBe(true);
    // 文字没有写进工程，警告点名到实例。
    const text = snapshotOf(videoId).sequences[sequenceId]!.items.find((i) => i.type === 'text')!;
    expect(omitted.find((w) => w.detail?.includes(text.id))?.detail).toContain('文字');
    expect(xml).not.toContain('标题</name>');
    // 序列为空（只剩文字）时没有能写进工程的片段：预检拒绝。
    const others = snapshotOf(videoId)
      .sequences[sequenceId]!.items.filter((i) => i.type !== 'text')
      .map((i) => i.id);
    await edit(videoId, [{ type: 'deleteItems', sequenceId, itemIds: others }]);
    expect((await codeOf({ videoId, settings: { kind: 'project', format: 'xmeml' } })).code).toBe('EXPORT_NOTHING_TO_EXPORT');
  });

  it('命令行 import-package：经发现文件连上运行中的 Runtime，在 --project 指定的项目里建成新视频；坏包以错误码退出', async () => {
    const { videoId } = await richVideo();
    const original = snapshotOf(videoId);
    const file = (await exportOnce({ videoId, settings: { kind: 'portable' } })).result!.outputs![0]!.path!;
    const target = path.join(dir, '打开到这里');
    await fs.mkdir(target);

    const run = await cli(dir, ['videos', 'import-package', file, '--project', target]);
    expect(run.stderr).toBe('');
    expect(run.code).toBe(0);
    // 目录派生的命令：stdout 不是 TTY 时是一行信封，结果是与 videos inspect 相同的摘要。
    const envelope = JSON.parse(run.stdout.trim()) as { ok: boolean; result: { videoId: string; name: string; video: string } };
    expect(envelope.ok).toBe(true);
    const printed = envelope.result;
    expect(printed.videoId).not.toBe(videoId);
    expect(printed.name).toBe('便携');
    // 项目是 --project 那个目录（没登记过的目录由命令登记）；视频目录是项目里的 result.video。
    const { projects } = await client.request('projects.list', {});
    const realTarget = await fs.realpath(target);
    const projectId = (await Promise.all(projects.map(async (p) => ((await fs.realpath(p.path)) === realTarget ? p.id : null)))).find(
      Boolean,
    )!;
    expect(projectId).toBeTruthy();
    await fs.access(path.join(target, printed.video, 'video.db'));
    // 新视频的内容与原视频相同，素材都收进了视频。
    const opened = await client.request('videos.open', { projectId, path: printed.video });
    expect(opened.ref.videoId).toBe(printed.videoId);
    expect(opened.snapshot.video.sequences).toEqual(original.sequences);
    expect(Object.keys(opened.snapshot.video.assets).sort()).toEqual(Object.keys(original.assets).sort());
    expect(await client.request('videos.assetStatus', { videoId: printed.videoId })).toMatchObject({ missing: [] });

    // 不是 BaoCut 包：非零退出，错误码在 stderr，不建视频目录。
    const bogus = path.join(dir, 'bogus.baocut');
    await fs.writeFile(bogus, 'not a package');
    const before = await fs.readdir(target);
    const refused = await cli(dir, ['videos', 'import-package', bogus, '--project', target]);
    expect(refused.code).not.toBe(0);
    expect(refused.stdout + refused.stderr).toContain('PACKAGE_INVALID');
    expect(JSON.parse(refused.stdout) as { ok: boolean }).toMatchObject({ ok: false });
    expect(await fs.readdir(target)).toEqual(before);
  });

  it('启动时清掉上次强杀留下的导出临时文件与打开便携包的暂存目录；用户文件与刚写的留着', async () => {
    const { videoId } = await richVideo();
    const job = await exportOnce({ videoId, settings: { kind: 'portable' } });
    const exportsDir = path.join(project.path, 'exports');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    // 模拟强杀：发布之前的隐藏临时文件、解到一半的暂存目录，都是很久以前留下的。
    const leftoverTemp = path.join(exportsDir, '.便携.baocut.0a1b2c3d.tmp');
    await fs.writeFile(leftoverTemp, 'partial');
    await fs.utimes(leftoverTemp, old, old);
    const projectReal = await fs.realpath(project.path);
    const leftoverStaging = path.join(projectReal, '.baocut-import-0123abcd');
    await fs.mkdir(path.join(leftoverStaging, 'assets'), { recursive: true });
    await fs.writeFile(path.join(leftoverStaging, 'assets', 'half.bin'), 'x');
    await fs.utimes(leftoverStaging, old, old);
    // 不该动的：刚写的临时文件、名字对不上的、用户自己的文件。
    const fresh = path.join(exportsDir, '.便携.baocut.89abcdef.tmp');
    await fs.writeFile(fresh, 'new');
    const userFile = path.join(exportsDir, '.便携.baocut.notmine.tmp');
    await fs.writeFile(userFile, 'mine');
    await fs.utimes(userFile, old, old);
    const userDir = path.join(projectReal, '.baocut-import-mine');
    await fs.mkdir(userDir);
    await fs.utimes(userDir, old, old);
    expect(job.export?.destination).toMatchObject({ dir: exportsDir, files: ['便携.baocut'] });

    client.close();
    await runtime.close();
    await boot();
    await until(async () => !(await exists(leftoverTemp)) && !(await exists(leftoverStaging)));
    for (const kept of [fresh, userFile, userDir, job.result!.outputs![0]!.path!]) expect(await exists(kept), kept).toBe(true);
  });
});

async function exists(file: string): Promise<boolean> {
  return fs.lstat(file).then(
    () => true,
    () => false,
  );
}
