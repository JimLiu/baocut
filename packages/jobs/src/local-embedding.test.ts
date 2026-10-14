import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EmbeddingError,
  MANIFEST_FILE,
  ModelCatalog,
  ProviderFailure,
  type BundleDefinition,
  type EmbeddingBundleProfile,
} from '@baocut/models';
import { FAKE_MODEL_WORKER } from './index.ts';
import { LocalEmbeddingProvider } from './local-embedding-provider.ts';
import { LocalTranscribeProvider, type LocalEmbedResult } from './local-provider.ts';

/**
 * 本机 embedding（EmbeddingGemma 2 检索集成方案 v0.1 §3.1、§5；Model Worker 协议规范 §2.5.6）：本地 Provider 的 `embed()` 在假的
 * Model Worker 里执行，`LocalEmbeddingProvider` 在它上面选模型包、加前缀、分批、截断与归一化、报错。模型包是测试用的，只带
 * `embedding` 组件（动态库这个发布页组件由 `@baocut/models` 的测试覆盖）。
 */

const PROFILE: EmbeddingBundleProfile = {
  variant: 'text-270m',
  quantGroup: 'q-test',
  modelFile: 'model.litertlm',
  modelSha256: 'a'.repeat(64),
  outputSize: 768,
  dims: 512,
  maxInputTokens: 2048,
  insertSpecialTokens: true,
  modalities: ['text'],
};
const bundle = (bundleId: string, repo: string, sha: string, extra: Partial<EmbeddingBundleProfile> = {}): BundleDefinition => ({
  bundleId,
  capability: 'embed',
  backend: 'litert-lm',
  device: 'cpu',
  label: bundleId,
  components: { embedding: { family: 'embeddinggemma2-litert', repo, revision: 'r1' } },
  embedding: { ...PROFILE, modelSha256: sha, ...extra },
});
const TEXT = bundle('emb-text@litert-lm', 'test/text', 'a'.repeat(64));
const FULL = bundle('emb-full@litert-lm', 'test/full', 'b'.repeat(64), {
  modalities: ['text', 'image'],
  vision: { tokensPerImage: 140, frameEdge: 512, frameFormat: 'jpeg' },
});

async function writeRepo(root: string, repo: string): Promise<void> {
  const dir = path.join(root, ...repo.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const content = `weights of ${repo}`;
  await fs.writeFile(path.join(dir, 'model.litertlm'), content);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  await fs.writeFile(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify({ format_version: 1, repo, revision: 'r1', files: [{ path: 'model.litertlm', size: content.length, sha256 }] }),
  );
}

const norm = (v: ArrayLike<number>) => Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0));
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).reduce((s, x, i) => s + x * b[i]!, 0);

