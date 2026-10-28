import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BundleDefinition, ComponentRelease } from './bundle-registry.ts';
import { readInstallRecord } from './install-record.ts';
import { localFileBundle, repoFileBundle } from './audio-cpp-catalog.ts';
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

  it('同一包的组件分别选源，计划、下载与清单都使用冻结的来源', async () => {
    const mirror = await startFakeModelSource();
    try {
      serveRepo(mirror, vad);
      const { installer } = setup();
      const detail = await installer.plan('test-a@mlx', { endpoints: { [`${vad.repo}@${vad.revision}`]: mirror.endpoint } });
      expect(detail.plan.components.map((c) => c.source)).toEqual([source.endpoint, mirror.endpoint]);
      await installer.install(detail, { signal: new AbortController().signal });
      expect(source.requests.filter((r) => r.method === 'GET').every((r) => r.repo === asrA.repo)).toBe(true);
      expect(mirror.requests.filter((r) => r.method === 'GET').every((r) => r.repo === vad.repo)).toBe(true);
      const manifest = JSON.parse(await fs.readFile(path.join(root, vad.repo, '.bcut-manifest.json'), 'utf8'));
      expect(manifest.source).toBe(mirror.endpoint);
    } finally { await mirror.close(); }
  });

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

  it('旧 master 缓存按固定清单验证复用，只下载缺组件；规划不修改旧 manifest', async () => {
    const { catalog, installer } = setup();
    await run(installer, 'test-a@mlx');
    const dir = catalog.repoDir(asrA.repo);
    const manifestFile = path.join(dir, '.bcut-manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    manifest.revision = 'master'; await fs.writeFile(manifestFile, JSON.stringify(manifest));
    await fs.rm(catalog.repoDir(vad.repo), { recursive: true });
    const before = source.requests.length;
    const detail = await installer.plan('test-a@mlx');
    expect(detail.plan.downloadBytes).toBe(bytesOf(vad));
    expect(JSON.parse(await fs.readFile(manifestFile, 'utf8')).revision).toBe('master');
    await installer.install(detail, { signal: new AbortController().signal });
    expect(source.requests.slice(before).filter((r) => r.method === 'GET').map((r) => r.repo)).toEqual([vad.repo, vad.repo]);
    expect(await fs.readFile(path.join(dir, 'model.safetensors'))).toEqual(asrA.files['model.safetensors']);
    expect(JSON.parse(await fs.readFile(manifestFile, 'utf8')).revision).toBe(asrA.revision);
    expect((await catalog.verify('test-a@mlx')).ok).toBe(true);
  });

  it('旧 revision 中同大小的损坏权重不能复用，其他有效文件无需重下', async () => {
    const { catalog, installer } = setup(); await run(installer, 'test-a@mlx');
    const dir = catalog.repoDir(asrA.repo);
    const file = path.join(dir, '.bcut-manifest.json');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8')); manifest.revision = 'master';
    await fs.writeFile(file, JSON.stringify(manifest));
    const bad = Buffer.from(asrA.files['model.safetensors']!); bad[0] = bad[0]! ^ 0xff;
    await fs.writeFile(path.join(dir, 'model.safetensors'), bad);
    const before = source.requests.length; const detail = await installer.plan('test-a@mlx');
    expect(detail.plan.downloadBytes).toBe(bad.length);
    await installer.install(detail, { signal: new AbortController().signal });
    expect(source.requests.slice(before).filter((r) => r.method === 'GET').map((r) => r.file)).toEqual(['model.safetensors']);
    expect((await catalog.verify('test-a@mlx')).ok).toBe(true);
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

  describe('存放位置', () => {
    let away: string;
    beforeEach(async () => {
      away = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-away-'));
    });
    afterEach(async () => {
      await fs.rm(away, { recursive: true, force: true });
    });

    it('下载到选定的文件夹：暂存与发布都在那里，记下位置；装好的共享组件留在原处，安装记录在模型目录', async () => {
      const { catalog, installer } = setup();
      await run(installer, 'test-a@mlx');
      const seen: string[] = [];
      const detail = await installer.plan('test-b@mlx', { dir: away });
      expect(detail.dir).toBe(away);
      expect(detail.plan.dir).toEqual({ path: away, modelsDir: root, locked: false, fixed: false, problem: null });
      expect(detail.components.map((c) => [c.component, c.action, c.root])).toEqual([
        ['asr', 'download', away],
        ['vad', 'keep', root],
      ]);
      catalog.onChange((id) => seen.push(id));
      await installer.install(detail, { signal: new AbortController().signal });
      expect(await readdirSafe(path.join(away, asrB.repo))).toContain('.bcut-manifest.json');
      expect(fsSync.existsSync(path.join(root, asrB.repo))).toBe(false);
      expect(fsSync.existsSync(path.join(away, '.bcut-staging'))).toBe(false);
      expect(catalog.locationOf(asrB.repo)).toBe(away);
      expect(catalog.repoDir(asrB.repo)).toBe(path.join(away, ...asrB.repo.split('/')));
      const status = await catalog.status('test-b@mlx');
      expect(status).toMatchObject({ state: 'installed' });
      expect(status!.components!.map((c) => [c.component, c.location ?? null])).toEqual([
        ['asr', away],
        ['vad', null],
      ]);
      expect(Object.keys((await readInstallRecord(root)).bundles).sort()).toEqual(['test-a@mlx', 'test-b@mlx']);
      expect(seen).toContain('test-b@mlx');
      // 已经装好的再计划：在原处，不再下载。
      expect((await installer.plan('test-b@mlx')).plan).toMatchObject({ upToDate: true });
    });

    it('选定的文件夹就是模型目录时照常放模型目录；不在、不能写时计划里报告问题', async () => {
      const { installer } = setup();
      expect((await installer.plan('test-a@mlx', { dir: root })).plan.dir).toEqual({ path: root, modelsDir: root, locked: false, fixed: false, problem: null });
      const missing = path.join(away, 'gone');
      expect((await installer.plan('test-a@mlx', { dir: missing })).plan.dir).toEqual({ path: missing, modelsDir: root, locked: false, fixed: false, problem: 'missing' });
      if (process.platform !== 'win32' && process.getuid?.() !== 0) {
        await fs.chmod(away, 0o500);
        try {
          expect((await installer.plan('test-a@mlx', { dir: away })).plan.dir?.problem).toBe('not-writable');
        } finally {
          await fs.chmod(away, 0o700);
        }
      }
    });

    it('暂停在选定文件夹里的下载：状态报告暂停，再计划时不管请求的位置都在原处续传', async () => {
      const { catalog, installer } = setup();
      source.throttle(8 * 1024, 10);
      const controller = new AbortController();
      const running = installer.install(await installer.plan('test-a@mlx', { dir: away }), {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.receivedBytes > 50_000) controller.abort(new Error('cancelled'));
        },
      });
      await expect(running).rejects.toThrow('cancelled');
      expect(catalog.locationOf(asrA.repo)).toBe(away);
      const status = await catalog.status('test-a@mlx');
      expect(status!.install).toMatchObject({ state: 'paused' });
      const staged = status!.install!.receivedBytes;
      expect(staged).toBeGreaterThan(50_000);
      expect(fsSync.existsSync(path.join(root, '.bcut-staging'))).toBe(false);

      source.throttle(64 * 1024, 0);
      const again = await installer.plan('test-a@mlx');
      expect(again.plan.dir).toEqual({ path: away, modelsDir: root, locked: false, fixed: true, problem: null });
      expect(again.plan.resumedBytes).toBe(staged);
      expect(again.components.every((c) => c.root === away)).toBe(true);
      await installer.install(again, { signal: new AbortController().signal });
      expect(await catalog.status('test-a@mlx')).toMatchObject({ state: 'installed' });
      expect([catalog.locationOf(asrA.repo), catalog.locationOf(vad.repo)]).toEqual([away, away]);
    });

    it('丢弃暂停的下载与删除模型包都清掉位置记录；位置记录写进文件，重开目录读得回来', async () => {
      const file = path.join(away, 'store', 'model-locations.json');
      const manifests = [asrA, asrB, vad].map((r) => syntheticManifest(r, { sizes: true, estimatedBytes: 1_000_000 }));
      const catalog = new ModelCatalog({ root, ...mac, bundles, manifests, locationsFile: file });
      const installer = new ModelInstaller({ catalog, endpoint: () => source.endpoint, manifests, freeBytes: async () => free, backoffMs: () => 5 });
      const target = path.join(away, 'models');
      await fs.mkdir(target);
      await installer.install(await installer.plan('test-a@mlx', { dir: target }), { signal: new AbortController().signal });
      expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
        format_version: 1,
        repos: { [asrA.repo]: target, [vad.repo]: target },
      });
      const reopened = new ModelCatalog({ root, ...mac, bundles, manifests, locationsFile: file });
      expect(await reopened.status('test-a@mlx')).toMatchObject({ state: 'installed' });
      expect(reopened.locations()).toEqual([
        { repo: asrA.repo, dir: target },
        { repo: vad.repo, dir: target },
      ]);

      await installer.remove('test-a@mlx');
      expect(catalog.locations()).toEqual([]);
      expect(fsSync.existsSync(path.join(target, asrA.repo))).toBe(false);
      expect(JSON.parse(await fs.readFile(file, 'utf8')).repos).toEqual({});

      const stage = stagingDirOf(target, asrB.repo, asrB.revision);
      await fs.mkdir(stage, { recursive: true });
      await fs.writeFile(path.join(stage, 'model.safetensors.part'), Buffer.alloc(500));
      await catalog.setLocation(asrB.repo, target);
      expect((await catalog.status('test-b@mlx'))!.install).toMatchObject({ state: 'paused', receivedBytes: 500 });
      await installer.discard('test-b@mlx');
      expect(catalog.locationOf(asrB.repo)).toBeNull();
      expect(fsSync.existsSync(stage)).toBe(false);
    });

    it('按落到的磁盘分别查可用空间', async () => {
      const asked: string[] = [];
      const manifests = [asrA, asrB, vad].map((r) => syntheticManifest(r, { sizes: true, estimatedBytes: 1 }));
      const spaced = new ModelInstaller({
        catalog: new ModelCatalog({ root, ...mac, bundles, manifests }),
        endpoint: () => source.endpoint,
        manifests,
        freeBytes: async (dir) => {
          asked.push(dir);
          return dir === away ? 10 : 10 * 1024 * 1024 * 1024;
        },
      });
      const detail = await spaced.plan('test-a@mlx', { dir: away });
      expect(detail.plan.availableBytes).toBe(10);
      await expect(spaced.install(detail, { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_NO_SPACE' });
      expect(asked).toContain(away);
      expect(fsSync.existsSync(path.join(away, '.bcut-staging'))).toBe(false);
    });
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

  it('HEAD 不给大小（ModelScope）：改发只要第一个字节的 GET，从 Content-Range 读总长', async () => {
    const manifests = [asrA, asrB, vad].map((r) => syntheticManifest(r, { sizes: false, estimatedBytes: 1_000_000 }));
    const catalog = new ModelCatalog({ root, ...mac, bundles, manifests });
    const sizeless: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      return init?.method === 'HEAD' ? new Response(null, { status: response.status }) : response;
    };
    const installer = new ModelInstaller({ catalog, endpoint: () => source.endpoint, manifests, freeBytes: async () => free, fetch: sizeless });
    const detail = await installer.plan('test-a@mlx');
    expect(detail.plan.downloadBytes).toBe(bytesOf(asrA) + bytesOf(vad));
    const ranged = source.requests.filter((r) => r.method === 'GET');
    expect(ranged).toHaveLength(4);
    expect(ranged.every((r) => r.range === 'bytes=0-0')).toBe(true);

    // ModelScope 的小文件：回 200、`Content-Length` 是 1，但带 `Content-Range`。
    const quirky: typeof fetch = async (input, init) => {
      const response = await sizeless(input, init);
      return response.status === 206 ? new Response(await response.arrayBuffer(), { status: 200, headers: response.headers }) : response;
    };
    const quirk = new ModelInstaller({ catalog, endpoint: () => source.endpoint, manifests, freeBytes: async () => free, fetch: quirky });
    expect((await quirk.plan('test-a@mlx')).plan.downloadBytes).toBe(bytesOf(asrA) + bytesOf(vad));
  });

  it('计划的来源：选了 ModelScope 时，它上面没有的仓库改从公共模型仓库下载，两个基址都写出来', async () => {
    const whisper: SyntheticRepo = { repo: 'ggerganov/whisper.cpp', revision: 'e'.repeat(40), files: { 'ggml.bin': Buffer.from('w') } };
    const manifests = [syntheticManifest(vad), syntheticManifest(whisper)];
    const def = {
      ...bundles[0]!,
      bundleId: 'ggml@cpu',
      backend: 'ggml' as const,
      device: 'cpu',
      components: { ...bundles[0]!.components, asr: { family: 'whisper-ggml' as const, repo: whisper.repo, revision: whisper.revision } },
    };
    const catalog = new ModelCatalog({ root, platform: 'win32', arch: 'x64', bundles: [def], manifests });
    const plan = async (endpoint: string) =>
      (await new ModelInstaller({ catalog, endpoint: () => endpoint, manifests, freeBytes: async () => free, probeSizes: false }).plan(def.bundleId))
        .plan.source;
    expect(await plan('https://www.modelscope.cn')).toBe('https://www.modelscope.cn + https://huggingface.co');
    expect(await plan('https://mirror.example')).toBe('https://mirror.example');
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

/**
 * 发布页组件（LiteRT-LM 的 C 库这类交给 Worker 的动态库，架构设计 §6.3）：按主机平台下载压缩包，核对大小与 sha256，解开、写清单、
 * 原子地发布到工具目录；坏包不留半个目录；最后一个持有者删除时回收。压缩包由本机回环地址上的小服务器给出。
 */
describe('ModelInstaller 发布页组件', () => {
  let root: string;
  let work: string;
  let source: FakeModelSource;
  let server: http.Server;
  let base: string;
  let assets: Map<string, Buffer>;
  let requests: string[];
  const mac = { platform: 'darwin' as const, arch: 'arm64' };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-install-release-'));
    work = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-install-pack-'));
    source = await startFakeModelSource();
    for (const repo of [asrA, asrB]) serveRepo(source, repo);
    assets = new Map();
    requests = [];
    server = http.createServer((req, res) => {
      requests.push(req.url ?? '');
      const body = assets.get(req.url ?? '');
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
      const start = range ? Number(range[1]) : 0;
      res.writeHead(range ? 206 : 200, {
        'content-length': String(body.length - start),
        ...(range ? { 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` } : {}),
      });
      res.end(req.method === 'HEAD' ? undefined : body.subarray(start));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await source.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(work, { recursive: true, force: true });
  });

  /** 打一个像上游发布包的 tar.gz：动态库、同包的其他工具、依赖的库、许可与一个子目录。 */
  function packRelease(content: string): Buffer {
    const dir = path.join(work, `pack-${crypto.randomUUID()}`);
    fsSync.mkdirSync(path.join(dir, 'tools'), { recursive: true });
    fsSync.writeFileSync(path.join(dir, 'libtest.dylib'), content);
    fsSync.writeFileSync(path.join(dir, 'other-tool'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fsSync.writeFileSync(path.join(dir, 'libdep.so'), 'lib');
    fsSync.writeFileSync(path.join(dir, 'LICENSE'), 'Apache-2.0');
    fsSync.writeFileSync(path.join(dir, 'tools', 'notes.txt'), 'notes');
    const archive = path.join(work, `${crypto.randomUUID()}.tar.gz`);
    execFileSync('tar', ['-czf', archive, '-C', dir, '.']);
    return fsSync.readFileSync(archive);
  }

  function release(body: Buffer, fileName = 'test-lib.tar.gz'): ComponentRelease {
    assets.set(`/download/v0.9.1/${fileName}`, body);
    return {
      name: 'testlib',
      version: '0.9.1',
      urlTemplate: `${base}/download/v{version}/{file}`,
      assets: {
        'darwin-arm64': {
          fileName,
          size: body.length,
          sha256: crypto.createHash('sha256').update(body).digest('hex'),
          archive: { format: 'tar.gz', skip: ['other-tool'] },
          executable: 'libtest.dylib',
        },
      },
      workerLibrary: true,
    };
  }

  function setup(rel: ComponentRelease, options: { toolsEndpoint?: string } = {}) {
    const runtime = { family: 'litertlm-runtime' as const, repo: 'google-ai-edge/LiteRT-LM', revision: 'v0.9.1', release: rel };
    const bundle = (bundleId: string, repo: SyntheticRepo): BundleDefinition => ({
      bundleId,
      capability: 'embed',
      backend: 'litert-lm',
      device: 'cpu',
      label: bundleId,
      components: { embedding: { family: 'embeddinggemma2-litert', repo: repo.repo, revision: repo.revision }, 'litertlm-runtime': runtime },
    });
    const bundles = [bundle('embed-a@litert-lm', asrA), bundle('embed-b@litert-lm', asrB)];
    const manifests = [asrA, asrB].map((r) => syntheticManifest(r, { sizes: true, estimatedBytes: 1_000_000 }));
    const catalog = new ModelCatalog({ root, ...mac, bundles, manifests });
    const installer = new ModelInstaller({
      catalog,
      endpoint: () => source.endpoint,
      manifests,
      freeBytes: async () => 10 * 1024 * 1024 * 1024,
      backoffMs: () => 5,
      retries: 0,
      ...(options.toolsEndpoint ? { toolsEndpoint: options.toolsEndpoint } : {}),
    });
    return { catalog, installer, libDir: path.join(root, '.bcut-tools', 'testlib', '0.9.1') };
  }

  const run = (installer: ModelInstaller, bundleId: string, repair = false) =>
    installer.plan(bundleId, { repair }).then((detail) => installer.install(detail, { signal: new AbortController().signal }));

  it('随模型一起下载：计划按登记的大小（不发 HEAD），解开根目录的文件、略过同包工具，写清单', async () => {
    const body = packRelease('dylib');
    const { catalog, installer, libDir } = setup(release(body));
    const detail = await installer.plan('embed-a@litert-lm');
    expect(detail.plan.components.map((c) => [c.component, c.action, c.origin ?? null, c.files])).toEqual([
      ['embedding', 'download', null, ['config.json', 'model.safetensors']],
      ['litertlm-runtime', 'download', 'github-release', ['test-lib.tar.gz']],
    ]);
    expect(detail.plan.downloadBytes).toBe(bytesOf(asrA) + body.length);
    expect(detail.plan.confirmBytes).toBe(bytesOf(asrA) + body.length);
    // 官方地址的来源是 `/download/` 之前的部分（发布页）。
    expect(detail.plan.source).toBe(`${source.endpoint} + ${base}`);
    // 每个组件写出自己从哪个基址下载，界面按它分组、写地址。
    expect(detail.plan.components.map((c) => c.source)).toEqual([source.endpoint, base]);
    expect(requests).toEqual([]);
    const outcome = await installer.install(detail, { signal: new AbortController().signal });
    expect(outcome.downloadedBytes).toBe(bytesOf(asrA) + body.length);
    expect(requests).toEqual(['/download/v0.9.1/test-lib.tar.gz']);
    expect((await fs.readdir(libDir)).sort()).toEqual(['.bcut-manifest.json', 'LICENSE', 'libdep.so', 'libtest.dylib']);
    const manifest = JSON.parse(await fs.readFile(path.join(libDir, '.bcut-manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ format_version: 1, repo: 'google-ai-edge/LiteRT-LM', revision: 'v0.9.1', source: `${base}/download/v0.9.1/test-lib.tar.gz` });
    expect(manifest.files.map((f: { path: string }) => f.path)).toEqual(['LICENSE', 'libdep.so', 'libtest.dylib']);
    expect(await catalog.status('embed-a@litert-lm')).toMatchObject({ state: 'installed' });
    expect((await catalog.verify('embed-a@litert-lm')).ok).toBe(true);
    // 暂存区收拾干净。
    expect(await fs.readdir(path.join(root, '.bcut-tools'))).toEqual(['testlib']);
    // 第二个模型包共用这份库：只下载自己的权重。
    const second = await installer.plan('embed-b@litert-lm');
    expect(second.plan.components.map((c) => [c.component, c.action])).toEqual([
      ['embedding', 'download'],
      ['litertlm-runtime', 'keep'],
    ]);
  });

  it('工具下载镜像：地址是 <基址>/<名字>/<版本>/<文件名>，计划的来源是镜像', async () => {
    const body = packRelease('dylib');
    const rel = release(body);
    assets.set('/mirror/testlib/0.9.1/test-lib.tar.gz', body);
    const { installer, libDir } = setup(rel, { toolsEndpoint: `${base}/mirror/` });
    const detail = await installer.plan('embed-a@litert-lm');
    expect(detail.plan.source).toBe(`${source.endpoint} + ${base}/mirror`);
    await installer.install(detail, { signal: new AbortController().signal });
    expect(requests).toEqual(['/mirror/testlib/0.9.1/test-lib.tar.gz']);
    expect(await fs.stat(path.join(libDir, 'libtest.dylib'))).toBeTruthy();
  });

  it('发布页组件本次选源优先于默认，null 明确使用官方且不改变默认', async () => {
    const body = packRelease('dylib');
    const rel = release(body);
    assets.set('/selected/testlib/0.9.1/test-lib.tar.gz', body);
    const { installer } = setup(rel, { toolsEndpoint: `${base}/default` });
    const key = 'google-ai-edge/LiteRT-LM@v0.9.1';
    const official = await installer.plan('embed-a@litert-lm', { endpoints: { [key]: null } });
    expect(official.plan.components.find((c) => c.origin)?.source).not.toContain('/default');
    const chosen = await installer.plan('embed-a@litert-lm', { endpoints: { [key]: `${base}/selected` } });
    expect(chosen.plan.components.find((c) => c.origin)?.source).toBe(`${base}/selected`);
    const defaultPlan = await installer.plan('embed-a@litert-lm');
    expect(defaultPlan.plan.components.find((c) => c.origin)?.source).toBe(`${base}/default`);
    await installer.install(chosen, { signal: new AbortController().signal });
    expect(requests).toEqual(['/selected/testlib/0.9.1/test-lib.tar.gz']);
  });

  it('一部分没下成：失败带上那一部分与它连的基址；下好的权重留着，再计划只下缺的那一部分', async () => {
    const body = packRelease('dylib');
    const rel = release(body);
    // 镜像上没有这个包：404。
    const { catalog, installer } = setup(rel, { toolsEndpoint: `${base}/mirror` });
    const error = await run(installer, 'embed-a@litert-lm').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect((error as DownloadError).code).toBe('MODEL_DOWNLOAD_SOURCE');
    expect((error as DownloadError).details).toMatchObject({
      component: 'litertlm-runtime',
      repo: 'google-ai-edge/LiteRT-LM',
      origin: 'github-release',
      source: `${base}/mirror`,
      status: 404,
    });
    const status = await catalog.status('embed-a@litert-lm');
    expect(status?.components?.map((c) => [c.component, c.state])).toEqual([
      ['embedding', 'installed'],
      ['litertlm-runtime', 'missing'],
    ]);
    const again = await installer.plan('embed-a@litert-lm');
    expect(again.plan.components.map((c) => [c.component, c.action])).toEqual([
      ['embedding', 'keep'],
      ['litertlm-runtime', 'download'],
    ]);
    expect(again.plan.downloadBytes).toBe(body.length);
  });

  it('摘要不符：MODEL_DOWNLOAD_INTEGRITY，删掉下载的文件，不留组件目录', async () => {
    const body = packRelease('dylib');
    const rel = release(body);
    assets.set('/download/v0.9.1/test-lib.tar.gz', Buffer.concat([body.subarray(0, body.length - 1), Buffer.from([body.at(-1)! ^ 1])]));
    const { installer, libDir } = setup(rel);
    await expect(run(installer, 'embed-a@litert-lm')).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_INTEGRITY' });
    expect(await fs.stat(libDir).catch(() => null)).toBeNull();
    const stage = path.join(root, '.bcut-tools', '.bcut-staging', 'testlib@0.9.1');
    const left = await fs.readdir(stage).catch(() => [] as string[]);
    expect(left.filter((f) => f.startsWith('test-lib'))).toEqual([]);
  });

  it('坏包与缺登记的文件：MODEL_DOWNLOAD_INTEGRITY，删掉暂存区，不留半个目录', async () => {
    const garbage = Buffer.from('this is not a gzip archive at all');
    const { installer, libDir } = setup(release(garbage));
    await expect(run(installer, 'embed-a@litert-lm')).rejects.toMatchObject({ code: 'MODEL_DOWNLOAD_INTEGRITY' });
    expect(await fs.stat(libDir).catch(() => null)).toBeNull();
    expect(await fs.stat(path.join(root, '.bcut-tools', '.bcut-staging')).catch(() => null)).toBeNull();

    const dir = path.join(work, 'no-exe');
    fsSync.mkdirSync(dir);
    fsSync.writeFileSync(path.join(dir, 'LICENSE'), 'x');
    const archive = path.join(work, 'no-exe.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', dir, '.']);
    const noExe = setup(release(fsSync.readFileSync(archive), 'no-exe.tar.gz'));
    const error = await run(noExe.installer, 'embed-a@litert-lm').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DownloadError);
    expect(error).toMatchObject({ code: 'MODEL_DOWNLOAD_INTEGRITY' });
    expect((error as Error).message).toContain('libtest.dylib');
    expect(await fs.stat(libDir).catch(() => null)).toBeNull();
    expect(await fs.stat(path.join(root, '.bcut-tools', '.bcut-staging')).catch(() => null)).toBeNull();
  });

  it('引用计数：删除一个模型包保留共用的库；最后一个删掉时回收工具目录里的库', async () => {
    const { catalog, installer, libDir } = setup(release(packRelease('dylib')));
    await run(installer, 'embed-a@litert-lm');
    await run(installer, 'embed-b@litert-lm');
    const first = await installer.remove('embed-a@litert-lm');
    expect(first.removed).toEqual([asrA.repo]);
    expect(first.kept).toEqual([{ repo: 'google-ai-edge/LiteRT-LM', usedBy: ['embed-b@litert-lm'] }]);
    expect(await fs.stat(path.join(libDir, 'libtest.dylib'))).toBeTruthy();
    const last = await installer.remove('embed-b@litert-lm');
    expect(last.removed).toEqual([asrB.repo, 'google-ai-edge/LiteRT-LM']);
    expect(await fs.stat(libDir).catch(() => null)).toBeNull();
    expect(await fs.stat(path.join(root, '.bcut-tools', 'testlib')).catch(() => null)).toBeNull();
    expect(await catalog.status('embed-b@litert-lm')).toMatchObject({ state: 'not-installed' });
  });

  it('添加的 GGUF：从上游仓库按添加时的提交下载，放在自己的目录里；原地引用的文件不下载、删除也不碰', async () => {
    const voice: SyntheticRepo = { repo: 'me/voices', revision: 'e'.repeat(40), files: { 'q/v-q8.gguf': syntheticBytes(30_000, 9) } };
    serveRepo(source, voice);
    const catalog = new ModelCatalog({ root, ...mac, engineAvailable: () => true });
    const content = voice.files['q/v-q8.gguf']!;
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const added = repoFileBundle({ family: 'qwen3_tts', repo: voice.repo, revision: voice.revision, path: 'q/v-q8.gguf', size: content.length, sha256, label: 'v' }, 'custom-abc@audio-cpp')!;
    catalog.register(added);
    const installer = new ModelInstaller({ catalog, endpoint: () => source.endpoint, freeBytes: async () => 10 * 1024 ** 3, backoffMs: () => 5 });
    const detail = await installer.plan('custom-abc@audio-cpp');
    expect(detail.plan.components).toMatchObject([{ repo: 'audio-cpp-added/custom-abc', revision: voice.revision, action: 'download', files: ['q/v-q8.gguf'] }]);
    await installer.install(detail, { signal: new AbortController().signal });
    expect(source.requests.filter((r) => r.method === 'GET').every((r) => r.repo === voice.repo && r.revision === voice.revision)).toBe(true);
    expect(await fs.readFile(path.join(root, 'audio-cpp-added', 'custom-abc', 'q', 'v-q8.gguf'))).toEqual(content);
    expect(await catalog.status('custom-abc@audio-cpp')).toMatchObject({ state: 'installed' });

    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-inplace-'));
    try {
      const file = path.join(outside, 'mine.gguf');
      await fs.writeFile(file, Buffer.concat([Buffer.from('GGUF'), syntheticBytes(100, 4)]));
      catalog.register(localFileBundle({ family: 'qwen3_tts', path: file, size: 104, label: 'mine' }, 'custom-local@audio-cpp')!);
      expect((await installer.plan('custom-local@audio-cpp')).plan.upToDate).toBe(true);
      await installer.remove('custom-local@audio-cpp');
      await installer.discard('custom-local@audio-cpp');
      expect((await fs.stat(file)).size).toBe(104);
      expect(await catalog.status('custom-local@audio-cpp')).toMatchObject({ state: 'installed' });
      await fs.rm(file);
      await expect(installer.plan('custom-local@audio-cpp')).rejects.toMatchObject({ code: 'MODEL_MANIFEST_INCOMPLETE' });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

async function readdirSafe(dir: string): Promise<string[]> {
  return fs.readdir(dir).catch(() => []);
}
