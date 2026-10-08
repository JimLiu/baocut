import { describe, expect, it } from 'vitest';
import { formatVideoSelection, parseIdList, parseLibraryName, parseSpeakerVoice } from './library-output.ts';

describe('baocut library 的参数与输出', () => {
  it('库名只认三个', () => {
    expect(parseLibraryName('voices')).toBe('voices');
    expect(() => parseLibraryName('fonts')).toThrow('没有这个库：fonts');
    expect(() => parseLibraryName(undefined)).toThrow('缺少');
  });
});

describe('视频里启用的库条目', () => {
  it('--speaker-voice：转写:说话人=音色，Provider 的音色带 @Provider', () => {
    expect(parseSpeakerVoice('doc_s:S1=library:voice_a')).toEqual({ documentId: 'doc_s', speakerId: 'S1', voice: 'library:voice_a' });
    expect(parseSpeakerVoice('doc_s:S2=pNInz6obpg@elevenlabs')).toEqual({
      documentId: 'doc_s',
      speakerId: 'S2',
      voice: 'pNInz6obpg',
      providerId: 'elevenlabs',
    });
    expect(() => parseSpeakerVoice('doc_s=voice')).toThrow(/格式/);
    expect(() => parseSpeakerVoice('doc_s:S1=')).toThrow(/格式/);
    expect(parseIdList('glo_1, glo_2,,')).toEqual(['glo_1', 'glo_2']);
    expect(parseIdList('')).toEqual([]);
  });

  it('显示：每一步的术语表与说话人的音色', () => {
    expect(
      formatVideoSelection({
        videoId: 'vid_1',
        documentId: 'doc_l',
        revision: 'r2',
        selection: {
          glossaries: { transcribe: [], translate: ['glo_1'] },
          speakerVoices: [{ documentId: 'doc_s', speakerId: 'S1', voice: 'v1', providerId: 'elevenlabs' }],
        },
      }),
    ).toEqual([
      '视频 vid_1（library-selection 文档 doc_l 版本 r2）',
      '转写用术语表：（无）',
      '翻译用术语表：glo_1',
      '说话人的音色：doc_s:S1 = v1（只在 elevenlabs 上）',
    ]);
  });
});
