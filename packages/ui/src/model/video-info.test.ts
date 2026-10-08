import { describe, expect, it } from 'vitest';
import type { AssetRecord, DocumentRecord, Provenance, Sequence } from '@baocut/protocol';
import {
  HERO_NAME_MAX,
  VIDEO_INFO_SECTION,
  contentCounts,
  contentsRow,
  copyText,
  editorExtras,
  elideMiddle,
  entryFacts,
  heroLine,
  prettyDate,
  sections,
  snapshotFacts,
  speechModel,
  translationRow,
  translationTargets,
  type VideoInfoFacts,
} from './video-info.ts';

/** 语言名用注入的，不依赖运行环境的 Intl。 */
const NAMES: Record<string, string> = { zh: '中文', en: '英语', ja: '日语' };
const languageName = (tag: string) => NAMES[tag] ?? tag;

function sequence(markers: Sequence['markers'] = []): Sequence {
  return {
    id: 'seq',
    revision: '1',
    name: '主序列',
    fps: { num: 30, den: 1 },
    canvas: { width: 1920, height: 1080, workingSpace: 'srgb', background: { color: '#000000', alpha: 1 } },
    durationPolicy: { kind: 'derived' },
    tracks: [],
    // 一条字幕把序列撑到 3 分 12 秒（30 fps 下 5760 帧）。
    items: [{ id: 'cap', type: 'caption', trackId: 's1', span: { fromFrame: 0, durationFrames: 5760 }, documentId: 'd_cap' }],
    animationBindings: [],
    transitions: [],
    markers,
  } as unknown as Sequence;
}

function asset(provenance: Provenance, name = 'talk-take2.mp4'): AssetRecord {
  return {
    id: 'asset_a',
    kind: 'video',
    name,
    currentRevision: '1',
    revisions: {
      '1': { revision: '1', contentHash: 'h', byteLength: 1, mediaType: 'video/mp4', storage: { mode: 'managed' }, provenance },
    },
  };
}

function doc(id: string, kind: string, language?: string): DocumentRecord {
  return {
    id,
    kind,
    name: kind,
    ...(language ? { language } : {}),
    sourceAssetId: 'asset_a',
    currentRevision: '1',
    revisions: { '1': { revision: '1', contentHash: 'h', byteLength: 1, createdAt: '2026-10-01T00:00:00Z', createdBy: 'tx' } },
  };
}

const LOCAL_ENGINE = { provider: 'local', bundleId: 'qwen3-asr-0.6b@mlx-4bit', models: { asr: { family: 'qwen3-asr', revision: 'abc' } }, backend: 'mlx' };

/** 两位说话人、三段（换说话人就断段）。 */
const speechBody = {
  schema: 'baocut.speech/1',
  clock: 'source-asset',
  timescale: 1_000_000,
  engine: LOCAL_ENGINE,
  speakers: [],
  words: [
    { id: 'w1', start: 0, end: 500_000, text: '大家好', speaker: 's1' },
    { id: 'w2', start: 500_000, end: 900_000, text: '今天', speaker: 's1' },
    { id: 'w3', start: 1_000_000, end: 1_500_000, text: '你好', speaker: 's2' },
    { id: 'w4', start: 1_600_000, end: 2_000_000, text: '接着说', speaker: 's1' },
  ],
  sentences: null,
};

const LINK: Provenance = {
  origin: 'link-import',
  importedFrom: { originalName: 'kelang-ep42-master.mp4', importedAt: '2026-10-01T00:00:00Z' },
  source: {
    url: 'https://cdn.example/kl.mp4',
    webpageUrl: 'https://kelang.example/ep42',
    platform: 'YouTube',
    mediaId: 'kl-ep42',
    title: '科浪访谈',
    uploader: '科浪电台',
    uploadDate: '20260420',
  },
};

const LOCAL: Provenance = { origin: 'user-import', importedFrom: { originalName: 'talk-take2.mp4', importedAt: '2026-10-01T00:00:00Z' } };

function editorFacts(provenance: Provenance, speech: DocumentRecord | null = doc('d_speech', 'speech', 'zh')): VideoInfoFacts {
  return snapshotFacts({
    title: '口播剪辑 · 实验',
    location: '/Users/me/Movies/口播/口播剪辑.baocut',
    sequence: sequence(),
    candidates: [{ asset: asset(provenance), speech }],
    speechBody,
    languageName,
  });
}

