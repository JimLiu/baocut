import { describe, expect, it } from 'vitest';
import type { ImageModelInfo } from '@baocut/protocol';
import {
  canvasAspect,
  editorImageRequest,
  editorSpeechRequest,
  effectiveImageDraft,
  fittedAspect,
  outputAsset,
  speechAssetName,
  ttsStage,
  videoGenerationJobs,
  withVideo,
  type EditorImageDraft,
} from './media-generation.ts';
import { imageModel, speechModel } from './models-test-fixtures.ts';
import { aspectOptions, BLANK_IMAGE, retryRequest, type ImageOption } from './tools-image.ts';
import { AUDIO_OUT, imageJob, imageOut, toolJob } from './tools-test-fixtures.ts';
import { BLANK_TTS, type SpeechOption } from './tools-tts.ts';

const speech: SpeechOption = {
  key: 'openai/gpt-4o-mini-tts',
  providerId: 'openai',
  provider: 'OpenAI',
  modelId: 'gpt-4o-mini-tts',
  label: 'gpt-4o-mini-tts',
  connected: true,
  usable: true,
  why: null,
  info: speechModel('gpt-4o-mini-tts', ['alloy', 'echo']),
};

const ratios = imageModel('gpt-image-1', {
  aspectRatios: [
    { ratio: '1:1', size: '1024x1024' },
    { ratio: '3:2', size: '1536x1024' },
    { ratio: '2:3', size: '1024x1536' },
  ],
  sizes: ['1024x1024', '1536x1024', '1024x1536'],
  defaultSize: '1024x1024',
  maxCount: 4,
});

function imageOption(info: ImageModelInfo): ImageOption {
  return {
    key: `openai/${info.modelId}`,
    providerId: 'openai',
    provider: 'OpenAI',
    modelId: info.modelId,
    label: info.label,
    connected: true,
    usable: true,
    why: null,
    info,
  };
}

const LANDSCAPE = { width: 1920, height: 1080 };
const PORTRAIT = { width: 1080, height: 1920 };
const SQUARE = { width: 1080, height: 1080 };

describe('请求带上视频', () => {
  it('语音：带 videoId 与素材名（文字开头 24 字）', () => {
    const req = editorSpeechRequest(
      { ...BLANK_TTS, text: '  欢迎使用 BaoCut！\n转录、翻译、配音、剪辑，全都在你自己的电脑上完成。 ', voice: 'preset:echo' },
      speech,
      'v1',
    );
    expect(req).toMatchObject({ videoId: 'v1', provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'echo' });
    expect(req.name).toBe('语音：欢迎使用 BaoCut！ 转录、翻译、配音、剪辑…');
    expect(speechAssetName('你好')).toBe('语音：你好');
  });

  it('我的声音照合同原样交 library:<id>', () => {
    expect(editorSpeechRequest({ ...BLANK_TTS, text: '你好', voice: 'library:v9' }, speech, 'v1').voice).toBe('library:v9');
  });

  it('图片：带 videoId；「跟视频画布」按画布取最接近的画幅', () => {
    const draft: EditorImageDraft = { ...BLANK_IMAGE, prompt: '一只纸鹤', size: '2:3', fit: true };
    expect(editorImageRequest(draft, imageOption(ratios), 'v1', LANDSCAPE)).toMatchObject({ videoId: 'v1', size: '3:2', prompt: '一只纸鹤' });
    expect(editorImageRequest({ ...draft, fit: false }, imageOption(ratios), 'v1', LANDSCAPE).size).toBe('2:3');
  });

  it('重试补回 videoId；参数不全时照旧 null', () => {
    expect(withVideo(retryRequest(imageJob()), 'v1')).toMatchObject({ prompt: '水墨风格的山间小路', videoId: 'v1' });
    expect(withVideo(null, 'v1')).toBeNull();
  });
});

