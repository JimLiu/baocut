import { describe, expect, it } from 'vitest';
import { audioItem, captionItem, documentRecord, sequence, track, videoItem } from '../testing/sequence-records.ts';
import {
  DEFAULT_AUDIO_FORM,
  DEFAULT_LOUDNESS_FORM,
  DEFAULT_VIDEO_FORM,
  audioSettings,
  audioSourceChoices,
  dbChoices,
  defaultFileNames,
  exportSourceDir,
  exportTargetDir,
  dubGroups,
  dubParts,
  dubTags,
  formatDb,
  initialSubtitlePick,
  loudnessNote,
  outputSize,
  projectSettings,
  ratioChoices,
  resolutionChoices,
  safeFileStem,
  subtitleLanes,
  subtitlePlan,
  transcriptSettings,
  transcriptSources,
  videoSettings,
} from './export-settings.ts';

describe('成片设置', () => {
  it('分辨率：画布本来的尺寸排第一，往下只列更小的标准档；竖屏按短边算', () => {
    expect(resolutionChoices({ width: 1920, height: 1080 }).map((c) => [c.label, c.width, c.height, c.source])).toEqual([
      ['1080p', 1920, 1080, true],
      ['720p', 1280, 720, false],
    ]);
    expect(resolutionChoices({ width: 3840, height: 2160 }).map((c) => c.label)).toEqual(['4K', '1080p', '720p']);
    expect(resolutionChoices({ width: 1080, height: 1920 }).map((c) => [c.label, c.width, c.height])).toEqual([
      ['1080p', 1080, 1920],
      ['720p', 720, 1280],
    ]);
    expect(resolutionChoices({ width: 1440, height: 1080 })[1]).toMatchObject({ width: 960, height: 720 });
  });

  it('默认设置只带烧字幕；选了更小的档才带 height，体积档落成 crf，响度开着才带', () => {
    const canvas = { width: 1920, height: 1080 };
    expect(videoSettings(DEFAULT_VIDEO_FORM, canvas, {}, DEFAULT_LOUDNESS_FORM)).toEqual({ kind: 'video', format: 'mp4', burnCaptions: true });
    expect(
      videoSettings(
        { quality: 'small', short: 720, ratio: null, burnCaptions: false, onUnsupported: 'skip', source: 'mix' },
        canvas,
        { range: { start: 1, end: 2 } },
        { on: true, lufs: -14, truePeak: -1 },
      ),
    ).toEqual({
      kind: 'video',
      format: 'mp4',
      range: { start: 1, end: 2 },
      height: 720,
      crf: 26,
      burnCaptions: false,
      onUnsupported: 'skip',
      audio: { loudness: { integratedLufs: -14, truePeakDb: -1 } },
    });
    expect(videoSettings({ ...DEFAULT_VIDEO_FORM, quality: 'high', short: 1080 }, canvas, {}, DEFAULT_LOUDNESS_FORM)).toEqual({
      kind: 'video',
      format: 'mp4',
      crf: 16,
      burnCaptions: true,
    });
  });

  it('画幅：与画布同比例的档不列；换了画幅时短边由档位定、长边按画幅推，宽高都给（引擎加黑边）', () => {
    const canvas = { width: 1920, height: 1080 };
    expect(ratioChoices(canvas).map((r) => r.key)).toEqual(['9:16', '1:1', '4:5']);
    expect(ratioChoices({ width: 1080, height: 1920 }).map((r) => r.key)).toEqual(['16:9', '1:1', '4:5']);
    expect(ratioChoices({ width: 1440, height: 1080 }).map((r) => r.key)).toEqual(['16:9', '9:16', '1:1', '4:5']);
    expect(outputSize(1080, { w: 9, h: 16 })).toEqual({ width: 1080, height: 1920 });
    expect(outputSize(720, { w: 4, h: 5 })).toEqual({ width: 720, height: 900 });
    expect(outputSize(1080, { w: 16, h: 9 })).toEqual({ width: 1920, height: 1080 });
    // 缺省的分辨率档（画布本来的短边）也带宽高。
    expect(videoSettings({ ...DEFAULT_VIDEO_FORM, ratio: '9:16' }, canvas, {}, DEFAULT_LOUDNESS_FORM)).toEqual({
      kind: 'video',
      format: 'mp4',
      width: 1080,
      height: 1920,
      burnCaptions: true,
    });
    expect(videoSettings({ ...DEFAULT_VIDEO_FORM, ratio: '1:1', short: 720 }, canvas, {}, DEFAULT_LOUDNESS_FORM)).toMatchObject({
      width: 720,
      height: 720,
    });
    expect(resolutionChoices(canvas, { key: '4:5', w: 4, h: 5 }).map((c) => [c.label, c.width, c.height, c.source])).toEqual([
      ['1080p', 1080, 1350, true],
      ['720p', 720, 900, false],
    ]);
    // 推出来超过输出上限的档不列：2880 短边的画布出 9:16，画布本来的那一档高 5120，从 4K 起。
    const big = { width: 5120, height: 2880 };
    expect(resolutionChoices(big, { key: '9:16', w: 9, h: 16 }).map((c) => [c.label, c.width, c.height])).toEqual([
      ['4K', 2160, 3840],
      ['1080p', 1080, 1920],
      ['720p', 720, 1280],
    ]);
    expect(videoSettings({ ...DEFAULT_VIDEO_FORM, ratio: '9:16' }, big, {}, DEFAULT_LOUDNESS_FORM)).toMatchObject({
      width: 2160,
      height: 3840,
    });
    // 与画布同比例的档等于跟随画布：不带宽高。
    expect(videoSettings({ ...DEFAULT_VIDEO_FORM, ratio: '16:9' }, canvas, {}, DEFAULT_LOUDNESS_FORM)).toEqual({
      kind: 'video',
      format: 'mp4',
      burnCaptions: true,
    });
  });

  it('成片的声音来源：混音不带 source；只要原声、只要某组配音照音频导出的写法', () => {
    const canvas = { width: 1920, height: 1080 };
    expect(videoSettings({ ...DEFAULT_VIDEO_FORM, source: 'original' }, canvas, {}, DEFAULT_LOUDNESS_FORM)).toMatchObject({ kind: 'video', source: 'original' });
    expect(videoSettings({ ...DEFAULT_VIDEO_FORM, source: 'dub:g_en' }, canvas, {}, DEFAULT_LOUDNESS_FORM)).toMatchObject({ source: { dubGroupId: 'g_en' } });
  });
});

