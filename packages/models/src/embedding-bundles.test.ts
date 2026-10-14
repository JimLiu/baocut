import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLES } from './bundle-registry.ts';
import {
  EMBEDDING_BUNDLES,
  EMBEDDING_WORKER_OVERHEAD_BYTES,
  EMBEDDINGGEMMA2_MULTIMODAL_BUNDLE,
  EMBEDDINGGEMMA2_TEXT_BUNDLE,
  LITERTLM_RUNTIME_COMPONENT,
  LITERTLM_RUNTIME_RELEASE,
} from './embedding-bundles.ts';
import { embeddingSelfTestTexts, embeddingSelfTestVerdict } from './embedding-self-test.ts';
import { MANIFEST_FILE, ModelCatalog } from './model-catalog.ts';
import { repoManifestFor } from './repo-manifests.ts';

/** 本机 embedding 的模型包登记、LiteRT-LM 动态库这个发布页组件在目录里的状态、交给 Worker 的描述与自检判定（协议规范 §4.5）。 */

const TEXT = EMBEDDING_BUNDLES[0]!;
const MULTIMODAL = EMBEDDING_BUNDLES[1]!;

describe('embedding 模型包的登记', () => {
  it('文字包在前、多模态包在后，都是 embed / litert-lm / cpu，第二个组件是共用的 LiteRT-LM 动态库', () => {
    expect(EMBEDDING_BUNDLES.map((b) => b.bundleId)).toEqual([EMBEDDINGGEMMA2_TEXT_BUNDLE, EMBEDDINGGEMMA2_MULTIMODAL_BUNDLE]);
    for (const def of EMBEDDING_BUNDLES) {
      expect(BUNDLES).toContain(def);
      expect(def).toMatchObject({ capability: 'embed', backend: 'litert-lm', device: 'cpu', license: { name: 'Apache-2.0', commercialUse: true } });
      expect(Object.keys(def.components)).toEqual(['embedding', 'litertlm-runtime']);
      expect(def.components['litertlm-runtime']).toBe(LITERTLM_RUNTIME_COMPONENT);
      expect(def.license!.summary).toBeTruthy();
      // 内置清单只有那一个 `.litertlm`，sha256 与登记的向量配置一致。
      const source = def.components.embedding!;
      const manifest = repoManifestFor(source.repo, source.revision)!;
      expect(manifest.files).toEqual([{ path: def.embedding!.modelFile, size: expect.any(Number), sha256: def.embedding!.modelSha256 }]);
      expect(manifest.estimatedBytes).toBe(manifest.files[0]!.size);
      expect(def.embedding).toMatchObject({ outputSize: 768, dims: 512, maxInputTokens: 2048, insertSpecialTokens: true });
    }
    // 只有多模态包能编码图片（G0 多模态评测的取法：每张 140 个视觉 token，长边 512 px 的 JPEG）。
    expect(TEXT.embedding!.modalities).toEqual(['text']);
    expect(TEXT.embedding!.vision).toBeUndefined();
    expect(MULTIMODAL.embedding!.modalities).toEqual(['text', 'image']);
    expect(MULTIMODAL.embedding!.vision).toEqual({ tokensPerImage: 140, frameEdge: 512, frameFormat: 'jpeg' });
    // 两个包的文字编码器实测逐位相同：同一个空间（变体与量化兼容组），模型文件不同。
    expect(MULTIMODAL.embedding!.variant).toBe(TEXT.embedding!.variant);
    expect(MULTIMODAL.embedding!.quantGroup).toBe(TEXT.embedding!.quantGroup);
    expect(MULTIMODAL.embedding!.modelSha256).not.toBe(TEXT.embedding!.modelSha256);
  });

  it('LiteRT-LM 只有 macOS 的通用 dylib：在 xcframework 的子目录里，是交给 Worker 的动态库', () => {
    expect(LITERTLM_RUNTIME_RELEASE).toMatchObject({ name: 'litertlm-runtime', version: '0.18.0', workerLibrary: true });
    expect(Object.keys(LITERTLM_RUNTIME_RELEASE.assets).sort()).toEqual(['darwin-arm64']);
    const asset = LITERTLM_RUNTIME_RELEASE.assets['darwin-arm64']!;
    expect(asset).toMatchObject({
      fileName: 'CLiteRTLM_mac.xcframework.zip',
      size: 45143303,
      sha256: '5f6ee68d95eeccb084c6e66d5ee47255e3020fa0fb29696dd0301ae26d6cfb4f',
      archive: { format: 'zip', root: 'CLiteRTLM_mac.xcframework/macos-arm64_x86_64' },
      executable: 'libCLiteRTLM_mac.dylib',
    });
    expect(LITERTLM_RUNTIME_COMPONENT).toMatchObject({ family: 'litertlm-runtime', repo: 'google-ai-edge/LiteRT-LM', revision: 'v0.18.0' });
  });
});

