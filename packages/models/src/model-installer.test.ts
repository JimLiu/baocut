import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readInstallRecord } from './install-record.ts';
import { ModelCatalog } from './model-catalog.ts';
import { DownloadError } from './model-downloader.ts';
import { ModelInstaller, type InstallProgress } from './model-installer.ts';
import { stagingDirOf } from './model-staging.ts';
import {
  serveRepo,
  sharedVadBundles,
  startFakeModelSource,
  syntheticBytes,
  syntheticManifest,
  type FakeModelSource,
  type SyntheticRepo,
} from './testing/fake-model-source.ts';

const asrA: SyntheticRepo = {
  repo: 'acme/asr-a',
  revision: 'a'.repeat(40),
  files: { 'config.json': Buffer.from('{"a":1}'), 'model.safetensors': syntheticBytes(200_000, 1) },
};
const asrB: SyntheticRepo = {
  repo: 'acme/asr-b',
  revision: 'b'.repeat(40),
  files: { 'config.json': Buffer.from('{"b":1}'), 'model.safetensors': syntheticBytes(150_000, 2) },
};
const vad: SyntheticRepo = {
  repo: 'acme/vad',
  revision: 'c'.repeat(40),
  files: { 'config.json': Buffer.from('{}'), 'model.safetensors': syntheticBytes(40_000, 3) },
};
const bytesOf = (repo: SyntheticRepo) => Object.values(repo.files).reduce((sum, b) => sum + b.length, 0);