describe('响度', () => {
  it('减号用 U+2212，一位小数只在需要时出现', () => {
    expect(formatDb(-16)).toBe('−16');
    expect(formatDb(-1.5)).toBe('−1.5');
    expect(formatDb(0)).toBe('0');
  });

  it('当前值不在常用档里时补进去，从大到小', () => {
    expect(dbChoices([-14, -16, -23], -18)).toEqual([-14, -16, -18, -23]);
    expect(dbChoices([-14, -16], -16)).toEqual([-14, -16]);
  });

  it('说明句', () => {
    expect(loudnessNote(DEFAULT_LOUDNESS_FORM)).toBe('关：按视频里的混音原样导出。');
    expect(loudnessNote({ on: true, lufs: -16, truePeak: -1.5 })).toBe('整片混音统一到 −16 LUFS，真峰值不超过 −1.5 dBTP。');
  });
});

describe('音频设置', () => {
  const seq = sequence(
    [track('a1', 'audio', 1), track('a2', 'audio', 2)],
    [
      audioItem('d1', 'a2', 0, 3, { extensions: { 'baocut.dub': { groupId: 'g_en', language: 'en', unitId: 'u1' } } }),
      audioItem('d2', 'a2', 90, 3, { extensions: { 'baocut.dub': { groupId: 'g_en', language: 'en', unitId: 'u2' } } }),
      audioItem('bg', 'a1', 0, 10, { extensions: { 'baocut.dub': { groupId: 'g_en', stem: 'background' } } }),
      audioItem('music', 'a1', 0, 10),
    ],
  );

  it('配音组：同一 groupId 的配音本体算一组，分离出的背景不算', () => {
    expect(dubGroups(seq)).toEqual([{ groupId: 'g_en', language: 'en', label: 'English配音', items: 2 }]);
  });

  it('快速选择：有配音时才有「只要原声」与每组配音', () => {
    expect(audioSourceChoices([]).map((c) => c.key)).toEqual(['mix']);
    expect(audioSourceChoices(dubGroups(seq)).map((c) => c.key)).toEqual(['mix', 'original', 'dub:g_en']);
  });

  it('WAV 不带码率；混音不带 source；配音组落成 dubGroupId', () => {
    expect(audioSettings({ ...DEFAULT_AUDIO_FORM, format: 'wav' }, {}, DEFAULT_LOUDNESS_FORM)).toEqual({ kind: 'audio', format: 'wav', channels: 2 });
    expect(audioSettings({ format: 'm4a', bitrate: 320, channels: 1, source: 'dub:g_en' }, { ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }] }, { on: true, lufs: -16, truePeak: -1.5 })).toEqual({
      kind: 'audio',
      format: 'm4a',
      ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }],
      source: { dubGroupId: 'g_en' },
      channels: 1,
      bitrateKbps: 320,
      loudness: { integratedLufs: -16, truePeakDb: -1.5 },
    });
    expect(audioSettings({ ...DEFAULT_AUDIO_FORM, source: 'original' }, {}, DEFAULT_LOUDNESS_FORM)).toMatchObject({ source: 'original' });
  });
});