describe('embedding 模型包在目录里', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-embedding-bundles-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const writeModel = () => writeComponent(path.join(dir, ...TEXT.components.embedding!.repo.split('/')), TEXT.components.embedding!, { [TEXT.embedding!.modelFile]: 'weights' });
  const writeRuntime = () =>
    writeComponent(path.join(dir, '.bcut-tools', 'litertlm-runtime', '0.18.0'), LITERTLM_RUNTIME_COMPONENT, { 'libCLiteRTLM_mac.dylib': 'dylib' });

  it('权重与动态库都齐才 installed；交给 Worker 的描述带上动态库（发布页目录里的清单）与引擎缓存目录', async () => {
    const catalog = new ModelCatalog({ root: dir, platform: 'darwin', arch: 'arm64', engineCacheDir: path.join(dir, 'cache', 'litertlm') });
    expect(catalog.definitions().filter((d) => d.capability === 'embed').map((d) => d.bundleId)).toEqual([TEXT.bundleId, MULTIMODAL.bundleId]);
    expect(await catalog.status(TEXT.bundleId)).toMatchObject({ state: 'not-installed', backend: 'litert-lm' });
    await writeModel();
    catalog.changed(TEXT.bundleId);
    const incomplete = await catalog.status(TEXT.bundleId);
    expect(incomplete).toMatchObject({ state: 'not-installed', reason: 'incomplete' });
    expect(incomplete!.components![1]).toMatchObject({ component: 'litertlm-runtime', origin: 'github-release', state: 'missing' });
    // 只有 dylib、没有清单：不是旧版的装法，仍算没装。
    await fs.mkdir(path.join(dir, '.bcut-tools', 'litertlm-runtime', '0.18.0'), { recursive: true });
    await fs.writeFile(path.join(dir, '.bcut-tools', 'litertlm-runtime', '0.18.0', 'libCLiteRTLM_mac.dylib'), 'dylib');
    catalog.changed(TEXT.bundleId);
    expect(await catalog.status(TEXT.bundleId)).toMatchObject({ state: 'not-installed', reason: 'incomplete' });
    await writeRuntime();
    catalog.changed(TEXT.bundleId);
    expect(await catalog.status(TEXT.bundleId)).toMatchObject({ state: 'installed' });
    // 动态库不是 Runtime 执行的引擎。
    expect(catalog.engineExecutable(TEXT.bundleId)).toBeNull();
    const bundle = await catalog.bundleFor(TEXT.bundleId);
    expect(Object.keys(bundle.components)).toEqual(['embedding', 'litertlm-runtime']);
    expect(bundle.components['litertlm-runtime']).toMatchObject({
      family: 'litertlm-runtime',
      revision: 'v0.18.0',
      dir: path.join(dir, '.bcut-tools', 'litertlm-runtime', '0.18.0'),
      files: [{ path: 'libCLiteRTLM_mac.dylib', byteLength: 5 }],
    });
    expect(bundle.components.embedding).toMatchObject({ family: 'embeddinggemma2-litert', files: [{ path: TEXT.embedding!.modelFile }] });
    expect(bundle).toMatchObject({ backend: 'litert-lm', device: 'cpu', cacheDir: path.join(dir, 'cache', 'litertlm') });
    // 文字包没有图像编码器：要了 `vision` 也不带。
    expect(bundle.vision).toBeUndefined();
    expect((await catalog.bundleFor(TEXT.bundleId, { vision: true })).vision).toBeUndefined();
    // 内存：模型文件 + 动态库压缩包 + 余量，计在内存。
    const footprint = await catalog.workerFootprint(TEXT.bundleId);
    expect(footprint).toEqual({ pool: 'memory', bytes: 164626432 + 45143303 + EMBEDDING_WORKER_OVERHEAD_BYTES });
  });

  it('Windows 与 Linux 没有动态库：error / unsupported，说明是 LiteRT-LM 没有这个平台的版本，不是 audio.cpp 引擎', async () => {
    for (const [platform, arch] of [
      ['win32', 'x64'],
      ['linux', 'x64'],
    ] as const) {
      const catalog = new ModelCatalog({ root: dir, platform, arch });
      const status = await catalog.status(TEXT.bundleId);
      expect(status, platform).toMatchObject({ state: 'error', reason: 'unsupported' });
      expect(status!.detailRef).toEqual({ key: 'modelsEmbedding.runtimeNoBuild', params: { platform: `${platform}-${arch}` } });
      expect(status!.detail).toContain('LiteRT-LM');
    }
  });

  it('引擎覆盖（BAOCUT_AUDIOCPP_CLI）不替动态库', async () => {
    const fake = path.join(dir, 'audiocpp_cli');
    await fs.writeFile(fake, '#!/bin/sh\n');
    await writeModel();
    const catalog = new ModelCatalog({ root: dir, platform: 'darwin', arch: 'arm64', engineOverride: fake });
    expect(catalog.engineOverridden(LITERTLM_RUNTIME_COMPONENT)).toBe(false);
    expect(await catalog.status(TEXT.bundleId)).toMatchObject({ state: 'not-installed', reason: 'incomplete' });
  });
});