describe('ModelInstaller', () => {
  let root: string;
  let source: FakeModelSource;
  let free: number | null;
  const mac = { platform: 'darwin' as const, arch: 'arm64' };
  const bundles = sharedVadBundles(asrA, asrB, vad);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-install-'));
    source = await startFakeModelSource();
    for (const repo of [asrA, asrB, vad]) serveRepo(source, repo);
    free = 10 * 1024 * 1024 * 1024;
  });

  afterEach(async () => {
    await source.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  function setup(options: { sizes?: boolean; probeSizes?: boolean } = {}) {
    const manifests = [asrA, asrB, vad].map((r) => syntheticManifest(r, { sizes: options.sizes ?? true, estimatedBytes: 1_000_000 }));
    const catalog = new ModelCatalog({ root, ...mac, bundles, manifests });
    const installer = new ModelInstaller({
      catalog,
      endpoint: () => source.endpoint,
      manifests,
      freeBytes: async () => free,
      backoffMs: () => 5,
      ...(options.probeSizes !== undefined ? { probeSizes: options.probeSizes } : {}),
    });
    return { catalog, installer };
  }

  const run = (installer: ModelInstaller, bundleId: string, onProgress?: (p: InstallProgress) => void, repair = false) =>
    installer
      .plan(bundleId, { repair })
      .then((detail) => installer.install(detail, { signal: new AbortController().signal, ...(onProgress ? { onProgress } : {}) }));

  it('计划给出大小与来源；安装后已装好、记进安装记录，进度只增不减且以字节计', async () => {
    const { catalog, installer } = setup();
    const detail = await installer.plan('test-a@mlx');
    expect(detail.plan).toMatchObject({
      bundleId: 'test-a@mlx',
      downloadBytes: bytesOf(asrA) + bytesOf(vad),
      confirmBytes: bytesOf(asrA) + bytesOf(vad),
      resumedBytes: 0,
      availableBytes: free,
      source: source.endpoint,
      upToDate: false,
    });
    expect(detail.plan.components.map((c) => [c.component, c.action, c.files])).toEqual([
      ['asr', 'download', ['config.json', 'model.safetensors']],
      ['vad', 'download', ['config.json', 'model.safetensors']],
    ]);
    const progress: InstallProgress[] = [];
    const outcome = await installer.install(detail, { signal: new AbortController().signal, onProgress: (p) => progress.push(p) });
    expect(outcome.downloadedBytes).toBe(bytesOf(asrA) + bytesOf(vad));
    expect(outcome.published.map((m) => m.repo)).toEqual([asrA.repo, vad.repo]);
    expect(progress.at(-1)).toMatchObject({ phase: 'publishing', receivedBytes: bytesOf(asrA) + bytesOf(vad) });
    expect(progress.every((p) => p.totalBytes === bytesOf(asrA) + bytesOf(vad))).toBe(true);
    const received = progress.map((p) => p.receivedBytes);
    expect(received).toEqual([...received].sort((a, b) => a - b));

    const status = await catalog.status('test-a@mlx');
    expect(status).toMatchObject({ state: 'installed' });
    expect(status!.components!.find((c) => c.component === 'vad')).toMatchObject({ state: 'installed', sharedWith: ['test-b@mlx'] });
    expect(Object.keys((await readInstallRecord(root)).bundles)).toEqual(['test-a@mlx']);
    expect((await installer.plan('test-a@mlx')).plan).toMatchObject({ upToDate: true, downloadBytes: 0 });
  });

  it('共享组件只装一份：第二个模型包只下载自己缺的组件', async () => {
    const { catalog, installer } = setup();
    await run(installer, 'test-a@mlx');
    const before = source.requests.length;
    const detail = await installer.plan('test-b@mlx');
    expect(detail.plan.components.map((c) => [c.component, c.action])).toEqual([
      ['asr', 'download'],
      ['vad', 'keep'],
    ]);
    expect(detail.plan.downloadBytes).toBe(bytesOf(asrB));
    // 另一个模型包只缺一部分组件：报告 incomplete 并点名缺的组件。
    const status = await catalog.status('test-b@mlx');
    expect(status).toMatchObject({ state: 'not-installed', reason: 'incomplete' });
    expect(status!.detail).toContain('asr');
    await installer.install(detail, { signal: new AbortController().signal });
    expect(new Set(source.requests.slice(before).map((r) => r.repo))).toEqual(new Set([asrB.repo]));
  });

  it('引用计数：删除一个模型包保留别的模型包在用的组件；最后一个删掉时回收', async () => {
    const { catalog, installer } = setup();
    await run(installer, 'test-a@mlx');
    await run(installer, 'test-b@mlx');
    const first = await installer.remove('test-a@mlx');
    expect(first.removed).toEqual([asrA.repo]);
    expect(first.kept).toEqual([{ repo: vad.repo, usedBy: ['test-b@mlx'] }]);
    expect(await catalog.status('test-a@mlx')).toMatchObject({ state: 'not-installed', reason: 'incomplete' });
    expect(await catalog.status('test-b@mlx')).toMatchObject({ state: 'installed' });

    const last = await installer.remove('test-b@mlx');
    expect(last.removed.sort()).toEqual([asrB.repo, vad.repo].sort());
    expect(last.kept).toEqual([]);
    expect(await fs.readdir(root)).toEqual(['.bcut-installs.json']);
    expect((await readInstallRecord(root)).bundles).toEqual({});
  });

  it('文件齐全但没有记录的模型包也算持有者', async () => {
    const { installer } = setup();
    await run(installer, 'test-a@mlx');
    await run(installer, 'test-b@mlx');
    await fs.rm(path.join(root, '.bcut-installs.json'));
    const result = await installer.remove('test-a@mlx');
    expect(result.kept).toEqual([{ repo: vad.repo, usedBy: ['test-b@mlx'] }]);
  });

  it('仓库目录里是别的版本时不删', async () => {
    const { installer } = setup();
    const other = { ...vad, revision: 'd'.repeat(40) };
    serveRepo(source, other);
    const manifests = [syntheticManifest(other)];
    const catalog2 = new ModelCatalog({
      root,
      ...mac,
      bundles: [
        {
          ...bundles[0]!,
          bundleId: 'other@mlx',
          components: { vad: { family: 'silero-vad', repo: other.repo, revision: other.revision } },
        },
      ],
      manifests,
    });
    const otherInstaller = new ModelInstaller({
      catalog: catalog2,
      endpoint: () => source.endpoint,
      manifests,
      freeBytes: async () => free,
    });
    await run(otherInstaller, 'other@mlx');
    const result = await installer.remove('test-a@mlx');
    expect(result.kept).toEqual([{ repo: vad.repo, usedBy: [] }]);
    expect(await fs.stat(path.join(root, 'acme', 'vad')).catch(() => null)).not.toBeNull();
  });

  it('修复只重下坏的与缺的文件，好文件原样复用', async () => {
    const { catalog, installer } = setup();
    await run(installer, 'test-a@mlx');
    const asrDir = catalog.repoDir(asrA.repo);
    // 同样大小、内容坏了：只有修复的 sha256 校验看得出来。
    const weights = path.join(asrDir, 'model.safetensors');
    const bad = Buffer.from(asrA.files['model.safetensors']!);
    bad[10] = bad[10]! ^ 0xff;
    await fs.writeFile(weights, bad);
    expect(await catalog.status('test-a@mlx')).toMatchObject({ state: 'installed' });
    expect((await installer.plan('test-a@mlx')).plan.upToDate).toBe(true);

    const before = source.requests.length;
    const detail = await installer.plan('test-a@mlx', { repair: true });
    expect(detail.plan.components.map((c) => [c.component, c.action, c.files])).toEqual([
      ['asr', 'download', ['model.safetensors']],
      ['vad', 'keep', []],
    ]);
    expect(detail.plan.downloadBytes).toBe(asrA.files['model.safetensors']!.length);
    await installer.install(detail, { signal: new AbortController().signal });
    const fetched = source.requests.slice(before).filter((r) => r.method === 'GET');
    expect(fetched.map((r) => `${r.repo}:${r.file}`)).toEqual([`${asrA.repo}:model.safetensors`]);
    expect(await fs.readFile(weights)).toEqual(asrA.files['model.safetensors']);
    expect(await fs.readFile(path.join(asrDir, 'config.json'))).toEqual(asrA.files['config.json']);
    expect((await catalog.verify('test-a@mlx')).ok).toBe(true);
    expect((await installer.plan('test-a@mlx', { repair: true })).plan.upToDate).toBe(true);
  });

  it('缺文件的组件：只补缺的文件，不整个重下', async () => {
    const { catalog, installer } = setup();
    await run(installer, 'test-a@mlx');
    await fs.rm(path.join(catalog.repoDir(vad.repo), 'config.json'));
    expect(await catalog.status('test-a@mlx')).toMatchObject({ state: 'not-installed', reason: 'incomplete' });
    const detail = await installer.plan('test-a@mlx');
    expect(detail.plan.components.map((c) => [c.component, c.action, c.files])).toEqual([
      ['asr', 'keep', []],
      ['vad', 'download', ['config.json']],
    ]);
    expect(detail.plan.downloadBytes).toBe(vad.files['config.json']!.length);
    const before = source.requests.length;
    await installer.install(detail, { signal: new AbortController().signal });
    expect(source.requests.slice(before).map((r) => r.file)).toEqual(['config.json']);
    expect(await catalog.status('test-a@mlx')).toMatchObject({ state: 'installed' });
  });

  it('可用空间不足：MODEL_DOWNLOAD_NO_SPACE，带需要与可用的字节，不发请求', async () => {
    const { installer } = setup();
    free = 1000;
    const detail = await installer.plan('test-a@mlx');
    expect(detail.plan.availableBytes).toBe(1000);
    const error = await installer.install(detail, { signal: new AbortController().signal }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).code).toBe('MODEL_DOWNLOAD_NO_SPACE');
    expect((error as DownloadError).details).toEqual({ requiredBytes: bytesOf(asrA) + bytesOf(vad), availableBytes: 1000 });
    // 补救是给人看的一句话：不出现字段名（要多少、剩多少由界面与 CLI 按 details 念出来）。
    expect((error as DownloadError).remedy).toBe(
      '模型目录所在的磁盘空间不足：清理出足够的空间（或在设置里把模型目录换到别的磁盘）后再安装',
    );
    expect(source.requests.filter((r) => r.method === 'GET')).toEqual([]);
  });

  it('取消后暂存区留着：模型包报告暂停的安装；再次计划只算剩下的字节并续传', async () => {
    const { catalog, installer } = setup();
    source.throttle(8 * 1024, 10);
    const controller = new AbortController();
    const detail = await installer.plan('test-a@mlx');
    const running = installer.install(detail, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.receivedBytes > 50_000) controller.abort(new Error('cancelled'));
      },
    });
    await expect(running).rejects.toThrow('cancelled');
    const status = await catalog.status('test-a@mlx');
    expect(status).toMatchObject({
      state: 'not-installed',
      install: { state: 'paused', jobId: null, totalBytes: bytesOf(asrA) + bytesOf(vad) },
    });
    const staged = status!.install!.receivedBytes;
    expect(staged).toBeGreaterThan(50_000);

    source.throttle(64 * 1024, 0);
    const again = await installer.plan('test-a@mlx');
    expect(again.plan.resumedBytes).toBe(staged);
    expect(again.plan.downloadBytes).toBe(bytesOf(asrA) + bytesOf(vad) - staged);
    expect(again.totalBytes).toBe(bytesOf(asrA) + bytesOf(vad));
    const before = source.requests.length;
    const outcome = await installer.install(again, { signal: new AbortController().signal });
    expect(outcome.downloadedBytes).toBe(bytesOf(asrA) + bytesOf(vad) - staged);
    expect(source.requests.slice(before).some((r) => r.range !== null)).toBe(true);
    expect(await catalog.status('test-a@mlx')).toMatchObject({ state: 'installed' });
  });

  it('丢弃暂停的安装：删掉暂存区', async () => {
    const { catalog, installer } = setup();
    const stage = stagingDirOf(root, asrA.repo, asrA.revision);
    await fs.mkdir(stage, { recursive: true });
    await fs.writeFile(path.join(stage, 'model.safetensors.part'), Buffer.alloc(500));
    expect((await catalog.status('test-a@mlx'))!.install).toMatchObject({ state: 'paused', receivedBytes: 500 });
    await installer.discard('test-a@mlx');
    expect((await catalog.status('test-a@mlx'))!.install).toBeUndefined();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('大小未知：计划向来源发 HEAD 取大小；取不到时总字节数为未知、用估计值确认', async () => {
    const { installer } = setup({ sizes: false });
    const detail = await installer.plan('test-a@mlx');
    expect(detail.plan.downloadBytes).toBe(bytesOf(asrA) + bytesOf(vad));
    expect(source.requests.filter((r) => r.method === 'HEAD')).toHaveLength(4);

    const { installer: blind } = setup({ sizes: false, probeSizes: false });
    const unknown = await blind.plan('test-a@mlx');
    expect(unknown.plan).toMatchObject({ downloadBytes: null, estimatedBytes: 2_000_000, confirmBytes: 2_000_000 });
    expect(unknown.totalBytes).toBeNull();
    const progress: InstallProgress[] = [];
    await blind.install(unknown, { signal: new AbortController().signal, onProgress: (p) => progress.push(p) });
    expect(progress.every((p) => p.totalBytes === null)).toBe(true);
    expect(progress.at(-1)!.receivedBytes).toBe(bytesOf(asrA) + bytesOf(vad));
  });

  it('内置清单缺可信的哈希：拒绝安装（不下载了再算）', async () => {
    const manifests = [asrA, vad].map((r) => syntheticManifest(r));
    manifests[1]!.files[0]!.sha256 = null;
    const catalog = new ModelCatalog({ root, ...mac, bundles, manifests });
    const installer = new ModelInstaller({ catalog, endpoint: () => source.endpoint, manifests, freeBytes: async () => free });
    const error = await installer.plan('test-a@mlx').catch((e: unknown) => e);
    expect((error as DownloadError).code).toBe('MODEL_MANIFEST_INCOMPLETE');
    expect((error as DownloadError).details).toEqual({ repo: vad.repo, files: ['config.json'] });
    expect(source.requests).toEqual([]);
  });

  it('自检结果记进安装记录，模型包状态带 selfTest；状态变化通知监听者', async () => {
    const { catalog, installer } = setup();
    await run(installer, 'test-a@mlx');
    const changed: string[] = [];
    catalog.onChange((id) => changed.push(id));
    await installer.recordSelfTest('test-a@mlx', { state: 'passed', jobId: 'job-1', at: '2026-10-03T00:00:00.000Z' });
    expect((await catalog.status('test-a@mlx'))!.selfTest).toEqual({ state: 'passed', jobId: 'job-1', at: '2026-10-03T00:00:00.000Z' });
    catalog.setInstallState('test-b@mlx', { jobId: 'job-2', state: 'downloading', receivedBytes: 10, totalBytes: 100 });
    expect(await catalog.status('test-b@mlx')).toMatchObject({
      state: 'downloading',
      install: { jobId: 'job-2', state: 'downloading', receivedBytes: 10, totalBytes: 100 },
    });
    catalog.setInstallState('test-b@mlx', null);
    expect(changed).toEqual(['test-a@mlx', 'test-b@mlx', 'test-b@mlx']);
  });

  it('清单的 sourceRepo：大小与文件都向上游仓库要，装进登记的兄弟目录', async () => {
    const upstream: SyntheticRepo = { repo: 'acme/whisper', revision: 'd'.repeat(40), files: { 'big.bin': syntheticBytes(120_000, 4) } };
    serveRepo(source, upstream);
    const sibling = { ...syntheticManifest(upstream, { sizes: false }), repo: 'acme/whisper-big', sourceRepo: upstream.repo };
    const manifests = [syntheticManifest(vad), sibling];
    const def = {
      ...bundles[0]!,
      bundleId: 'big@ggml',
      backend: 'ggml' as const,
      device: 'cpu',
      components: { ...bundles[0]!.components, asr: { family: 'whisper-ggml' as const, repo: sibling.repo, revision: upstream.revision } },
    };
    const catalog = new ModelCatalog({ root, platform: 'win32', arch: 'x64', bundles: [def], manifests });
    const installer = new ModelInstaller({ catalog, endpoint: () => source.endpoint, manifests, freeBytes: async () => free });
    const detail = await installer.plan(def.bundleId);
    expect(detail.plan.downloadBytes).toBe(bytesOf(upstream) + bytesOf(vad));
    const heads = source.requests.filter((r) => r.method === 'HEAD');
    expect(heads.map((r) => [r.repo, r.file])).toEqual([[upstream.repo, 'big.bin']]);
    await installer.install(detail, { signal: new AbortController().signal });
    const gets = source.requests.filter((r) => r.method === 'GET' && r.file === 'big.bin');
    expect(gets.map((r) => r.repo)).toEqual([upstream.repo]);
    expect(await fs.readFile(path.join(root, 'acme', 'whisper-big', 'big.bin'))).toEqual(upstream.files['big.bin']);
    await expect(fs.stat(path.join(root, 'acme', 'whisper'))).rejects.toThrow();
    expect(await catalog.status(def.bundleId)).toMatchObject({ state: 'installed', backend: 'ggml', device: 'cpu' });
  });
});
