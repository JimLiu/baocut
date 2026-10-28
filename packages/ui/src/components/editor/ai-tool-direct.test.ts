import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale, type Locale } from '@baocut/protocol';
import { aiToolParamsSchema } from '@baocut/protocol/schemas';
import {
  contextItems,
  contextLine,
  directBlocked,
  directCta,
  directHasScope,
  directHint,
  directParams,
  directRefresh,
  directTool,
  needsStructuredOutput,
  pickTranslation,
  refreshableTranslations,
  refreshCounts,
  scopedParagraphs,
} from './ai-tool-direct.ts';
import type { DocumentRecord } from '@baocut/protocol';
import type { PairRow } from '../../model/translation-doc.ts';

const initial = getLocale();
// 测试进程把 `BAOCUT_LOCALE` 定成中文：换语言要连它一起换。
const use = (locale: Locale) => {
  vi.stubEnv('BAOCUT_LOCALE', locale);
  setLocale(locale);
};
beforeEach(() => use('en'));
afterEach(() => {
  vi.unstubAllEnvs();
  setLocale(initial);
});

const para = (...spans: [number, number][]) => ({ words: spans.map(([start, end]) => ({ placements: [{ start, end }] })) });

describe('直接调模型：哪些工具能做', () => {
  it('润色、章节与写作发布类能直接调模型；重新转录、找可剪的口、做封面置灰并写各自的原因', () => {
    for (const tool of ['polish', 'chapters', 'summary', 'blog', 'title', 'desc'] as const) {
      expect(directTool(tool)).toBe(tool);
      expect(directRefresh(tool)).toBe(false);
      expect(directBlocked(tool)).toBeNull();
    }
    const reasons = (['retranscribe', 'cleanup', 'cover'] as const).map((tool) => {
      expect(directTool(tool)).toBeNull();
      expect(directRefresh(tool)).toBe(false);
      return directBlocked(tool);
    });
    expect(new Set(reasons).size).toBe(3);
    expect(reasons.every((r) => r && r.length > 0)).toBe(true);
    expect(reasons[2]).toMatch(/images/);
  });

  it('刷新过期译文也能直接调模型：不走 ai-tool，走 translate 的就地刷新', () => {
    expect(directTool('stale')).toBeNull();
    expect(directRefresh('stale')).toBe(true);
    expect(directBlocked('stale')).toBeNull();
  });

  it('润色与章节要结构化输出；章节总是整篇', () => {
    expect(needsStructuredOutput('polish')).toBe(true);
    expect(needsStructuredOutput('chapters')).toBe(true);
    expect(needsStructuredOutput('summary')).toBe(false);
    expect(directHasScope('chapters')).toBe(false);
    expect(directHasScope('polish')).toBe(true);
  });

  it('主按钮写这个工具自己的动作', () => {
    expect(directCta('polish')).toBe('Polish');
    expect(directCta('title')).toBe('Suggest titles');
    use('zh-Hans');
    expect(directCta('summary')).toBe('写总结');
  });
});

describe('发给模型的那一行', () => {
  it('什么都不带时只有提示词', () => {
    expect(contextLine(contextItems({ tool: 'summary', paragraphs: 0, scope: null, chapters: 3, attachments: 0, skills: [] }))).toBe(
      'Sent to the model: only the prompt above',
    );
  });

  it('文稿、章节、附件、skill 按次序写；润色不带章节', () => {
    const c = { paragraphs: 12, scope: null, chapters: 3, attachments: 2, skills: ['Summary', 'House style'] };
    expect(contextLine(contextItems({ tool: 'summary', ...c }))).toBe(
      'Sent to the model: prompt + transcript 12 paragraphs · chapters 3 · attachments 2 · Skill Summary, House style',
    );
    expect(contextItems({ tool: 'polish', ...c })).toEqual(['transcript 12 paragraphs', 'attachments 2', 'Skill Summary, House style']);
  });

  it('选了某一章时写章名；单数；中文', () => {
    expect(contextItems({ tool: 'blog', paragraphs: 1, scope: 'Chapter 2 · Intro', chapters: 0, attachments: 0, skills: [] })).toEqual([
      'transcript · Chapter 2 · Intro 1 paragraph',
    ]);
    use('zh-Hans');
    expect(contextLine(contextItems({ tool: 'summary', paragraphs: 5, scope: null, chapters: 2, attachments: 0, skills: [] }))).toBe(
      '发给模型的：提示词 + 文稿 5 段 · 章节 2 章',
    );
  });

  it('skill 名字按各语言自己的列举写法：中文日文用「、」，不写成句子里的「和」', () => {
    const c = { tool: 'summary' as const, paragraphs: 0, scope: null, chapters: 0, attachments: 0, skills: ['总结', '我的风格', '三点'] };
    use('zh-Hans');
    expect(contextItems(c)).toEqual(['Skill 总结、我的风格、三点']);
    use('ja');
    expect(contextItems(c)).toEqual(['Skill 总结、我的风格、三点']);
    use('de');
    expect(contextItems(c)).toEqual(['Skill 总结, 我的风格, 三点']);
  });
});

