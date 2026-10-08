import { describe, expect, it } from 'vitest';
import type { FontFamilyStatus } from '@baocut/protocol';
import { formatDownloadedFonts, formatFontFamilies, formatFontRemoval, parseFontsArgs } from './fonts-output.ts';

const status = (family: string, extra: Partial<FontFamilyStatus>): FontFamilyStatus => ({
  family,
  state: 'downloadable',
  category: 'display',
  subsets: ['latin'],
  scripts: ['latin'],
  weights: [400],
  italics: [],
  variable: false,
  licence: 'OFL-1.1',
  source: 'google-fonts',
  downloaded: [],
  job: null,
  error: null,
  ...extra,
});

describe('baocut fonts', () => {
  it('参数：族名可以分开写，字重与斜体一起给；分类与文字只认列出来的', () => {
    expect(parseFontsArgs([], {})).toEqual({ kind: 'downloaded' });
    expect(parseFontsArgs(['download', 'Noto', 'Sans', 'SC'], {})).toEqual({ kind: 'download', family: 'Noto Sans SC' });
    expect(parseFontsArgs(['download', 'Lobster'], { weights: '400, 700', italic: true })).toEqual({
      kind: 'download',
      family: 'Lobster',
      faces: [
        { weight: 400, italic: true },
        { weight: 700, italic: true },
      ],
    });
    expect(parseFontsArgs(['search', 'mono'], { script: 'japanese', limit: '5' })).toEqual({
      kind: 'search',
      query: 'mono',
      script: 'japanese',
      limit: 5,
    });
    expect(parseFontsArgs(['remove', 'Lobster'], {})).toEqual({ kind: 'remove', family: 'Lobster' });
    expect(parseFontsArgs(['clear'], {})).toEqual({ kind: 'clear' });
    expect(() => parseFontsArgs(['download'], {})).toThrow('用法');
    expect(() => parseFontsArgs(['download', 'Lobster'], { italic: true })).toThrow('--weights');
    expect(() => parseFontsArgs(['download', 'Lobster'], { weights: 'bold' })).toThrow('--weights');
    expect(() => parseFontsArgs(['search'], { category: 'fancy' })).toThrow('--category');
    expect(() => parseFontsArgs(['search'], { script: 'klingon' })).toThrow('--script');
    expect(() => parseFontsArgs(['nope'], {})).toThrow('用法');
  });

  it('输出：下载缓存按族合并、带大小与许可；列表带状态、进度与失败原因；删除说明保留了什么', () => {
    const face = { licence: 'OFL-1.1' as const, sha256: 'a'.repeat(64), downloadedAt: '2026-10-04T00:00:00Z' };
    expect(
      formatDownloadedFonts(
        [
          { ...face, family: 'Lobster', weight: 400, italic: false, sizeBytes: 2048 },
          { ...face, family: 'Noto Sans JP', weight: 400, italic: false, sizeBytes: 5 * 1024 * 1024 },
          { ...face, family: 'Noto Sans JP', weight: 700, italic: true, sizeBytes: 5 * 1024 * 1024 },
        ],
        2048 + 10 * 1024 * 1024,
      ),
    ).toEqual(['Lobster  400  2.0 KB  OFL-1.1', 'Noto Sans JP  400、700 斜体  10.0 MB  OFL-1.1', '共 2 个族、3 个字重，10.0 MB']);
    expect(formatDownloadedFonts([], 0)).toEqual(['还没有下载的字体']);
    expect(
      formatFontFamilies(
        [
          status('Poppins', { state: 'built-in' }),
          status('Lobster', { state: 'downloading', job: { jobId: 'job_1', doneBytes: 50, totalBytes: 200 } }),
          status('Broken', { state: 'failed', error: { code: 'FONT_DOWNLOAD_NETWORK', message: '网络连不上', at: '' } }),
          status('PingFang SC', { state: 'installed', category: null, scripts: [], licence: null, source: 'local' }),
        ],
        10,
      ),
    ).toEqual([
      'Poppins  [内置]  display · latin · OFL-1.1',
      'Lobster  [下载中 25%]  display · latin · OFL-1.1',
      'Broken  [失败（网络连不上）]  display · latin · OFL-1.1',
      'PingFang SC  [本机]',
      '（共 10 个，只列出前 4 个）',
    ]);
    expect(
      formatFontRemoval({
        removed: [],
        freedBytes: 0,
        kept: [{ ...face, family: 'Lobster', weight: 400, italic: false, sizeBytes: 1 }],
      }),
    ).toEqual(['没有可删除的字体', '保留 1 个（还没结束的导出在用）：Lobster 400']);
  });
});