describe('跟视频画布', () => {
  it('横、竖、方三种画布各落到最接近的一档', () => {
    const options = aspectOptions(ratios);
    expect(canvasAspect(LANDSCAPE, options)?.key).toBe('3:2');
    expect(canvasAspect(PORTRAIT, options)?.key).toBe('2:3');
    expect(canvasAspect(SQUARE, options)?.key).toBe('1:1');
  });

  it('16:9 / 9:16 有就取原样；只列尺寸的模型按尺寸的比例算', () => {
    const wide = imageModel('w', { aspectRatios: ['16:9', '9:16', '1:1', '4:3'].map((ratio) => ({ ratio, size: '1024x1024' })) });
    expect(fittedAspect(wide, LANDSCAPE)?.key).toBe('16:9');
    expect(fittedAspect(wide, PORTRAIT)?.key).toBe('9:16');
    const sizes = imageModel('dall-e', { sizes: ['1024x1024', '1792x1024', '1024x1792'] });
    expect(fittedAspect(sizes, LANDSCAPE)?.key).toBe('1792x1024');
  });

  it('模型不让选尺寸、画布没有大小时没有这一档，草稿原样', () => {
    const fixed = imageModel('fixed', { sizes: [], aspectRatios: [] });
    expect(fittedAspect(fixed, LANDSCAPE)).toBeNull();
    expect(canvasAspect({ width: 0, height: 0 }, aspectOptions(ratios))).toBeNull();
    const draft: EditorImageDraft = { ...BLANK_IMAGE, size: null, fit: true };
    expect(effectiveImageDraft(draft, fixed, LANDSCAPE).size).toBeNull();
  });
});

describe('视频里的生成记录', () => {
  it('只要这个视频、这一类，新的在前，藏起来的不列；不限提交者', () => {
    const jobs = [
      imageJob({ jobId: 'a', videoId: 'v1', createdAt: '2026-10-03T00:00:00.000Z' }),
      imageJob({ jobId: 'b', videoId: 'v1', createdAt: '2026-10-03T00:05:00.000Z', submitter: { kind: 'agent', id: 's1', taskId: 't1' } }),
      imageJob({ jobId: 'c', videoId: 'v2' }),
      imageJob({ jobId: 'd', videoId: null }),
      toolJob({ jobId: 'e', videoId: 'v1' }),
      imageJob({ jobId: 'f', videoId: 'v1' }),
    ];
    expect(videoGenerationJobs(jobs, 'v1', 'generateImage', ['f']).map((j) => j.jobId)).toEqual(['b', 'a']);
    expect(videoGenerationJobs(jobs, 'v1', 'synthesizeSpeech', []).map((j) => j.jobId)).toEqual(['e']);
  });

  it('结果导入成的素材', () => {
    const job = imageJob({ state: 'completed', result: { outputs: [{ ...imageOut('sha256:1'), assetId: 'as_1' }, imageOut('sha256:2')] } as never });
    expect(outputAsset(job, 'sha256:1')).toBe('as_1');
    expect(outputAsset(job, 'sha256:2')).toBeNull();
    expect(outputAsset(job, 'sha256:x')).toBeNull();
  });

  it('生成语音子页的阶段', () => {
    expect(ttsStage(null, null)).toBe('setup');
    expect(ttsStage('job_1', null)).toBe('run');
    expect(ttsStage('job_1', toolJob({ state: 'queued' }))).toBe('run');
    expect(ttsStage('job_1', toolJob({ state: 'interrupted', endedAt: null }))).toBe('run');
    expect(ttsStage('job_1', toolJob({ state: 'completed', result: { outputs: [AUDIO_OUT] } as never }))).toBe('done');
    expect(ttsStage('job_1', toolJob({ state: 'failed', endedAt: '2026-10-03T00:00:03.000Z' }))).toBe('failed');
    expect(ttsStage('job_1', toolJob({ state: 'needs-reconciliation', endedAt: '2026-10-03T00:00:03.000Z' }))).toBe('failed');
    expect(ttsStage('job_1', toolJob({ state: 'cancelled', endedAt: '2026-10-03T00:00:03.000Z' }))).toBe('setup');
  });
});
