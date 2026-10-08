import { describe, expect, it } from 'vitest';
import { fixtureView, transcribeModel } from './models-test-fixtures.ts';
import {
  baseName,
  initialTranscribe,
  isTranscribable,
  switchMode,
  transcribeOptionLabel,
  transcribeOptions,
  transcribeStatus,
} from './tools-transcribe.ts';

describe('转录工具', () => {
  it('认视频与音频文件', () => {
    expect(isTranscribable('访谈.MP4')).toBe(true);
    expect(isTranscribable('podcast.m4a')).toBe(true);
    expect(isTranscribable('cover.png')).toBe(false);
    expect(isTranscribable('README')).toBe(false);
    expect(baseName('/Users/me/Movies/访谈.mp4')).toBe('访谈.mp4');
    expect(baseName('C:\\clips\\a.wav')).toBe('a.wav');
  });

  it('本地列本机的模型包，云端列在线服务商的全部模型（没连上的标未连接）', () => {
    const view = fixtureView();
    expect(transcribeOptions(view, 'local').map((o) => o.key)).toEqual(['local/qwen3-asr-0.6b@mlx-4bit']);
    const cloud = transcribeOptions(view, 'cloud');
    expect(cloud.map((o) => [o.key, o.usable])).toEqual([
      ['openai/gpt-4o-transcribe', true],
      ['openai/whisper-1', true],
      ['custom:asr-box/whisper-large', true],
      ['google/gemini-2.5-flash', false],
    ]);
    expect(transcribeOptionLabel(cloud[3]!, 'cloud')).toBe('Google Gemini · gemini-2.5-flash · 未连接');
    expect(transcribeOptionLabel(cloud[0]!, 'cloud')).toBe('OpenAI · gpt-4o-transcribe');
  });

  it('没装好的本地模型标未安装', () => {
    const view = fixtureView();
    view.transcribe.providers[0]!.models.push(transcribeModel('whisper-large-v3@mlx', { available: false, unavailableReason: 'not-installed' }));
    const local = transcribeOptions(view, 'local');
    expect(transcribeOptionLabel(local[1]!, 'local')).toBe('whisper-large-v3@mlx · 未安装');
    expect(transcribeStatus(local[1]!, 'local')).toBe('模型尚未安装');
    expect(transcribeStatus(local[0]!, 'local')).toBe('已安装 · 在本机识别');
  });

  it('进页时落在生效默认值那一边；换方式时落到那边第一只能用的、语言回自动', () => {
    const view = fixtureView();
    expect(initialTranscribe(view, null)).toEqual({ mode: 'local', model: 'local/qwen3-asr-0.6b@mlx-4bit' });
    view.transcribe.effective = { providerId: 'custom:asr-box', modelId: 'whisper-large', source: 'user-default' };
    expect(initialTranscribe(view, null)).toEqual({ mode: 'cloud', model: 'custom:asr-box/whisper-large' });
    expect(initialTranscribe(view, { mode: 'cloud', model: 'openai/whisper-1' })).toEqual({ mode: 'cloud', model: 'openai/whisper-1' });
    expect(switchMode(view, 'cloud')).toEqual({ mode: 'cloud', model: 'custom:asr-box/whisper-large', language: '' });
  });

  it('云端的现状句', () => {
    const cloud = transcribeOptions(fixtureView(), 'cloud');
    expect(transcribeStatus(cloud[0]!, 'cloud')).toBe('已连接 · OpenAI · 联网转录');
    expect(transcribeStatus(cloud[3]!, 'cloud')).toBe('未连接 · Google Gemini · 联网转录');
    expect(transcribeStatus(null, 'cloud')).toBe('还没有云端语音识别服务');
  });
});
