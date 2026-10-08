import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type GenerateTextRequest, type JobRecord, type TextModelInfo } from '@baocut/protocol';
import {
  ModelCatalog,
  ProviderFailure,
  TextJobGenerator,
  TextRunner,
  type GenerationCapability,
  type GenerationSelection,
  type TextProvider,
  type TextReply,
  type TextRun,
} from '@baocut/models';
import { JobManager, type JobVideos, type TranscribeRouter } from './job-manager.ts';

/**
 * 文本生成任务在 JobManager 里的生命周期（架构设计 §6.4、§7.9）：冻结参数、执行（经共用的 `TextRunner`）、
 * 校验、发布为产物、结果的预览与警告，以及各种失败。Provider 是假的；真实的适配器在 providers 与 runtime-core 的测试里。
 */

const MODEL: TextModelInfo = {
  modelId: 'writer',
  label: 'Writer',
  default: true,
  contextTokens: 1000,
  maxOutputTokens: 500,
  efforts: ['low', 'medium', 'high'],
  defaultEffort: 'medium',
  structuredOutput: true,
  acceptsTemperature: false,
  acceptsSeed: false,
  cost: 'unknown',
};

const SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
  required: ['title'],
  additionalProperties: false,
};

class FakeText implements TextProvider {
  readonly id = 'fake';
  readonly runs: TextRun[] = [];
  next: (run: TextRun, signal: AbortSignal) => Promise<Omit<TextReply, 'workerVersion'>> = async () => ({
    text: 'Hello.',
    finishReason: 'stop',
    usage: { inputTokens: 3, outputTokens: 2 },
    modelVersion: 'writer-2026-09',
  });

  async generateText(run: TextRun, signal: AbortSignal): Promise<TextReply> {
    this.runs.push(run);
    return { ...(await this.next(run, signal)), workerVersion: 'fake-text@1' };
  }
}

const videos: JobVideos = {
  retain() {},
  release() {},
  async source(): Promise<never> {
    throw new RpcError('not-found', '没有素材');
  },
  current: () => null,
  videoRevision: () => null,
  async apply(): Promise<never> {
    throw new Error('文本生成不导入视频');
  },
};