describe('字幕设置', () => {
  const documents = {
    speech: documentRecord('speech', 'speech', '转写', { language: 'zh' }),
    trans: documentRecord('trans', 'translation', '英文译文', { language: 'en', sourceDocumentId: 'speech' }),
    zh: documentRecord('zh', 'caption', '访谈', { sourceDocumentId: 'speech', language: 'zh' }),
    en: documentRecord('en', 'caption', '访谈 English', { sourceDocumentId: 'trans', language: 'en' }),
    ja: documentRecord('ja', 'caption', '访谈 日本語', { language: 'ja' }),
  };
  const seq = sequence(
    [track('s1', 'subtitle', 1), track('s2', 'subtitle', 2), track('s3', 'subtitle', 3, { visible: false })],
    [captionItem('c_en', 's2', 'en'), captionItem('c_zh', 's1', 'zh'), captionItem('c_ja', 's3', 'ja')],
  );

  it('每份字幕文档一行，原文在前、名字与字幕轨条一致；轨道停用的算没开', () => {
    const lanes = subtitleLanes(seq, documents);
    expect(lanes.map((l) => [l.documentId, l.label, l.shown])).toEqual([
      ['zh', '原文（访谈）', true],
      ['ja', '原文（访谈 日本語）', false],
      ['en', 'English', true],
    ]);
    expect(initialSubtitlePick(lanes)).toEqual(['zh', 'en']);
  });

  it('没有字幕轨时退回转写文档', () => {
    const lanes = subtitleLanes(sequence([], []), documents);
    expect(lanes.map((l) => [l.documentId, l.kind])).toEqual([['speech', 'speech']]);
    expect(initialSubtitlePick(lanes)).toEqual(['speech']);
  });

  it('一条出它自己；两条合成一份是双语；各出一份与三条以上置灰', () => {
    const lanes = subtitleLanes(seq, documents);
    expect(subtitlePlan(lanes, [], true)).toEqual({ options: null, block: 'none' });
    expect(subtitlePlan(lanes, ['en'], true)).toEqual({ options: { documentId: 'en' }, block: null });
    expect(subtitlePlan(lanes, ['en', 'zh'], true)).toEqual({ options: { documentId: 'zh', bilingual: { documentId: 'en' } }, block: null });
    expect(subtitlePlan(lanes, ['en', 'zh'], false).block).toBe('each');
    expect(subtitlePlan(lanes, ['en', 'zh', 'ja'], true).block).toBe('too-many');
  });

  it('预计文件名照 Runtime 的规则：语言后缀、双语连写、几段加 partN', () => {
    expect(defaultFileNames('访谈: 第一期', { kind: 'subtitles', format: 'srt', documentId: 'zh', bilingual: { documentId: 'en' } }, documents)).toEqual(['访谈_ 第一期.zh-en.srt']);
    expect(defaultFileNames('访谈', { kind: 'subtitles', format: 'vtt', documentId: 'speech_x' }, documents)).toEqual(['访谈.subtitles.vtt']);
    expect(defaultFileNames('访谈', { kind: 'video', format: 'mp4' }, documents)).toEqual(['访谈.mp4']);
    // 成片：画面里烧着的字幕语言，从上到下（隐藏的 s3 不算）；不烧字幕时没有后缀。
    expect(defaultFileNames('访谈', { kind: 'video', format: 'mp4' }, documents, seq)).toEqual(['访谈.en-zh.mp4']);
    expect(defaultFileNames('访谈', { kind: 'video', format: 'mp4', burnCaptions: false }, documents, seq)).toEqual(['访谈.mp4']);
    expect(defaultFileNames('访谈', { kind: 'video', format: 'webm', ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }] }, documents, seq)).toEqual([
      '访谈.en-zh.part1.webm',
      '访谈.en-zh.part2.webm',
    ]);
    expect(defaultFileNames('访谈', { kind: 'audio', format: 'mp3', ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }] }, documents)).toEqual([
      '访谈.audio.part1.mp3',
      '访谈.audio.part2.mp3',
    ]);
    expect(defaultFileNames('访谈', { kind: 'transcript', format: 'md' }, documents)).toEqual(['访谈.transcript.md']);
    expect(defaultFileNames('访谈', { kind: 'project', format: 'xmeml' }, documents)).toEqual(['访谈.xmeml.xml']);
    expect(defaultFileNames('访谈', { kind: 'portable' }, documents)).toEqual(['访谈.baocut']);
    expect(safeFileStem(' ..  ')).toBe('video');
  });

  it('成片没挑位置时导到原视频所在的文件夹；素材在视频目录里面时交给 Runtime 的缺省', () => {
    expect(exportSourceDir('/Users/me/Movies/访谈.mp4', '/Users/me/BaoCut/访谈')).toBe('/Users/me/Movies');
    expect(exportSourceDir('/a.mp4', null)).toBe('/');
    expect(exportSourceDir('C:\\Videos\\talk.mp4', 'D:\\BaoCut\\talk')).toBe('C:\\Videos');
    expect(exportSourceDir('C:\\talk.mp4', null)).toBe('C:\\');
    expect(exportSourceDir('/Users/me/BaoCut/访谈/media/a.mp4', '/Users/me/BaoCut/访谈/')).toBeNull();
    expect(exportSourceDir('/Users/me/BaoCut/访谈/a.mp4', '/Users/me/BaoCut/访谈')).toBeNull();
    expect(exportSourceDir('C:\\BaoCut\\Talk\\a.mp4', 'c:\\baocut\\talk')).toBeNull();
    expect(exportSourceDir('/Users/me/BaoCut/访谈2/a.mp4', '/Users/me/BaoCut/访谈')).toBe('/Users/me/BaoCut/访谈2');
    expect(exportSourceDir(null, '/v')).toBeNull();
  });

  it('只有成片默认导到原视频所在的文件夹，别的种类放项目的 exports/；挑过的位置优先', () => {
    expect(exportTargetDir('video', undefined, null, '/Movies')).toBe('/Movies');
    for (const kind of ['audio', 'subtitles', 'transcript', 'project', 'portable'] as const) {
      expect(exportTargetDir(kind, undefined, null, '/Movies')).toBeNull();
    }
    expect(exportTargetDir('subtitles', undefined, '/Picked', '/Movies')).toBe('/Picked');
    expect(exportTargetDir('video', undefined, '/Picked', '/Movies')).toBe('/Picked');
    expect(exportTargetDir('video', '/Now', '/Picked', '/Movies')).toBe('/Now');
    expect(exportTargetDir('video', null, '/Picked', '/Movies')).toBeNull();
  });
});

