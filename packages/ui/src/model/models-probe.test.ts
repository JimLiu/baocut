import { describe, expect, it } from 'vitest';
import type { GeneratedOutput, JobRecord } from '@baocut/protocol';
import {
  PROBE_IMAGE_PROMPT,
  probeSpeechText,
  PROBE_TEXT_PROMPT,
  imageProbeRequest,
  imageTryRequest,
  outputFacts,
  probeFromJob,
  probeNeedsVoice,
  probeSupported,
  probeVerdict,
  speechProbeRequest,
  textProbeFacts,
  textProbeRequest,
} from './models-probe.ts';
import { imageModel, speechModel, textModel } from './models-test-fixtures.ts';
import { textResult } from './tools-test-fixtures.ts';

const audio: GeneratedOutput = {
  artifactId: 'sha256:aa',
  mediaType: 'audio/mpeg',
  byteLength: 1000,
  assetId: null,
  media: { kind: 'audio', durationSec: 2.94, sampleRate: 24000, channels: 1 },
};
const picture: GeneratedOutput = {
  artifactId: 'sha256:bb',
  mediaType: 'image/png',
  byteLength: 1000,
  assetId: null,
  media: { kind: 'image', width: 1024, height: 1024 },
};

function job(patch: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job_1',
    kind: 'synthesizeSpeech',
    state: 'running',
    phase: 'generating',
    progress: null,
    videoId: null,
    assetId: null,
    assetRevision: null,
    contentHash: 'sha256:00',
    providerId: 'openai',
    modelId: 'gpt-4o-mini-tts',
    bundleId: null,
    inputHash: 'sha256:00',
    submitter: { kind: 'connection', id: 'c1' },
    attempt: 1,
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:02.000Z',
    startedAt: '2026-10-03T00:00:00.500Z',
    endedAt: null,
    error: null,
    result: null,
    warnings: [],
    ...patch,
  } as JobRecord;
}

describe('测试请求', () => {
  it('语音识别没有独立测试的接口', () => {
    expect(probeSupported('transcribe')).toBe(false);
    expect(probeSupported('synthesizeSpeech')).toBe(true);
    expect(probeSupported('generateImage')).toBe(true);
    expect(probeSupported('generateText')).toBe(true);
  });

  it('合成：用默认音色；没有任何音色的要用户给一个', () => {
    const model = speechModel('gpt-4o-mini-tts', ['alloy', 'echo']);
    expect(speechProbeRequest('openai', model)).toEqual({ text: probeSpeechText(), provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'alloy' });
    expect(speechProbeRequest('openai', model, ' echo ').voice).toBe('echo');
    const bare = speechModel('tts-1', []);
    expect(probeNeedsVoice(bare)).toBe(true);
    expect(probeNeedsVoice(model)).toBe(false);
    expect(speechProbeRequest('custom:box', bare)).not.toHaveProperty('voice');
  });

  it('生图：一张、不给尺寸（用模型的默认，Codex 不接受尺寸）', () => {
    expect(imageProbeRequest('agent:codex', imageModel('image-gen', { sizes: [], defaultSize: null }))).toEqual({
      prompt: PROBE_IMAGE_PROMPT,
      provider: 'agent:codex',
      model: 'image-gen',
      count: 1,
    });
  });

  it('本地试画：用户的提示词、一张 512 × 512、8 步，走本机 Provider', () => {
    expect(imageTryRequest('qwen-image-2.1@mlx-4bit', ' 一只纸鹤 ')).toEqual({
      prompt: '一只纸鹤',
      provider: 'local',
      model: 'qwen-image-2.1@mlx-4bit',
      size: '512x512',
      count: 1,
      steps: 8,
    });
  });
});

describe('测试文本生成', () => {
  it('一条 user 消息「Reply with OK.」，不给输出上限与推理强度', () => {
    expect(PROBE_TEXT_PROMPT).toBe('Reply with OK.');
    expect(textProbeRequest('openai', textModel('gpt-5-mini'))).toEqual({
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      provider: 'openai',
      model: 'gpt-5-mini',
    });
  });

  it('完成：取结果摘要，不要产物', () => {
    const text = textResult({ preview: 'OK', length: 2, usage: { inputTokens: 9, outputTokens: 1 } });
    const state = probeFromJob(
      'job_1',
      job({ kind: 'generateText', state: 'completed', endedAt: '2026-10-03T00:00:01.700Z', result: { documentId: null, artifactId: 'sha256:t', text } }),
    );
    expect(state).toEqual({ status: 'done', jobId: 'job_1', output: null, text, seconds: 1.2 });
    expect(probeFromJob('job_1', job({ kind: 'generateText', state: 'completed', result: { documentId: null, artifactId: 'sha256:t' } })).status).toBe(
      'failed',
    );
  });

  it('一行事实：字数、token、截断或被过滤', () => {
    expect(textProbeFacts(textResult({ length: 2, usage: { inputTokens: 9, outputTokens: 1 } }))).toBe('2 字 · 输入 9 token · 输出 1 token');
    expect(textProbeFacts(textResult({ length: 2, usage: null, finishReason: 'length' }))).toBe('2 字 · 到了输出上限');
    expect(textProbeFacts(textResult({ length: 0, usage: null, finishReason: 'content-filter' }))).toBe('0 字 · 被服务商的内容过滤拦下');
  });
});

describe('probeFromJob', () => {
  it('还没在主题里出现、排队或在跑时都算在跑', () => {
    expect(probeFromJob('job_1', undefined)).toEqual({ status: 'running', jobId: 'job_1' });
    expect(probeFromJob('job_1', job({ state: 'queued' })).status).toBe('running');
  });

  it('完成：取第一个输出与耗时', () => {
    const state = probeFromJob(
      'job_1',
      job({ state: 'completed', endedAt: '2026-10-03T00:00:02.340Z', result: { documentId: null, artifactId: 'sha256:aa', outputs: [audio] } }),
    );
    expect(state).toEqual({ status: 'done', jobId: 'job_1', output: audio, text: null, seconds: 1.8 });
  });

  it('完成却没有输出、失败、取消、中断都写成失败的一句话', () => {
    expect(probeFromJob('job_1', job({ state: 'completed', result: { documentId: null, artifactId: 'x' } })).status).toBe('failed');
    expect(probeFromJob('job_1', job({ state: 'failed', error: { code: 'PROVIDER_AUTH', message: '401 · 密钥无效' } }))).toEqual({
      status: 'failed',
      jobId: 'job_1',
      message: '401 · 密钥无效',
    });
    expect(probeFromJob('job_1', job({ state: 'cancelled' }))).toMatchObject({ status: 'failed', message: '任务已取消。' });
    expect(probeFromJob('job_1', job({ state: 'interrupted' })).status).toBe('failed');
  });
});

describe('结果与判词', () => {
  it('音频写时长与采样率，图片写像素', () => {
    expect(outputFacts(audio)).toBe('2.9 秒 · 24 kHz · MPEG');
    expect(outputFacts(picture)).toBe('1024 × 1024 · PNG');
  });

  it('判词', () => {
    expect(probeVerdict(undefined)).toEqual({ text: '尚未测试', tone: 'neutral' });
    expect(probeVerdict({ status: 'running', jobId: 'j' }).text).toBe('正在测试…');
    expect(probeVerdict({ status: 'done', jobId: 'j', output: audio, text: null, seconds: 1.8 })).toEqual({ text: '测试通过 · 1.8 秒', tone: 'positive' });
    expect(probeVerdict({ status: 'failed', message: '超时' })).toEqual({ text: '超时', tone: 'negative' });
  });
});
