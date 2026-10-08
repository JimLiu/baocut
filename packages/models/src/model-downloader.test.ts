import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MANIFEST_FILE } from './model-catalog.ts';
import { DOWNLOAD_REMEDIES, DownloadError, ModelDownloader, diskFreeBytes, type DownloadFile } from './model-downloader.ts';
import { STAGING_DIR, stagingDirOf } from './model-staging.ts';
import { sha256Of, startFakeModelSource, syntheticBytes, type FakeModelSource } from './testing/fake-model-source.ts';

const REPO = 'acme/tiny-model';
const REV = '0123456789abcdef0123456789abcdef01234567';

describe('ModelDownloader', () => {
  let root: string;
  let source: FakeModelSource;
  const weights = syntheticBytes(300_000, 7);
  const config = Buffer.from('{"layers":2}');
  const files: DownloadFile[] = [
    { path: 'config.json', size: config.length, sha256: sha256Of(config) },
    { path: 'sub/model.safetensors', size: weights.length, sha256: sha256Of(weights) },
  ];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-dl-'));
    source = await startFakeModelSource();
    source.put(REPO, REV, 'config.json', config);
    source.put(REPO, REV, 'sub/model.safetensors', weights);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await source.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const downloader = (extra: Partial<ConstructorParameters<typeof ModelDownloader>[0]> = {}) =>
    new ModelDownloader({ root, endpoint: source.endpoint, backoffMs: () => 5, ...extra });

  it('下载到暂存区、核对、原子发布并写清单', async () => {
    const d = downloader();
    let bytes = 0;
    await d.download(REPO, REV, files, new AbortController().signal, (delta) => (bytes += delta));
    expect(bytes).toBe(config.length + weights.length);
    const stage = stagingDirOf(root, REPO, REV);
    expect(await fs.readFile(path.join(stage, 'sub/model.safetensors'))).toEqual(weights);
    expect(await fs.stat(path.join(root, 'acme', 'tiny-model')).catch(() => null)).toBeNull();

    const manifest = await d.publish(REPO, REV, files);
    expect(manifest).toMatchObject({ format_version: 1, repo: REPO, revision: REV, source: source.endpoint });
    expect(manifest.files).toEqual([
      { path: 'config.json', size: config.length, sha256: files[0]!.sha256, source_verified: true },
      { path: 'sub/model.safetensors', size: weights.length, sha256: files[1]!.sha256, source_verified: true },
    ]);
    const dir = path.join(root, 'acme', 'tiny-model');
    expect(JSON.parse(await fs.readFile(path.join(dir, MANIFEST_FILE), 'utf8'))).toEqual(manifest);
    expect(await fs.readFile(path.join(dir, 'sub/model.safetensors'))).toEqual(weights);
    // 暂存区清空，空的上级目录也删掉。
    expect(await fs.stat(path.join(root, STAGING_DIR)).catch(() => null)).toBeNull();
    // 请求不带凭据。
    expect(source.requests.every((r) => r.headers.authorization === undefined)).toBe(true);
  });

  it('断流后按 Range 续传，已收到的字节不再下载', async () => {
    source.fault('sub/model.safetensors', { breakAfter: 100_000 });
    let bytes = 0;
    await downloader().download(REPO, REV, files, new AbortController().signal, (delta) => (bytes += delta));
    const gets = source.requests.filter((r) => r.method === 'GET' && r.file === 'sub/model.safetensors');
    expect(gets).toHaveLength(2);
    expect(gets[0]!.range).toBeNull();
    const resumedAt = Number(/^bytes=(\d+)-$/.exec(gets[1]!.range ?? '')?.[1]);
    expect(resumedAt).toBeGreaterThan(0);
    expect(resumedAt).toBeLessThanOrEqual(100_000);
    expect(bytes).toBe(config.length + weights.length);
    expect(await fs.readFile(path.join(stagingDirOf(root, REPO, REV), 'sub/model.safetensors'))).toEqual(weights);
  });

  it('取消：停下并留下 .part；下次带 Range 从断点接着下，核对过的文件不再请求', async () => {
    source.throttle(16 * 1024, 15);
    const controller = new AbortController();
    let received = 0;
    const run = downloader().download(REPO, REV, files, controller.signal, (delta) => {
      received += delta;
      if (received > config.length + 50_000) controller.abort(new Error('cancelled'));
    });
    await expect(run).rejects.toThrow('cancelled');
    const part = path.join(stagingDirOf(root, REPO, REV), 'sub/model.safetensors.part');
    const kept = (await fs.stat(part)).size;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(weights.length);
    expect(await fs.readFile(path.join(stagingDirOf(root, REPO, REV), 'config.json'))).toEqual(config);

    source.throttle(64 * 1024, 0);
    const before = source.requests.length;
    let more = 0;
    await downloader().download(REPO, REV, files, new AbortController().signal, (delta) => (more += delta));
    const later = source.requests.slice(before);
    expect(later.map((r) => r.file)).toEqual(['sub/model.safetensors']);
    expect(later[0]!.range).toBe(`bytes=${kept}-`);
    expect(more).toBe(weights.length - kept);
  });

  it('来源不支持续传（回 200）时从头写，进度扣回作废的字节', async () => {
    source.fault('sub/model.safetensors', { breakAfter: 50_000 });
    source.fault('sub/model.safetensors', { ignoreRange: true });
    let bytes = 0;
    await downloader().download(REPO, REV, files, new AbortController().signal, (delta) => (bytes += delta));
    expect(bytes).toBe(config.length + weights.length);
    expect(await fs.readFile(path.join(stagingDirOf(root, REPO, REV), 'sub/model.safetensors'))).toEqual(weights);
  });

  it('内容不符：删掉坏文件，报 MODEL_DOWNLOAD_INTEGRITY 并带补救说明', async () => {
    source.fault('sub/model.safetensors', { corrupt: true });
    const error = await downloader()
      .download(REPO, REV, files, new AbortController().signal)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).code).toBe('MODEL_DOWNLOAD_INTEGRITY');
    expect((error as DownloadError).remedy).toContain('换一个下载来源');
    // 补救说明给人看：设置按设置页上的名字说，不写设置键。
    for (const remedy of Object.values(DOWNLOAD_REMEDIES)) expect(remedy).not.toMatch(/models\.\w+/);
    expect(DOWNLOAD_REMEDIES.MODEL_DOWNLOAD_NETWORK).toContain('「设置 › 通用」的「模型下载来源」');
    expect(DOWNLOAD_REMEDIES.MODEL_DOWNLOAD_SOURCE).toContain('「设置 › 通用」的「模型下载来源」');
    expect((error as DownloadError).details).toMatchObject({ file: 'sub/model.safetensors', expectedSha256: files[1]!.sha256 });
    const stage = stagingDirOf(root, REPO, REV);
    expect(await fs.stat(path.join(stage, 'sub/model.safetensors.part')).catch(() => null)).toBeNull();
    expect(await fs.stat(path.join(stage, 'sub/model.safetensors')).catch(() => null)).toBeNull();
  });

  it('续传出来的文件不符：从头再下一次；干净的那次对了就算成功', async () => {
    // 先留下一个内容是坏的 `.part`（像旧的、不属于这个版本的残留）。
    const stage = stagingDirOf(root, REPO, REV);
    await fs.mkdir(path.join(stage, 'sub'), { recursive: true });
    await fs.writeFile(path.join(stage, 'sub/model.safetensors.part'), Buffer.alloc(1000, 1));
    await downloader().download(REPO, REV, files, new AbortController().signal);
    expect(await fs.readFile(path.join(stage, 'sub/model.safetensors'))).toEqual(weights);
    const gets = source.requests.filter((r) => r.method === 'GET' && r.file === 'sub/model.safetensors');
    expect(gets.map((r) => r.range)).toEqual(['bytes=1000-', null]);
  });

  it('多出字节的内容按不符处理', async () => {
    source.put(REPO, REV, 'config.json', Buffer.concat([config, Buffer.from('extra')]));
    const error = await downloader()
      .download(REPO, REV, files, new AbortController().signal)
      .catch((e: unknown) => e);
    expect((error as DownloadError).code).toBe('MODEL_DOWNLOAD_INTEGRITY');
  });

  it('404 不重试，报 MODEL_DOWNLOAD_SOURCE；5xx 重试用完报 MODEL_DOWNLOAD_NETWORK', async () => {
    const missing = await downloader()
      .download(REPO, REV, [{ path: 'nope.bin', size: 1, sha256: '0'.repeat(64) }], new AbortController().signal)
      .catch((e: unknown) => e);
    expect((missing as DownloadError).code).toBe('MODEL_DOWNLOAD_SOURCE');
    expect((missing as DownloadError).details).toMatchObject({ status: 404 });
    expect(source.gets('nope.bin')).toBe(1);

    source.fault('config.json', { status: 503 }, 3);
    const flaky = await downloader({ retries: 2 })
      .download(REPO, REV, files, new AbortController().signal)
      .catch((e: unknown) => e);
    expect((flaky as DownloadError).code).toBe('MODEL_DOWNLOAD_NETWORK');
    expect((flaky as DownloadError).details).toMatchObject({ status: 503, attempts: 3 });
    expect((flaky as DownloadError).remedy).toContain('续传');

    // 重试次数之内恢复就成功。
    source.fault('config.json', { status: 500 }, 2);
    await downloader({ retries: 2 }).download(REPO, REV, files, new AbortController().signal);
  });

  it('连不上来源：MODEL_DOWNLOAD_NETWORK', async () => {
    const endpoint = source.endpoint;
    await source.close();
    const error = await new ModelDownloader({ root, endpoint, retries: 1, backoffMs: () => 1 })
      .download(REPO, REV, files, new AbortController().signal)
      .catch((e: unknown) => e);
    expect((error as DownloadError).code).toBe('MODEL_DOWNLOAD_NETWORK');
    expect((error as DownloadError).details).toMatchObject({ reason: 'connect' });
    source = await startFakeModelSource();
  });

  it('收不到数据超过期限算断开，续传', async () => {
    source.fault('sub/model.safetensors', { stallAfter: 64 * 1024 });
    await downloader({ stallMs: 200 }).download(REPO, REV, files, new AbortController().signal);
    const gets = source.requests.filter((r) => r.method === 'GET' && r.file === 'sub/model.safetensors');
    expect(gets).toHaveLength(2);
    expect(gets[1]!.range).toMatch(/^bytes=\d+-$/);
  });

  it('写入时磁盘满：MODEL_DOWNLOAD_NO_SPACE', async () => {
    const realOpen = fs.open;
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await realOpen(file, flags, mode);
      if (!String(file).endsWith('.part')) return handle;
      return Object.assign(Object.create(handle) as typeof handle, {
        write: async () => {
          throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
        },
        close: () => handle.close(),
      });
    });
    const error = await downloader()
      .download(REPO, REV, files, new AbortController().signal)
      .catch((e: unknown) => e);
    expect((error as DownloadError).code).toBe('MODEL_DOWNLOAD_NO_SPACE');
    expect((error as DownloadError).remedy).toContain('磁盘空间不足');
  });

  it('发布替换旧版本的目录；可用空间查最近的已存在的上级目录', async () => {
    const dir = path.join(root, 'acme', 'tiny-model');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'stale.bin'), 'old');
    const d = downloader();
    await d.download(REPO, REV, files, new AbortController().signal);
    await d.publish(REPO, REV, files);
    expect(await fs.stat(path.join(dir, 'stale.bin')).catch(() => null)).toBeNull();
    expect((await fs.readdir(path.join(root, 'acme'))).sort()).toEqual(['tiny-model']);
    expect(await diskFreeBytes(path.join(root, 'not', 'yet', 'there'))).toBeGreaterThan(0);
  });
});