describe('主按钮下那行', () => {
  it('写进视频的工具：完成即应用、一键撤销；云端按用量计费', () => {
    expect(directHint({ tool: 'polish', model: 'gpt-5-mini', local: false })).toBe(
      'Calls gpt-5-mini directly, no conversation; applies when done, one-step undo. Cloud models bill by usage.',
    );
  });

  it('只给结果的工具：给你读、拷走，不写进视频；本机模型不出本机', () => {
    expect(directHint({ tool: 'summary', model: 'Qwen3 4B', local: true })).toBe(
      'Calls Qwen3 4B directly, no conversation; the result is for you to read and copy, nothing is written to the video. Local model, stays on this computer.',
    );
    expect(directHint({ tool: 'desc', model: null, local: false })).toMatch(/^Calls a model directly/);
    use('zh-Hans');
    expect(directHint({ tool: 'chapters', model: 'gpt-5-mini', local: false })).toBe(
      '直接调 gpt-5-mini，不经过对话；完成即应用，可一键撤销。云端模型按用量计费。',
    );
  });
});

describe('范围里的段数与流程参数', () => {
  it('段里有词落在范围内就算；整段剪掉的不算', () => {
    const paragraphs = [para([0, 1], [1, 2]), para([5, 6]), { words: [{ placements: [] }] }, para([9, 10])];
    expect(scopedParagraphs(paragraphs, null)).toBe(3);
    expect(scopedParagraphs(paragraphs, { start: 1.5, end: 9 })).toBe(2);
    expect(scopedParagraphs(paragraphs, { start: 20, end: 30 })).toBe(0);
  });

  it('只带给了的项；章节不带范围', () => {
    expect(
      directParams({
        videoId: 'vid',
        tool: 'summary',
        prompt: 'Summarize',
        range: { start: 10, end: 20 },
        documentId: 'speech',
        attachments: ['att_1'],
        skills: ['summarize', 'house-style'],
        model: { providerId: 'openai', modelId: 'gpt-5-mini' },
        uiLanguage: 'zh-Hans',
      }),
    ).toEqual({
      videoId: 'vid',
      tool: 'summary',
      prompt: 'Summarize',
      range: { start: 10, end: 20 },
      documentId: 'speech',
      attachments: ['att_1'],
      skills: [{ id: 'summarize' }, { id: 'house-style' }],
      provider: 'openai',
      model: 'gpt-5-mini',
      uiLanguage: 'zh-Hans',
    });
    // 智能体在菜单里选过推理强度时一起传（Runtime 按模型换档）。
    expect(
      directParams({
        videoId: 'vid',
        tool: 'summary',
        prompt: 'Summarize',
        range: null,
        documentId: null,
        attachments: [],
        skills: [],
        model: { providerId: 'agent:codex', modelId: 'gpt-5.5', effort: 'high' },
        uiLanguage: 'en',
      }),
    ).toMatchObject({ provider: 'agent:codex', model: 'gpt-5.5', effort: 'high' });
    expect(
      directParams({ videoId: 'vid', tool: 'chapters', prompt: 'x', range: { start: 1, end: 2 }, documentId: null, attachments: [], skills: [], model: null, uiLanguage: 'en' }),
    ).toEqual({ videoId: 'vid', tool: 'chapters', prompt: 'x', uiLanguage: 'en' });
  });

  it('按主题选材时不发范围，系列只随按主题发；边界只给生成章节，选材不给润色与章节', () => {
    const base = { videoId: 'vid', prompt: 'x', range: { start: 1, end: 2 }, documentId: null, attachments: [], skills: [], model: null, uiLanguage: 'en' };
    const selection = { mode: 'topic' as const, intent: 'model choice', exclude: ['c2'] };
    expect(aiToolParamsSchema.parse(directParams({ ...base, tool: 'blog', selection, videoIds: ['v2', 'v3'], boundaries: 'topic' }))).toEqual({
      videoId: 'vid',
      tool: 'blog',
      prompt: 'x',
      uiLanguage: 'en',
      selection,
      videoIds: ['v2', 'v3'],
    });
    expect(directParams({ ...base, tool: 'summary', selection: null, videoIds: ['v2'] })).toEqual({ videoId: 'vid', tool: 'summary', prompt: 'x', uiLanguage: 'en', range: { start: 1, end: 2 } });
    expect(aiToolParamsSchema.parse(directParams({ ...base, tool: 'chapters', selection, boundaries: 'topic' }))).toEqual({
      videoId: 'vid',
      tool: 'chapters',
      prompt: 'x',
      uiLanguage: 'en',
      boundaries: 'topic',
    });
    expect(directParams({ ...base, tool: 'polish', selection })).not.toHaveProperty('selection');
  });

  it('上下文那一行：按主题写挑了几段、覆盖几章；还没预览时只说按主题挑；系列写几部视频', () => {
    const c = { tool: 'blog' as const, paragraphs: 40, scope: null, chapters: 4, attachments: 0, skills: [] };
    expect(contextItems({ ...c, topic: { paragraphs: 12, chapters: 3 }, videos: 3 })).toEqual([
      'transcript 12 passages (picked by topic, 3 chapters)',
      'series of 3 videos',
      'chapters 4',
    ]);
    expect(contextItems({ ...c, topic: { paragraphs: null, chapters: 0 } })[0]).toBe('transcript passages picked by topic');
    use('zh-Hans');
    expect(contextItems({ ...c, topic: { paragraphs: 12, chapters: 3 } })[0]).toBe('文稿 12 段（按主题挑选，覆盖 3 章）');
  });
});