describe('视频详情的行', () => {
  it('缺席的行整行省略，不写占位', () => {
    const bare: VideoInfoFacts = { title: '新视频', source: null, location: null, media: '00:00.0 · 1920×1080 · 30 fps', transcript: null, link: null };
    expect(sections(bare, editorExtras({ speakers: 0, chapters: 0, paragraphs: 0 }, []))[0]!.rows.map((r) => r.label)).toEqual(['媒体']);
    expect(contentsRow(0, 0, 0)).toBeNull();
    expect(translationRow(['  '])).toBeNull();
    // 空分区连标题一起丢：没有来源信息就没有那个小标题；什么都没有时一个分区都不剩。
    expect(sections(bare).map((s) => s.title)).toEqual([VIDEO_INFO_SECTION.media]);
    expect(sections({ ...bare, media: null })).toEqual([]);
    // 转写还没有时没有「转录」行；hero 认不出种类时只剩文件名。
    const facts = editorFacts({ origin: 'derived', importedFrom: { originalName: 'mix.wav', importedAt: '' } }, null);
    expect(facts.transcript).toBeNull();
    expect(heroLine(facts.source)).toBe('mix.wav');
  });

  it('两个入口的信息密度不同：extras 只有编辑器那条路给得出', () => {
    const facts = editorFacts(LINK);
    const counts = contentCounts(sequence([{ id: 'm1', frame: 0, kind: 'chapter' } as Sequence['markers'][number]]), [
      { assetId: 'asset_a', body: speechBody },
      { assetId: 'asset_b', body: undefined },
    ]);
    expect(counts).toEqual({ speakers: 2, chapters: 1, paragraphs: 3 });
    const targets = translationTargets(
      { t1: doc('t1', 'translation', 'en'), t2: doc('t2', 'translation', 'ja'), t3: doc('t3', 'translation', 'en') },
      languageName,
    );
    const editor = sections(facts, editorExtras(counts, targets));
    expect(editor[0]!.rows.map((r) => r.label)).toEqual(['位置', '媒体', '转录', '内容', '译文']);
    expect(editor[0]!.rows[1]!.value).toBe('3:12.0 · 1920×1080 · 30 fps');
    expect(editor[0]!.rows[2]!.value).toBe('qwen3-asr-0.6b@mlx-4bit · 中文');
    expect(editor[0]!.rows[3]!.value).toBe('2 位说话人 · 1 章 · 3 段');
    expect(editor[0]!.rows[4]!.value).toBe('英语、日语');
    // Space 那条路手上只有条目记录：没有转录、内容、译文，也没有来源信息。
    const card = sections(entryFacts({ kind: 'video', media: { durationSec: 192, width: 1920, height: 1080 } }, '口播剪辑', '/Users/me/口播剪辑.baocut'));
    expect(card.map((s) => s.title)).toEqual([VIDEO_INFO_SECTION.media]);
    expect(card[0]!.rows.map((r) => `${r.label}=${r.value}`)).toEqual(['位置=/Users/me/口播剪辑.baocut', '媒体=3:12 · 1920×1080']);
    expect(sections(entryFacts({ kind: 'video' }, '口播剪辑', null))).toEqual([]);
  });

  it('来源信息逐项放行，网址导入才有', () => {
    expect(sections(editorFacts(LOCAL)).map((s) => s.title)).toEqual([VIDEO_INFO_SECTION.media]);
    const meta = sections(editorFacts(LINK))[1]!;
    expect(meta.title).toBe(VIDEO_INFO_SECTION.source);
    expect(meta.rows.map((r) => `${r.label}=${r.value}`)).toEqual([
      '原标题=科浪访谈',
      '频道=科浪电台',
      '发布=2026-04-20',
      '平台=YouTube',
      '视频 ID=kl-ep42',
      '网址=https://kelang.example/ep42',
    ]);
    expect(meta.rows[4]!.mono).toBe(true);
    // 日期不是八位数字就整行不出，不猜格式；缺的项各自省略。
    expect(prettyDate('2026-04-20')).toBeNull();
    const partial = editorFacts({ origin: 'link-import', source: { url: 'https://x.example/v', uploadDate: '2026-04-20' } });
    expect(sections(partial)[1]!.rows.map((r) => r.label)).toEqual(['网址']);
    expect(heroLine(editorFacts(LINK).source)).toBe('网址导入 · kelang-ep42-master.mp4');
  });

  it('原标题与原简介：改过名才写原标题；原简介限高、复制全文', () => {
    const described: Provenance = { ...LINK, source: { ...(LINK.source as Record<string, unknown>), description: '第一段\n第二段' } };
    const meta = sections(editorFacts(described))[1]!;
    expect(meta.rows.map((r) => r.label)).toEqual(['原标题', '频道', '发布', '平台', '视频 ID', '网址', '原简介']);
    expect(meta.rows[0]!.value).toBe('科浪访谈');
    expect(meta.rows[6]!.long).toBe(true);
    expect(copyText('t', null, [meta])).toContain('原简介: 第一段\n  第二段\n');
    // 没改过名：原标题就是 hero 那行，不重复。
    const same = snapshotFacts({ title: '科浪访谈', location: null, sequence: null, candidates: [{ asset: asset(described), speech: null }], speechBody: undefined, languageName });
    expect(sections(same)[0]!.rows.some((r) => r.label === '原标题')).toBe(false);
    expect(sections(same).flatMap((s) => s.rows.map((r) => r.label))).not.toContain('原标题');
  });

  it('位置与链接的源文件带着「在文件夹中显示」的路径；收进视频目录的素材没有源文件行', () => {
    const linked = asset(LINK);
    linked.revisions['1'] = { ...linked.revisions['1']!, storage: { mode: 'linked', locator: { path: '../downloads/kl.webm' }, frozen: false } };
    const facts = snapshotFacts({
      title: '口播剪辑',
      location: '/Users/me/BaoCut/科浪/口播剪辑',
      sequence: null,
      candidates: [{ asset: linked, speech: null }],
      speechBody: undefined,
      languageName,
    });
    const media = sections(facts)[0]!.rows;
    expect(media.map((r) => `${r.label}=${r.value}`)).toEqual(['位置=/Users/me/BaoCut/科浪/口播剪辑', '源文件=/Users/me/BaoCut/科浪/downloads/kl.webm']);
    expect(media.map((r) => r.reveal)).toEqual(['/Users/me/BaoCut/科浪/口播剪辑', '/Users/me/BaoCut/科浪/downloads/kl.webm']);
    expect(sections(editorFacts(LOCAL))[0]!.rows.map((r) => r.label)).not.toContain('源文件');
  });

  it('省略号只进眼睛不进剪贴板', () => {
    const long = '“The default way to code is vibecoding.” OpenAI chief research officer.mp4';
    const short = elideMiddle(long, HERO_NAME_MAX);
    expect(Array.from(short)).toHaveLength(HERO_NAME_MAX);
    expect(short.startsWith('“The default way')).toBe(true);
    expect(short.endsWith('officer.mp4')).toBe(true);
    expect(elideMiddle('talk.mp4', HERO_NAME_MAX)).toBe('talk.mp4');
    // 复制走完整值。
    expect(heroLine({ kind: '本地文件', fileName: long })).toBe(`本地文件 · ${long}`);
  });

  it('复制文本就是屏幕上那几行，值内换行缩进两格', () => {
    const facts = editorFacts(LOCAL);
    const list = sections(facts, editorExtras({ speakers: 1, chapters: 3, paragraphs: 62 }, []));
    expect(copyText(facts.title, heroLine(facts.source), list)).toBe(
      '口播剪辑 · 实验\n' +
        '本地文件 · talk-take2.mp4\n' +
        '\n' +
        '来源与媒体\n' +
        '位置: /Users/me/Movies/口播/口播剪辑.baocut\n' +
        '媒体: 3:12.0 · 1920×1080 · 30 fps\n' +
        '转录: qwen3-asr-0.6b@mlx-4bit · 中文\n' +
        '内容: 1 位说话人 · 3 章 · 62 段\n',
    );
    expect(copyText('标题', null, [{ title: '分区', rows: [{ label: '说明', value: '第一行\n第二行', mono: false }] }])).toBe(
      '标题\n\n分区\n说明: 第一行\n  第二行\n',
    );
  });

  it('转写模型：在线写模型 ID，本机写模型包，旧形状认得出的才写', () => {
    expect(speechModel(speechBody)).toBe('qwen3-asr-0.6b@mlx-4bit');
    expect(
      speechModel({ engine: { provider: 'openai', bundleId: null, models: { asr: { family: 'openai', revision: 'gpt-4o-transcribe' } }, backend: 'online' } }),
    ).toBe('gpt-4o-transcribe');
    expect(speechModel({ engine: { bundleId: null, models: { asr: { family: 'whisper' } } } })).toBe('whisper');
    expect(speechModel({ engine: 'whisper-large-v3' })).toBe('whisper-large-v3');
    expect(speechModel({ engine: null })).toBeNull();
    expect(speechModel(undefined)).toBeNull();
    // 正文还没取到：转录行先只写语言。
    const loading = snapshotFacts({
      title: 't',
      location: null,
      sequence: null,
      candidates: [{ asset: asset(LOCAL), speech: doc('d', 'speech', 'en') }],
      speechBody: undefined,
      languageName,
    });
    expect(loading.transcript).toBe('英语');
    expect(loading.media).toBeNull();
  });
});
