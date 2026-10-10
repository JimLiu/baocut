import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale, type Locale } from '@baocut/protocol';
import {
  contextItems,
  contextLine,
  directBlocked,
  directCta,
  directHasScope,
  directHint,
  directParams,
  directTool,
  needsStructuredOutput,
  scopedParagraphs,
} from './ai-tool-direct.ts';

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
  it('润色、章节与写作发布类能直接调模型；重新转录、找可剪的口、重译过期句、做封面置灰并写各自的原因', () => {
    for (const tool of ['polish', 'chapters', 'summary', 'blog', 'title', 'desc'] as const) {
      expect(directTool(tool)).toBe(tool);
      expect(directBlocked(tool)).toBeNull();
    }
    const reasons = (['retranscribe', 'cleanup', 'stale', 'cover'] as const).map((tool) => {
      expect(directTool(tool)).toBeNull();
      return directBlocked(tool);
    });
    expect(new Set(reasons).size).toBe(4);
    expect(reasons[3]).toMatch(/images/);
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
      'Sent to the model: prompt + transcript 12 paragraphs · chapters 3 · attachments 2 · Skill Summary and House style',
    );
    expect(contextItems({ tool: 'polish', ...c })).toEqual(['transcript 12 paragraphs', 'attachments 2', 'Skill Summary and House style']);
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
    });
    expect(
      directParams({ videoId: 'vid', tool: 'chapters', prompt: 'x', range: { start: 1, end: 2 }, documentId: null, attachments: [], skills: [], model: null }),
    ).toEqual({ videoId: 'vid', tool: 'chapters', prompt: 'x' });
  });
});
