import { describe, expect, it } from 'vitest';
import type { CapabilityNotConfiguredDetails } from '@baocut/protocol';
import { job, task } from '../testing/task-records.ts';
import { cancellationCost, fmtSize, imageRequest, jobOutputs, jobRemedy, rejectionRemedy, secs, taskFacts, took } from './task-facts.ts';
import { agentRow, jobRow, type TaskContext } from './task-list.ts';

const ctx: TaskContext = { projects: [], conversations: [] };
const NOW = Date.parse('2026-10-01T09:12:40Z');

describe('took / secs / fmtSize', () => {
  it('同原型的写法', () => {
    expect(took(42_000)).toBe('42s');
    expect(took(760_000)).toBe('12m 40s');
    expect(took(3_900_000)).toBe('1h 5m');
    expect(secs(12_000)).toBe('12 s');
    expect(secs(90_000)).toBe('1m 30s');
    expect(fmtSize(500 * 1024)).toBe('500 KB');
    expect(fmtSize(612 * 1024 * 1024)).toBe('612 MB');
    expect(fmtSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });
});

describe('taskFacts', () => {
  it('在跑的 Job：类型、发起方、状态、开始于、跑在、阶段、用时；没有数据的行不出', () => {
    const record = job({ jobId: 'j1', startedAt: '2026-10-01T09:00:00Z' });
    expect(taskFacts(jobRow(record, ctx), { job: record }, NOW)).toEqual([
      ['类型', '转录'],
      ['发起方', '命令行'],
      ['状态', '进行中'],
      ['开始于', '12 分钟前'],
      ['跑在', '本机'],
      ['阶段', '识别中'],
      ['用时', '12m 40s'],
    ]);
  });

  it('排队的 Job 不写用时；生图写图片张数；配音写语言', () => {
    const queued = job({ jobId: 'q', state: 'queued', phase: 'queued', startedAt: null, submitter: { kind: 'system', id: 'runtime' } });
    const facts = taskFacts(jobRow(queued, ctx), { job: queued }, NOW);
    expect(facts.find(([k]) => k === '用时')).toBeUndefined();
    expect(facts).toContainEqual(['发起方', 'App']);
    expect(facts).toContainEqual(['状态', '排队中']);

    const image = job({
      jobId: 'g',
      kind: 'generateImage',
      state: 'completed',
      phase: 'done',
      providerId: 'openai',
      submitter: { kind: 'agent', id: 'c1', taskId: 't1' },
      endedAt: '2026-10-01T09:00:41Z',
      generation: { capability: 'generateImage', prompt: 'p', size: null, aspectRatio: '9:16', count: 2, format: 'png', seed: null },
      result: { documentId: null, artifactId: 'art1', outputs: [] },
    });
    const imageFacts = taskFacts(jobRow(image, ctx), { job: image }, NOW);
    expect(imageFacts).toContainEqual(['发起方', 'Agent 会话']);
    expect(imageFacts).toContainEqual(['跑在', '云端']);
    expect(imageFacts).toContainEqual(['图片', '0/2']);
    expect(imageFacts).toContainEqual(['状态', '已完成']);
    expect(imageFacts).toContainEqual(['用时', '41s']);

    const speech = job({
      jobId: 's',
      kind: 'synthesizeSpeech',
      submitter: { kind: 'node', id: 'peer' },
      generation: { capability: 'synthesizeSpeech', text: 't', voice: 'v', language: 'zh', format: 'mp3', instructions: null, speed: null, seed: null },
    });
    const speechFacts = taskFacts(jobRow(speech, ctx), { job: speech }, NOW);
    expect(speechFacts).toContainEqual(['语言', 'zh']);
    expect(speechFacts).toContainEqual(['发起方', '远端节点']);
  });

  it('Agent 任务：等批准照 chip 念，正在停止照 chip 念，结束了的按结束时间算用时', () => {
    const waiting = agentRow(task({ taskId: 't', conversationId: 'c2' }), { projects: [], conversations: [{ id: 'c2', projectId: null, activity: 'awaiting-approval' }] });
    expect(taskFacts(waiting, {}, NOW)).toContainEqual(['状态', '需要你确认']);
    const stopping = agentRow(task({ taskId: 't', status: 'stopping' }), ctx);
    expect(taskFacts(stopping, {}, NOW)).toContainEqual(['状态', '正在停止']);
    const done = agentRow(task({ taskId: 't', status: 'completed', endedAt: '2026-10-01T09:00:42Z' }), ctx);
    expect(taskFacts(done, {}, NOW)).toEqual([
      ['类型', 'Agent 任务'],
      ['发起方', 'Agent 会话'],
      ['状态', '已完成'],
      ['开始于', '12 分钟前'],
      ['用时', '42s'],
    ]);
  });
});

describe('jobRemedy', () => {
  const notConfigured = (remedy: CapabilityNotConfiguredDetails['remedy'], providerId?: string): CapabilityNotConfiguredDetails => ({
    code: 'CAPABILITY_NOT_CONFIGURED',
    capability: remedy.capability,
    reason: 'not-installed',
    ...(providerId ? { providerId } : {}),
    remedy,
  });
  const failed = (details: unknown, code = 'CAPABILITY_NOT_CONFIGURED', patch = {}) =>
    job({ jobId: 'f', state: 'failed', error: { code, message: 'x', details }, ...patch });

  it('CAPABILITY_NOT_CONFIGURED 按 remedy.action 去模型页的对应类与页，提示用它自己的', () => {
    const install = jobRemedy(failed(notConfigured({ action: 'install-model', capability: 'transcribe', hint: '装一个本地模型' })));
    expect(install).toEqual({ label: '去补装组件', target: { tab: 'models', category: 'asr', page: 'local' }, hint: '装一个本地模型' });
    expect(jobRemedy(failed(notConfigured({ action: 'configure-provider', capability: 'generateImage', hint: 'h' })))?.target).toEqual({
      tab: 'models',
      category: 'image',
      page: 'cloud',
    });
    expect(jobRemedy(failed(notConfigured({ action: 'set-default', capability: 'synthesizeSpeech', hint: 'h' })))?.target).toEqual({
      tab: 'models',
      category: 'tts',
    });
    expect(jobRemedy(failed(notConfigured({ action: 'pair-node', capability: 'transcribe', hint: 'h' })))?.target).toEqual({ tab: 'services', service: 'remote' });
    expect(jobRemedy(failed(notConfigured({ action: 'setup-agent', capability: 'generateImage', hint: 'h' })))?.target).toEqual({
      tab: 'settings',
      section: 'agent',
    });
    expect(
      jobRemedy(failed(notConfigured({ action: 'enable-provider', capability: 'generateImage', providerId: 'agent:codex', hint: 'h' })))?.target,
    ).toEqual({ tab: 'settings', section: 'agent' });
  });

  it('按错误码兜底：凭据去云端模型，本地模型包去本地模型；别的错误不给去处', () => {
    expect(jobRemedy(failed(undefined, 'PROVIDER_AUTH_FAILED', { providerId: 'openai' }))?.target).toEqual({
      tab: 'models',
      category: 'asr',
      page: 'cloud',
    });
    expect(jobRemedy(failed(undefined, 'MODEL_LOAD_FAILED'))?.target).toEqual({ tab: 'models', category: 'asr', page: 'local' });
    expect(jobRemedy(failed(undefined, 'MODEL_LOAD_FAILED', { providerId: 'node:x' }))).toBeNull();
    expect(jobRemedy(failed(undefined, 'STALE_JOB_INPUT'))).toBeNull();
    expect(jobRemedy(job({ jobId: 'ok' }))).toBeNull();
  });
});

describe('rejectionRemedy', () => {
  it('提交时被拒、details 带 CAPABILITY_NOT_CONFIGURED：按 remedy 给去处与提示', () => {
    const error = Object.assign(new Error('没有配置'), {
      details: {
        code: 'CAPABILITY_NOT_CONFIGURED',
        capability: 'synthesizeSpeech',
        reason: 'missing-credential',
        providerId: 'openai',
        remedy: { action: 'configure-provider', capability: 'synthesizeSpeech', providerId: 'openai', hint: '填一把密钥' },
      },
    });
    expect(rejectionRemedy('synthesizeSpeech', error)).toEqual({
      label: '去设置云端模型',
      target: { tab: 'models', category: 'tts', page: 'cloud' },
      hint: '填一把密钥',
    });
  });

  it('别的拒绝没有去处', () => {
    expect(rejectionRemedy('generateImage', new Error('busy'))).toBeNull();
    expect(rejectionRemedy('generateImage', Object.assign(new Error('x'), { details: { code: 'GRANT_REQUIRED' } }))).toBeNull();
  });
});

describe('cancellationCost', () => {
  it('没有外发的不写；不支持取消、不知道发没发、已拿到结果分开说', () => {
    expect(cancellationCost({ remote: 'not-submitted', cost: 'none' })).toBeNull();
    expect(cancellationCost({ remote: 'cancel-unsupported', cost: 'possible' })).toContain('服务商不支持取消');
    expect(cancellationCost({ remote: 'unknown', cost: 'possible' })).toContain('不确定请求有没有发出');
    expect(cancellationCost({ remote: 'cancelled', cost: 'possible' })).toBe('可能已经计费');
    expect(cancellationCost({ remote: 'cancelled', cost: 'charged' })).toContain('计费');
  });

  it('详情表里有「费用」一行', () => {
    const cancelled = job({
      jobId: 'c',
      state: 'cancelled',
      cancellation: { requestedAt: '2026-10-01T09:00:00Z', localStoppedAt: null, remote: 'cancel-unsupported', cost: 'possible' },
    });
    expect(taskFacts(jobRow(cancelled, ctx), { job: cancelled }, NOW).find(([label]) => label === '费用')?.[1]).toContain('服务商不支持取消');
  });
});

describe('jobOutputs / imageRequest', () => {
  it('生成任务每个输出一行；转录只说文稿写进了视频；没有结果时为空', () => {
    const outputs = jobOutputs({
      result: {
        documentId: null,
        artifactId: 'a1',
        outputs: [
          { artifactId: 'a1', mediaType: 'image/png', byteLength: 2 * 1024 * 1024, assetId: 'as1', media: { kind: 'image', width: 768, height: 1344 } },
          { artifactId: 'a2', mediaType: 'audio/mpeg', byteLength: 300 * 1024, assetId: null, media: { kind: 'audio', durationSec: 12.4, sampleRate: 48000, channels: 1 } },
        ],
      },
    });
    expect(outputs.map((o) => [o.name, o.meta, o.artifactId, o.imported])).toEqual([
      ['图片 1', '768×1344 · 2 MB', 'a1', true],
      ['语音 2', '0:12 · 48 kHz · 300 KB', 'a2', false],
    ]);
    expect(jobOutputs({ result: { documentId: 'd1', artifactId: 'raw' } }).map((o) => [o.name, o.meta, o.artifactId])).toEqual([
      ['文稿', '文稿已写进视频', null],
    ]);
    expect(jobOutputs({ result: null })).toEqual([]);
  });

  it('导出写到磁盘上的文件：名字取实际路径（含重名序号），带路径给「在文件夹中显示」', () => {
    const outputs = jobOutputs({
      result: {
        documentId: null,
        artifactId: 'a1',
        outputs: [
          {
            artifactId: 'a1',
            mediaType: 'video/mp4',
            byteLength: 84 * 1024 * 1024,
            assetId: null,
            path: '/p/exports/访谈 (2).mp4',
            media: { kind: 'video', durationSec: 206, width: 1920, height: 1080, videoCodec: 'h264', audioCodec: 'aac' },
          },
          { artifactId: 'a2', mediaType: 'audio/mpeg', byteLength: 300 * 1024, assetId: null, path: '/p/exports/访谈.audio.mp3', media: { kind: 'audio', durationSec: 12.4, sampleRate: 48000, channels: 2 } },
        ],
      },
    });
    expect(outputs.map((o) => [o.name, o.path])).toEqual([
      ['访谈 (2).mp4', '/p/exports/访谈 (2).mp4'],
      ['访谈.audio.mp3', '/p/exports/访谈.audio.mp3'],
    ]);
  });

  it('便携包不在产物库里：不给「打开」，只给「在文件夹中显示」', () => {
    const [row] = jobOutputs({
      result: {
        documentId: null,
        artifactId: 'sha256:pkg',
        outputs: [
          {
            artifactId: 'sha256:pkg',
            mediaType: 'application/zip',
            byteLength: 2048,
            assetId: null,
            path: '/p/exports/访谈.baocut',
            media: { kind: 'package', files: 5, assets: 2, missingAssets: 0, documents: 1 },
          },
        ],
      },
    });
    expect(row).toMatchObject({ key: 'sha256:pkg', name: '访谈.baocut', artifactId: null, path: '/p/exports/访谈.baocut' });
  });

  it('生图请求的元信息：模型 · 画幅 · 张数 · 用时', () => {
    const record = job({
      jobId: 'g',
      kind: 'generateImage',
      modelId: 'gpt-image-2',
      startedAt: '2026-10-01T09:12:28Z',
      generation: { capability: 'generateImage', prompt: '天台', size: null, aspectRatio: '9:16', count: 2, format: 'png', seed: null },
    });
    expect(imageRequest(record, NOW)).toEqual({ prompt: '天台', meta: 'gpt-image-2 · 9:16 · 2 张 · 12 s' });
    expect(imageRequest(job({ jobId: 't' }), NOW)).toBeNull();
  });
});