describe('文稿设置', () => {
  it('来源先看转写，带上派生自它的译文；没有转写时看时间轴上的字幕', () => {
    const documents = {
      speech: documentRecord('speech', 'speech', '转写', { language: 'zh' }),
      trans: documentRecord('trans', 'translation', '英文译文', { language: 'en', sourceDocumentId: 'speech' }),
      zh: documentRecord('zh', 'caption', '访谈', { sourceDocumentId: 'speech', language: 'zh' }),
    };
    const seq = sequence([track('s1', 'subtitle', 1), track('v1', 'visual', 2)], [captionItem('c', 's1', 'zh'), videoItem('v', 'v1', 0, 30)]);
    expect(transcriptSources(seq, documents)).toEqual([
      { documentId: 'speech', name: '转写', language: 'zh', translations: [{ documentId: 'trans', language: 'en', label: 'English' }] },
    ]);
    const { speech: _speech, trans: _trans, ...captionsOnly } = documents;
    expect(transcriptSources(seq, captionsOnly).map((s) => s.documentId)).toEqual(['zh']);
  });

  it('双语对照带译文；选项只带与默认值不同的，文首只在 Markdown 时带', () => {
    const defaults = { frontmatter: false, chapters: false, speakers: true, skipCut: true };
    expect(
      transcriptSettings({ documentId: 'speech', translationId: 'trans', format: 'md', timestamps: true, ...defaults }, 'speech', {}),
    ).toEqual({
      kind: 'transcript',
      format: 'md',
      documentId: 'speech',
      bilingual: { documentId: 'trans' },
      timestamps: true,
    });
    expect(
      transcriptSettings({ documentId: 'speech', translationId: null, format: 'txt', timestamps: false, ...defaults }, 'speech', {}),
    ).toEqual({
      kind: 'transcript',
      format: 'txt',
      documentId: 'speech',
    });
    const flipped = {
      documentId: 'speech',
      translationId: null,
      timestamps: false,
      frontmatter: true,
      chapters: true,
      speakers: false,
      skipCut: false,
    };
    expect(transcriptSettings({ ...flipped, format: 'md' }, 'speech', {})).toEqual({
      kind: 'transcript',
      format: 'md',
      documentId: 'speech',
      frontmatter: true,
      chapters: true,
      speakers: false,
      skipCut: false,
    });
    expect(transcriptSettings({ ...flipped, format: 'txt' }, 'speech', {})).not.toHaveProperty('frontmatter');
  });
});

