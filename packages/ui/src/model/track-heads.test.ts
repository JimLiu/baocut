import { describe, expect, it } from 'vitest';
import { captionItem, documentRecord, sequence, track, videoItem } from '../testing/sequence-records.ts';
import { headTags, languageTag, subtitleTrackLanguage } from './track-heads.ts';

describe('行头的语言标签', () => {
  it('去空白、下划线换连字符、大写；没有语言是空串', () => {
    expect(languageTag(' zh-Hans ')).toBe('ZH-HANS');
    expect(languageTag('pt_BR')).toBe('PT-BR');
    expect(languageTag(null)).toBe('');
  });

  it('同类同标签按先后编号，字幕与配音各算各的，没有语言的不写', () => {
    const tags = headTags([
      { trackId: 's1', group: 'subtitle', language: 'en' },
      { trackId: 's2', group: 'subtitle', language: 'zh-Hans' },
      { trackId: 's3', group: 'subtitle', language: 'EN' },
      { trackId: 'd1', group: 'dub', language: 'en' },
      { trackId: 's4', group: 'subtitle', language: null },
    ]);
    expect([...tags]).toEqual([
      ['s1', 'EN 1'],
      ['s2', 'ZH-HANS'],
      ['s3', 'EN 2'],
      ['d1', 'EN'],
    ]);
  });
});

describe('字幕行的语言', () => {
  const documents = {
    tr: documentRecord('tr', 'transcript', '转写', { language: 'zh-Hans' }),
    tl: documentRecord('tl', 'translation', '英文译文', { language: 'en' }),
    capO: documentRecord('capO', 'captions', '原文字幕', { sourceDocumentId: 'tr' }),
    capT: documentRecord('capT', 'captions', '英文字幕', { sourceDocumentId: 'tl', language: 'en' }),
  };
  const s1 = track('s1', 'subtitle', 2);
  const s2 = track('s2', 'subtitle', 3);
  const s3 = track('s3', 'subtitle', 4);
  const seq = sequence(
    [track('v1', 'visual', 1), s1, s2, s3],
    [videoItem('v', 'v1', 0, 300), captionItem('c2', 's1', 'capO', 150, 150), captionItem('c1', 's1', 'capO', 0, 150), captionItem('c3', 's2', 'capT')],
  );

  it('原文字幕没写语言时取转写的语言；译文按派生自译文判', () => {
    expect(subtitleTrackLanguage(seq, s1, documents)).toEqual({ language: 'zh-Hans', kind: 'original' });
    expect(subtitleTrackLanguage(seq, s2, documents)).toEqual({ language: 'en', kind: 'translation' });
  });

  it('轨上没有字幕实例时没有', () => {
    expect(subtitleTrackLanguage(seq, s3, documents)).toBeNull();
  });
});