describe('本机 embedding（假 Model Worker）', () => {
  let dir: string;
  let models: string;
  let controlFile: string;
  let recordFile: string;
  let loadsFile: string;
  let catalog: ModelCatalog;
  let worker: LocalTranscribeProvider;

  const control = (value: Record<string, unknown>) =>
    fs.writeFile(controlFile, JSON.stringify({ record: recordFile, loads: loadsFile, ...value }));
  const loads = async (): Promise<Array<Record<string, unknown>>> =>
    (await fs.readFile(loadsFile, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  const recorded = async (): Promise<Array<Record<string, unknown>>> =>
    (await fs.readFile(recordFile, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-local-embedding-'));
    controlFile = path.join(dir, 'control.json');
    recordFile = path.join(dir, 'runs.jsonl');
    loadsFile = path.join(dir, 'loads.jsonl');
    await control({ capabilities: ['embed'] });
    models = path.join(dir, 'models');
    await writeRepo(models, 'test/text');
    catalog = new ModelCatalog({ root: models, bundles: [TEXT, FULL] });
    worker = new LocalTranscribeProvider({
      catalog,
      command: () => ({ command: process.execPath, args: [FAKE_MODEL_WORKER, '--control', controlFile] }),
      env: async () => process.env,
      idleMs: 60_000,
    });
  });

  afterEach(async () => {
    await worker.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('embed.run：文本原样交给 Worker，向量解码成 outputSize 维、单位长度', async () => {
    const result = await worker.embed(TEXT.bundleId, ['hello world', '你好世界'], { outputSize: 768, insertSpecialTokens: true });
    expect(result).toMatchObject({ dims: 768, device: 'cpu', workerVersion: '0.0.0-fake' });
    expect(result.vectors).toHaveLength(2);
    for (const v of result.vectors) {
      expect(v).toHaveLength(768);
      expect(norm(v)).toBeCloseTo(1, 5);
    }
    const [run] = await recorded();
    expect(run).toMatchObject({ method: 'embed.run', texts: ['hello world', '你好世界'], outputSize: 768, insertSpecialTokens: true });
    expect(String(run!.requestId)).toMatch(/^embed-/);
    expect(await catalog.status(TEXT.bundleId)).toMatchObject({ state: 'ready' });
  });

  it('Worker 忙时排队：同时提交的几批都完成，不报 worker-busy', async () => {
    await control({ capabilities: ['embed'], faults: ['slow'] });
    const results = await Promise.all(
      ['a b c', 'd e f', 'g h i'].map((text) => worker.embed(TEXT.bundleId, [text], { outputSize: 768, insertSpecialTokens: true })),
    );
    expect(results.map((r) => r.vectors.length)).toEqual([1, 1, 1]);
    expect((await recorded()).map((r) => r.texts)).toEqual([['a b c'], ['d e f'], ['g h i']]);
  });

  it('排队时取消：不交给 Worker，抛出取消的原因', async () => {
    await control({ capabilities: ['embed'], faults: ['slow'] });
    const first = worker.embed(TEXT.bundleId, ['first one'], { outputSize: 768, insertSpecialTokens: true });
    const controller = new AbortController();
    const second = worker.embed(TEXT.bundleId, ['second one'], { outputSize: 768, insertSpecialTokens: true }, controller.signal);
    const reason = new Error('stop');
    setTimeout(() => controller.abort(reason), 20);
    await expect(second).rejects.toBe(reason);
    await first;
    expect((await recorded()).map((r) => r.texts)).toEqual([['first one']]);
  });

  it('Worker 不声明 embed：load-failed（capability-missing），不发 model.load，模型包不停用', async () => {
    await control({ capabilities: ['transcribe'] });
    const error = await worker.embed(TEXT.bundleId, ['x'], { outputSize: 768, insertSpecialTokens: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderFailure);
    expect(error).toMatchObject({ kind: 'load-failed', details: { reason: 'unsupported', detail: 'capability-missing', family: 'embeddinggemma2-litert' } });
    expect(catalog.blocked(TEXT.bundleId)).toBe(false);
  });

  it('超长：protocol，workerCode 是 INPUT_TOO_LONG，带是第几条', async () => {
    await control({ capabilities: ['embed'], faults: ['embed-too-long:1'] });
    const error = await worker.embed(TEXT.bundleId, ['ok', 'too long'], { outputSize: 768, insertSpecialTokens: true }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'protocol', details: { workerCode: 'INPUT_TOO_LONG', index: 1 } });
    // Worker 没退出，之后照常可用（只有一条时第 2 条的故障不触发）。
    const after = await worker.embed(TEXT.bundleId, ['ok'], { outputSize: 768, insertSpecialTokens: true });
    expect(after.vectors).toHaveLength(1);
  });

  it('图片：带 vision 重新加载一次，之后的文字也由它编码；多于 4 张直接拒绝', async () => {
    await writeRepo(models, 'test/full');
    catalog.changed(FULL.bundleId);
    const frames = path.join(dir, 'frames');
    await fs.mkdir(frames);
    await fs.writeFile(path.join(frames, 'a.jpg'), 'a red car on a bridge');
    const options = { outputSize: 768, insertSpecialTokens: true };
    await worker.embed(FULL.bundleId, ['text first'], options);
    const result = await worker.embed(FULL.bundleId, { images: [path.join(frames, 'a.jpg')] }, options);
    expect(result.vectors).toHaveLength(1);
    await worker.embed(FULL.bundleId, ['text after'], options);
    expect(await loads()).toEqual([
      { bundleId: FULL.bundleId, vision: null },
      { bundleId: FULL.bundleId, vision: { tokensPerImage: 140 } },
    ]);
    expect((await recorded()).map((r) => r.images ?? r.texts)).toEqual([['text first'], [path.join(frames, 'a.jpg')], ['text after']]);
    const missing = await worker.embed(FULL.bundleId, { images: [path.join(frames, 'gone.jpg')] }, options).catch((e: unknown) => e);
    expect(missing).toMatchObject({ kind: 'protocol', details: { workerCode: 'INPUT_UNREADABLE', index: 0 } });
    await expect(worker.embed(FULL.bundleId, { images: Array.from({ length: 5 }, () => path.join(frames, 'a.jpg')) }, options)).rejects.toBeInstanceOf(
      ProviderFailure,
    );
  });

  it('图片：模型包没有图像编码器时 load-failed（no-image-encoder），不反复重载', async () => {
    const frame = path.join(dir, 'a.jpg');
    await fs.writeFile(frame, 'x');
    const error = await worker.embed(TEXT.bundleId, { images: [frame] }, { outputSize: 768, insertSpecialTokens: true }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'load-failed', details: { reason: 'unsupported', detail: 'no-image-encoder' } });
    expect((await loads()).length).toBe(1);
  });

  it('批大小：0 条或超过 16 条直接拒绝，不起 Worker', async () => {
    for (const texts of [[], Array.from({ length: 17 }, (_, i) => `t${i}`)]) {
      await expect(worker.embed(TEXT.bundleId, texts, { outputSize: 768, insertSpecialTokens: true })).rejects.toBeInstanceOf(ProviderFailure);
    }
    expect(worker.workerPid(TEXT.bundleId)).toBeNull();
  });

  describe('LocalEmbeddingProvider', () => {
    it('profile：按已装好的文字包给出空间与编码实现的身份', async () => {
      const provider = new LocalEmbeddingProvider({ catalog, worker });
      const profile = await provider.profile('retrieval');
      expect(profile).toEqual({
        embeddingSpaceId: 'embeddinggemma2/text-270m/model-card-v1/512/l2/q-test',
        encoderProfileId: `embeddinggemma2/text-270m/model-card-v1/512/l2/q-test/text/vec-v1/${'a'.repeat(64)}/cpu`,
        promptPairId: 'model-card-v1',
        dims: 512,
        maxInputTokens: 2048,
        device: null,
      });
      expect(provider.current()).toEqual({ bundleId: TEXT.bundleId, label: TEXT.label });
      // 只装了文字包：画面没有能用的模型包（不是「通道关了」）。
      const visual = await provider.profile('text-to-visual').catch((e: unknown) => e);
      expect(visual).toMatchObject({ reason: 'MODEL_NOT_INSTALLED' });
      expect((visual as Error).message).toContain('740M');
      expect(provider.current()).toEqual({ bundleId: TEXT.bundleId, label: TEXT.label });
    });

    it('text-to-visual：只用有图像编码器的包，身份带模态与关键帧取法；图片只收缓存目录里的', async () => {
      await writeRepo(models, 'test/full');
      catalog.changed(FULL.bundleId);
      const frames = path.join(dir, 'cache', 'media');
      await fs.mkdir(frames, { recursive: true });
      await fs.writeFile(path.join(frames, 'car.jpg'), 'a red car driving over a bridge');
      await fs.writeFile(path.join(frames, 'desk.jpg'), 'a laptop and coffee cup on a desk');
      const provider = new LocalEmbeddingProvider({ catalog, worker, selected: () => TEXT.bundleId, imageRoots: [frames] });
      const text = await provider.profile('retrieval');
      const visual = await provider.profile('text-to-visual');
      expect(visual.embeddingSpaceId).toBe(text.embeddingSpaceId);
      expect(visual.encoderProfileId).toBe(
        `embeddinggemma2/text-270m/model-card-v1/512/l2/q-test/image/vec-v1/${'b'.repeat(64)}/cpu/vt140/keyframe-512-jpeg`,
      );
      expect(visual.frames).toEqual({ edge: 512, format: 'jpeg', maxBatch: 4 });
      expect(text.frames).toBeUndefined();
      expect(provider.current()).toEqual({ bundleId: TEXT.bundleId, label: TEXT.label });

      const images = await provider.embedImages({ images: [path.join(frames, 'car.jpg'), path.join(frames, 'desk.jpg')] });
      expect(images.vectors.map((v) => v.length)).toEqual([512, 512]);
      expect(images.payloadDigests).toHaveLength(2);
      const query = await provider.embed('text-to-visual', { role: 'query', inputs: [{ text: 'red car driving over a bridge' }] });
      expect(dot(query.vectors[0]!, images.vectors[0]!)).toBeGreaterThan(dot(query.vectors[0]!, images.vectors[1]!));
      expect((await loads()).map((l) => l.bundleId)).toEqual([FULL.bundleId]);

      const outside = path.join(dir, 'elsewhere.jpg');
      await fs.writeFile(outside, 'x');
      await expect(provider.embedImages({ images: [outside] })).rejects.toMatchObject({ reason: 'SOURCE_MISSING' });
      await expect(provider.embedImages({ images: [path.join(frames, 'gone.jpg')] })).rejects.toMatchObject({ reason: 'SOURCE_MISSING' });
    });

    it('选模型包：用户选的装好了用它，没装好按登记次序用装好的；一个都没装是 MODEL_NOT_INSTALLED', async () => {
      await writeRepo(models, 'test/full');
      catalog.changed(FULL.bundleId);
      let selected: string | null = FULL.bundleId;
      const provider = new LocalEmbeddingProvider({ catalog, worker, selected: () => selected });
      expect((await provider.profile('retrieval')).encoderProfileId).toContain('b'.repeat(64));
      selected = 'nope';
      expect((await provider.profile('retrieval')).encoderProfileId).toContain('a'.repeat(64));
      const empty = new LocalEmbeddingProvider({ catalog: new ModelCatalog({ root: path.join(dir, 'empty'), bundles: [TEXT, FULL] }), worker });
      const error = await empty.profile('retrieval').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error).toMatchObject({ reason: 'MODEL_NOT_INSTALLED' });
      expect(empty.current()).toBeNull();
    });

    it('embed：前缀只加一次、按 16 条分批、截到 512 维并归一化、payload 摘要一一对应；相近的文字余弦高', async () => {
      const provider = new LocalEmbeddingProvider({ catalog, worker });
      const inputs = Array.from({ length: 20 }, (_, i) => ({ text: `第 ${i} 句：我们最后选了这个模型` }));
      const docs = await provider.embed('retrieval', { role: 'document', inputs });
      expect(docs.vectors).toHaveLength(20);
      expect(docs.payloadDigests).toHaveLength(20);
      for (const v of docs.vectors) {
        expect(v).toHaveLength(512);
        expect(norm(v)).toBeCloseTo(1, 5);
      }
      const runs = await recorded();
      expect(runs.map((r) => (r.texts as string[]).length)).toEqual([16, 4]);
      expect((runs[0]!.texts as string[])[0]).toBe('title: none | text: 第 0 句：我们最后选了这个模型');
      const query = await provider.embed('retrieval', { role: 'query', inputs: [{ text: '我们最后选了这个模型' }] });
      expect((await recorded()).at(-1)!.texts).toEqual(['task: search result | query: 我们最后选了这个模型']);
      const other = await provider.embed('retrieval', { role: 'document', inputs: [{ text: 'completely unrelated words here' }] });
      expect(dot(query.vectors[0]!, docs.vectors[0]!)).toBeGreaterThan(dot(query.vectors[0]!, other.vectors[0]!));
      expect((await provider.profile('retrieval')).device).toBe('cpu');
    });

    it('超长：INPUT_TOO_LONG，第几条按整个请求数（从 1 数），不截断', async () => {
      await control({ capabilities: ['embed'], faults: ['embed-too-long:2'] });
      const provider = new LocalEmbeddingProvider({ catalog, worker });
      const error = await provider
        .embed('retrieval', { role: 'document', inputs: [{ text: 'a b' }, { text: 'c d' }, { text: 'e f' }] })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error).toMatchObject({ reason: 'INPUT_TOO_LONG' });
      expect((error as Error).message).toContain('3');
      // 超过 Worker 单条上限的不交给 Worker。
      const huge = await provider.embed('retrieval', { role: 'query', inputs: [{ text: 'x'.repeat(300 * 1024) }] }).catch((e: unknown) => e);
      expect(huge).toMatchObject({ reason: 'INPUT_TOO_LONG' });
    });
  });
});

describe('LocalEmbeddingProvider 的错误换算', () => {
  const catalog = {
    definitions: () => [TEXT],
    status: async () => ({ state: 'installed' }) as never,
  };
  const failing = (failure: unknown) =>
    new LocalEmbeddingProvider({
      catalog,
      worker: { embed: async (): Promise<LocalEmbedResult> => Promise.reject(failure) },
    });
  const reasonOf = (failure: unknown) =>
    failing(failure)
      .embed('retrieval', { role: 'query', inputs: [{ text: 'q' }] })
      .then(
        () => null,
        (e: { reason?: string }) => e.reason ?? e,
      );

  it('加载失败、资源不足、停用、崩溃各对应一个 SemanticReason；取消原样抛出', async () => {
    expect(await reasonOf(new ProviderFailure('load-failed', 'x', { reason: 'not-installed' }))).toBe('MODEL_NOT_INSTALLED');
    expect(await reasonOf(new ProviderFailure('load-failed', 'x', { reason: 'resource', workerCode: 'MODEL_RESOURCE' }))).toBe('RESOURCE_EXHAUSTED');
    expect(await reasonOf(new ProviderFailure('load-failed', 'x', { reason: 'unsupported' }))).toBe('MODEL_UNAVAILABLE');
    expect(await reasonOf(new ProviderFailure('unavailable', 'x', { reason: 'resource' }))).toBe('MODEL_UNAVAILABLE');
    expect(await reasonOf(new ProviderFailure('crashed', 'x'))).toBe('MODEL_UNAVAILABLE');
    const abort = new DOMException('aborted', 'AbortError');
    expect(await reasonOf(abort)).toBe(abort);
  });

  it('第二批里的超长条目按整个请求的序号报', async () => {
    let calls = 0;
    const provider = new LocalEmbeddingProvider({
      catalog,
      worker: {
        embed: async (_bundleId, input): Promise<LocalEmbedResult> => {
          const texts = input as readonly string[];
          calls += 1;
          if (calls === 2) throw new ProviderFailure('protocol', 'x', { workerCode: 'INPUT_TOO_LONG', index: 1 });
          return { vectors: texts.map(() => Float32Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0))), dims: 768, device: 'cpu', elapsedMs: 1, workerVersion: 'w' };
        },
      },
    });
    const inputs = Array.from({ length: 20 }, (_, i) => ({ text: `t${i}` }));
    const error = await provider.embed('retrieval', { role: 'document', inputs }).catch((e: unknown) => e);
    expect(error).toMatchObject({ reason: 'INPUT_TOO_LONG' });
    // 第 2 批（从第 17 条起）的第 2 条：整个请求的第 18 条。
    expect((error as Error).message).toContain('18');
  });
});