describe('工程设置', () => {
  it('便携包缺素材时可以跳过；xmeml 没有别的参数', () => {
    expect(projectSettings('portable', 'fail')).toEqual({ kind: 'portable' });
    expect(projectSettings('portable', 'skip')).toEqual({ kind: 'portable', missingAssets: 'skip' });
    expect(projectSettings('xmeml', 'skip')).toEqual({ kind: 'project', format: 'xmeml' });
  });
});

describe('每种配音各一份', () => {
  const groups = [
    { groupId: 'g_en', language: 'en', label: 'English配音', items: 2 },
    { groupId: 'g_ja', language: 'ja', label: '日本語配音', items: 1 },
  ];

  it('文件名标签：语言代码；没有语言按位置编号；撞了加序号', () => {
    expect(dubTags([{ language: 'en' }, { language: null }, { language: 'en' }, { language: 'a/b' }])).toEqual(['en', 'dub2', 'en-2', 'a_b']);
  });

  it('每组一份，来源是 dubGroupId；只出一个文件时带固定文件名', () => {
    const parts = dubParts(groups, { ...DEFAULT_AUDIO_FORM, format: 'wav' }, { range: { start: 1, end: 5 } }, DEFAULT_LOUDNESS_FORM, '访谈: 第 1 期');
    expect(parts.map((p) => p.fileName)).toEqual(['访谈_ 第 1 期.audio.en.wav', '访谈_ 第 1 期.audio.ja.wav']);
    expect(parts[0]!.settings).toEqual({ kind: 'audio', format: 'wav', range: { start: 1, end: 5 }, source: { dubGroupId: 'g_en' }, channels: 2 });
    expect(parts[1]!.settings).toMatchObject({ source: { dubGroupId: 'g_ja' } });
  });

  it('几段各出一份时不给文件名（Runtime 会把它套到每一段上）', () => {
    const ranges = [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ];
    const parts = dubParts(groups, DEFAULT_AUDIO_FORM, { ranges }, DEFAULT_LOUDNESS_FORM, 'v');
    expect(parts.map((p) => p.fileName)).toEqual([null, null]);
    expect(parts[0]!.settings).toMatchObject({ ranges, source: { dubGroupId: 'g_en' }, bitrateKbps: 192 });
  });
});