describe('embedding 自检判定', () => {
  const unit = (values: number[], dims = 4) => {
    const v = new Float32Array(dims);
    values.forEach((x, i) => (v[i] = x));
    const norm = Math.hypot(...v);
    return v.map((x) => x / norm);
  };

  it('三条固定文本按模型卡加前缀', () => {
    const texts = embeddingSelfTestTexts();
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatch(/^task: search result \| query: /);
    expect(texts[1]).toMatch(/^title: none \| text: /);
    expect(texts[2]).toMatch(/^title: none \| text: /);
  });

  it('相关文档比无关文档更像查询才通过；条数、维度、有限、单位长度不对时说明哪里不对', () => {
    const query = unit([1, 0.2, 0, 0]);
    const relevant = unit([1, 0.3, 0, 0]);
    const irrelevant = unit([0, 0, 1, 0]);
    expect(embeddingSelfTestVerdict([query, relevant, irrelevant], 4)).toMatchObject({ passed: true, facts: { dims: 4 } });
    const ref = (key: string, params?: Record<string, unknown>) => ({ passed: false, problemRef: { key: `modelsEmbedding.${key}`, ...(params ? { params } : {}) } });
    expect(embeddingSelfTestVerdict([query, irrelevant, relevant], 4)).toMatchObject(ref('notRanked'));
    expect(embeddingSelfTestVerdict([query, relevant], 4)).toMatchObject(ref('countMismatch', { expected: 3, actual: 2 }));
    expect(embeddingSelfTestVerdict([query, relevant, irrelevant], 8)).toMatchObject(ref('wrongDims', { expected: 8, actual: 4 }));
    expect(embeddingSelfTestVerdict([query, Float32Array.from([1, NaN, 0, 0]), irrelevant], 4)).toMatchObject(ref('notFinite'));
    expect(embeddingSelfTestVerdict([query, Float32Array.from([2, 0, 0, 0]), irrelevant], 4)).toMatchObject(ref('notNormalized', { norm: '2.0000' }));
  });
});

async function writeComponent(at: string, source: { repo: string; revision: string }, files: Record<string, string>): Promise<void> {
  await fs.mkdir(at, { recursive: true });
  const entries = [];
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(at, name), content);
    entries.push({ path: name, size: Buffer.byteLength(content), sha256: crypto.createHash('sha256').update(content).digest('hex') });
  }
  await fs.writeFile(
    path.join(at, MANIFEST_FILE),
    JSON.stringify({ format_version: 1, repo: source.repo, revision: source.revision, files: entries }),
  );
}