describe('刷新过期译文：直接调模型', () => {
  const doc = (id: string, kind: string, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
    id,
    kind,
    name: id,
    currentRevision: '1',
    revisions: {},
    ...extra,
  });
  const documents = {
    speech: doc('speech', 'speech', { sourceAssetId: 'asset' }),
    en: doc('en', 'translation', { language: 'en', sourceDocumentId: 'speech' }),
    ja: doc('ja', 'translation', { language: 'ja', sourceDocumentId: 'speech' }),
    stray: doc('stray', 'translation', { language: 'fr' }),
    cap: doc('cap', 'caption', { sourceDocumentId: 'en' }),
  };

  it('只列译自转写的译文', () => {
    expect(refreshableTranslations(documents).map((d) => d.id)).toEqual(['en', 'ja']);
  });

  it('刷新哪一份：选过的、入口带来的 ID、入口带来的语言名（`languageName`，各语言自称）、第一份', () => {
    const list = refreshableTranslations(documents);
    expect(pickTranslation(list, { picked: null })?.id).toBe('en');
    expect(pickTranslation(list, { picked: null, presetLanguage: '日本語' })?.id).toBe('ja');
    expect(pickTranslation(list, { picked: null, presetId: 'ja', presetLanguage: 'English' })?.id).toBe('ja');
    expect(pickTranslation(list, { picked: 'en', presetId: 'ja' })?.id).toBe('en');
    // 选过的那份没了：退回入口带来的。
    expect(pickTranslation(list, { picked: 'gone', presetId: 'ja' })?.id).toBe('ja');
    expect(pickTranslation([], { picked: null, presetId: 'ja' })).toBeNull();
  });

  it('要重译的句数：过期（标了的、原文改过的）加还没有译文的；原句没了的不算', () => {
    const row = (state: PairRow['state']) => ({ state }) as PairRow;
    const rows = ['ok', 'marked-stale', 'source-changed', 'untranslated', 'empty', 'sentence-gone', 'ok'].map((s) => row(s as PairRow['state']));
    expect(refreshCounts(rows)).toEqual({ todo: 4, stale: 2, untranslated: 2 });
    expect(refreshCounts([row('ok' as PairRow['state'])])).toEqual({ todo: 0, stale: 0, untranslated: 0 });
  });
});