describe('文本生成任务（JobManager）', () => {
  let dir: string;
  let paths: { jobsFile: string; stagingDir: string; artifactsDir: string; diagnosticsDir: string };
  let text: FakeText;
  let runner: TextRunner;
  let manager: JobManager;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-text-jobs-'));
    paths = {
      jobsFile: path.join(dir, 'store', 'jobs.json'),
      stagingDir: path.join(dir, 'staging'),
      artifactsDir: path.join(dir, 'artifacts'),
      diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
    };
    text = new FakeText();
    runner = new TextRunner({ concurrency: () => 4 });
    const generator = new TextJobGenerator(runner, text);
    const router: TranscribeRouter = {
      selectTranscribe: async () => {
        throw new Error('不用');
      },
      transcriber: () => null,
      executors: () => [],
      selectGeneration: async <C extends GenerationCapability>(capability: C) =>
        ({
          capability,
          providerId: 'fake',
          modelId: 'writer',
          kind: 'online',
          label: 'Fake',
          source: 'user-default',
          model: MODEL,
          generator,
          queue: { key: 'fake:generateText', concurrency: 4 },
          textDefaults: { effort: 'minimal', concurrency: 4 },
        }) as unknown as GenerationSelection<C>,
      generators: () => [generator],
    };
    manager = new JobManager({
      paths,
      catalog: new ModelCatalog({ root: path.join(dir, 'models'), bundles: [] }),
      router,
      videos,
      probe: async () => {
        throw new Error('文本不经 ffprobe');
      },
    });
    await manager.open();
  });

  afterEach(async () => {
    await manager.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function generate(request: Partial<GenerateTextRequest> = {}): Promise<JobRecord> {
    const { jobId } = await manager.submitGenerateText(
      { messages: [{ role: 'user', content: 'Say hello' }], ...request },
      { kind: 'connection', id: 'conn_1' },
    );
    await manager.settled(jobId);
    return manager.inspect(jobId);
  }

  async function artifact(job: JobRecord): Promise<string> {
    const file = await manager.artifacts.locate(job.result!.artifactId);
    expect(file).not.toBeNull();
    return fs.readFile(file!, 'utf8');
  }

  it('纯文本：发布为 .txt 产物，结果带预览、用量、模型版本与说明；冻结的参数记在任务里', async () => {
    const job = await generate({
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Say hello' },
      ],
    });
    expect(job).toMatchObject({
      state: 'completed',
      kind: 'generateText',
      videoId: null,
      providerId: 'fake',
      modelId: 'writer',
      warnings: [],
      generation: {
        capability: 'generateText',
        messages: [
          { role: 'system', content: 'Be terse.' },
          { role: 'user', content: 'Say hello' },
        ],
        responseFormat: { type: 'text' },
        maxOutputTokens: 500,
        temperature: null,
        // 能力参数的默认推理强度是 minimal，模型没有这一档：换成最接近的 low。
        requestedEffort: 'minimal',
        effort: 'low',
        seed: null,
      },
    });
    expect(job.result).toEqual({
      documentId: null,
      artifactId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      text: {
        mediaType: 'text/plain',
        byteLength: 6,
        length: 6,
        preview: 'Hello.',
        previewTruncated: false,
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 2 },
        modelVersion: 'writer-2026-09',
        notes: ['模型 writer 没有 minimal 这一档推理强度，改用 low'],
      },
    });
    expect(text.runs[0]!.parameters).toEqual(job.generation);
    const file = await manager.artifacts.locate(job.result!.artifactId);
    expect(path.extname(file!)).toBe('.txt');
    expect(await artifact(job)).toBe('Hello.');
    expect(runner.stats()).toEqual({ fake: { calls: 1, retries: 0, failures: 0 } });
  });

  it('给了保存位置：按最后一条用户消息开头取名写一份 .txt 副本，结果多一项带路径的文本输出', async () => {
    const saveDir = path.join(dir, 'saved');
    const job = await generate({
      messages: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'Write a haiku about rain' },
      ],
      saveDir,
    });
    expect(job.state).toBe('completed');
    const copy = path.join(saveDir, 'Write a haiku about rain.txt');
    expect(job.result!.outputs).toEqual([
      expect.objectContaining({ artifactId: job.result!.artifactId, mediaType: 'text/plain', assetId: null, path: copy }),
    ]);
    expect(await fs.readFile(copy, 'utf8')).toBe(await artifact(job));
    expect((await generate()).result!.outputs).toBeUndefined();
  });

  it('长输出：预览按码点截到 2000 个字符', async () => {
    const long = '😀'.repeat(2500);
    text.next = async () => ({ text: long, finishReason: 'stop', usage: null, modelVersion: null });
    const job = await generate();
    expect(job.result!.text).toMatchObject({ length: 2500, previewTruncated: true, byteLength: Buffer.byteLength(long) });
    expect([...job.result!.text!.preview]).toHaveLength(2000);
    expect(await artifact(job)).toBe(long);
  });

  it('纯文本被截断（length）：任务完成，带 output-truncated 警告', async () => {
    text.next = async () => ({ text: 'Hel', finishReason: 'length', usage: null, modelVersion: null });
    const job = await generate({ maxOutputTokens: 1 });
    expect(job.state).toBe('completed');
    expect(job.result!.text!.finishReason).toBe('length');
    expect(job.warnings).toEqual([expect.objectContaining({ code: 'output-truncated' })]);
  });

  it('结构化输出：校验过的 JSON 发布为 .json 产物', async () => {
    text.next = async () => ({ text: '{"title":"Hi","tags":["a"]}', finishReason: 'stop', usage: null, modelVersion: null });
    const job = await generate({ responseFormat: { type: 'json', schema: SCHEMA, name: 'card' } });
    expect(job.state).toBe('completed');
    expect(job.result!.text!.mediaType).toBe('application/json');
    expect(JSON.parse(await artifact(job))).toEqual({ title: 'Hi', tags: ['a'] });
    expect(path.extname((await manager.artifacts.locate(job.result!.artifactId))!)).toBe('.json');
    expect(job.generation).toMatchObject({ responseFormat: { type: 'json', schema: SCHEMA, name: 'card' } });
  });

  it('结构化输出不合 schema、不是 JSON、被截断：MODEL_OUTPUT_INVALID，不发布', async () => {
    text.next = async () => ({ text: '{"title":3,"extra":1}', finishReason: 'stop', usage: null, modelVersion: null });
    let job = await generate({ responseFormat: { type: 'json', schema: SCHEMA } });
    expect(job).toMatchObject({ state: 'failed', result: null, error: { code: 'MODEL_OUTPUT_INVALID', details: { reason: 'schema' } } });
    expect((job.error!.details as { problems: string[] }).problems.length).toBeGreaterThan(0);

    text.next = async () => ({ text: 'not json', finishReason: 'stop', usage: null, modelVersion: null });
    job = await generate({ responseFormat: { type: 'json', schema: SCHEMA } });
    expect(job.error).toMatchObject({ code: 'MODEL_OUTPUT_INVALID', details: { reason: 'schema' } });

    text.next = async () => ({ text: '{"title":"x"}', finishReason: 'length', usage: null, modelVersion: null });
    job = await generate({ responseFormat: { type: 'json', schema: SCHEMA } });
    expect(job.error).toMatchObject({ code: 'MODEL_OUTPUT_INVALID', details: { reason: 'length' } });
    expect(await fs.readdir(paths.artifactsDir).catch(() => [])).toEqual([]);
    expect(runner.stats().fake).toEqual({ calls: 3, retries: 0, failures: 3 });
  });

  it('Provider 的拒绝：内容过滤、上下文过长、认证失败按封闭的错误码', async () => {
    text.next = async () => ({ text: '', finishReason: 'content-filter', usage: null, modelVersion: null });
    let job = await generate();
    expect(job.error).toMatchObject({ code: 'PROVIDER_REJECTED', details: { reason: 'content-filter', providerId: 'fake' } });

    text.next = async () => {
      throw new ProviderFailure('rejected', '太长', { code: 'INPUT_TOO_LONG', reason: 'context-length', status: 400 });
    };
    job = await generate();
    expect(job.error).toMatchObject({ code: 'INPUT_TOO_LONG', details: { reason: 'context-length' } });

    text.next = async () => {
      throw new ProviderFailure('unavailable-remote', '超时', { code: 'PROVIDER_UNAVAILABLE', reason: 'timeout', attempts: 3 });
    };
    job = await generate();
    expect(job.error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', details: { reason: 'timeout' } });
  });

  it('提交时检查：schema 编译不过、模型不接受的 temperature、超过上限的输出、空消息都拒绝', async () => {
    const submit = (request: Partial<GenerateTextRequest>) =>
      manager.submitGenerateText({ messages: [{ role: 'user', content: 'x' }], ...request }, { kind: 'connection', id: 'c' });
    await expect(submit({ responseFormat: { type: 'json', schema: { type: 'string' } } })).rejects.toMatchObject({
      code: 'invalid-request',
    });
    await expect(
      submit({ responseFormat: { type: 'json', schema: { type: 'object', properties: { a: { $ref: 'http://x/y' } } } } }),
    ).rejects.toMatchObject({
      code: 'invalid-request',
    });
    await expect(submit({ temperature: 0.5 })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(submit({ seed: 1 })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(submit({ maxOutputTokens: 501 })).rejects.toMatchObject({ code: 'invalid-request', details: { maxOutputTokens: 500 } });
    await expect(submit({ messages: [{ role: 'system', content: 'only system' }] })).rejects.toBeInstanceOf(RpcError);
    await expect(submit({ messages: [{ role: 'user', content: 'x'.repeat(8001) }] })).rejects.toMatchObject({
      details: { code: 'INPUT_TOO_LONG' },
    });
    expect(text.runs).toHaveLength(0);
  });

  it('同一个 commandId 只建一个任务', async () => {
    const submitter = { kind: 'connection' as const, id: 'conn_1' };
    const request = { messages: [{ role: 'user' as const, content: 'hi' }], commandId: 'cmd_text_1' };
    const [a, b] = await Promise.all([manager.submitGenerateText(request, submitter), manager.submitGenerateText(request, submitter)]);
    expect(a.jobId).toBe(b.jobId);
    await manager.settled(a.jobId);
    expect((await manager.submitGenerateText(request, submitter)).jobId).toBe(a.jobId);
    expect(text.runs).toHaveLength(1);
  });

  it('取消：中止在途的调用，任务 cancelled，不计失败', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    text.next = (_run, signal) =>
      new Promise((_resolve, reject) => {
        started();
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const { jobId } = await manager.submitGenerateText({ messages: [{ role: 'user', content: 'hi' }] }, { kind: 'connection', id: 'c' });
    await running;
    await manager.cancel(jobId);
    await manager.settled(jobId);
    expect(manager.inspect(jobId).state).toBe('cancelled');
    expect(runner.stats().fake).toEqual({ calls: 1, retries: 0, failures: 0 });
    expect(runner.active('fake')).toBe(0);
  });
});
