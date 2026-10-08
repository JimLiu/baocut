import { LOCALES, setLocale } from '@baocut/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_TOOL_GROUP_LABEL, AI_TOOLS, aiTool, canvasRatio, cleanupExtra, hasScope, intentPrompt, isAiToolId, LENGTHS, writingExtra } from './ai-tools.ts';

describe('AI 工具目录', () => {
  it('五组十五个工具，次序与原型一致', () => {
    expect(AI_TOOLS.map((t) => t.id)).toEqual([
      'crop',
      'shortscut',
      'polish',
      'chapters',
      'speakers',
      'retranscribe',
      'cleanup',
      'translate',
      'stale',
      'dub',
      'summary',
      'blog',
      'title',
      'desc',
      'cover',
    ]);
  });

  it('识别说话人、翻译与配音走 Runtime；裁剪与短视频还做不了并写明原因；其余交给 Agent', () => {
    expect(AI_TOOLS.filter((t) => t.tier === 'runtime').map((t) => t.id)).toEqual(['speakers', 'translate', 'dub']);
    const soon = AI_TOOLS.filter((t) => t.tier === 'soon');
    expect(soon.map((t) => t.id)).toEqual(['crop', 'shortscut']);
    for (const t of soon) expect(t.why).toMatch(/Runtime 还没有这条流程/);
    expect(aiTool('stale').tier).toBe('agent');
  });

  it('认得工具 id', () => {
    expect(isAiToolId('polish')).toBe(true);
    expect(isAiToolId('export')).toBe(false);
    expect(isAiToolId(null)).toBe(false);
  });

  it('句子里用不上范围的工具不给范围一行', () => {
    expect(hasScope('polish')).toBe(true);
    expect(hasScope('title')).toBe(true);
    expect(hasScope('chapters')).toBe(false);
    expect(hasScope('stale')).toBe(false);
  });
});

describe('交给 Agent 的意图句', () => {
  it('有片名用片名，没有说这个视频；范围缺省是全篇', () => {
    expect(intentPrompt({ tool: 'polish', title: '码与远方' })).toBe('润色「码与远方」的全篇文稿：修错字、补标点、按话题分段，不改写我的表达。');
    expect(intentPrompt({ tool: 'cleanup', title: ' ', scope: '第 2 章 · 开场' })).toBe(
      '找出这个视频第 2 章 · 开场里的口癖、长停顿和重复起句，先列出来，我确认后再剪。',
    );
  });

  it('附加要求一句一条，补句号，空的跳过', () => {
    expect(intentPrompt({ tool: 'chapters', title: 'A', extra: ['先润色并分段，再生成章节', '', null, '  不要用英文！ '] })).toBe(
      '给「A」按话题分出章节，每章起一个短标题。先润色并分段，再生成章节。不要用英文！',
    );
  });

  it('刷新过期译文：写出勾了哪几类，被剪切的那类多一句怎么处理', () => {
    expect(intentPrompt({ tool: 'stale', title: 'A', edited: true, cut: false })).toBe('「A」有几句译文过期了（原文改过），只重译这些句子，其余一个字不动。');
    expect(intentPrompt({ tool: 'stale', title: 'A', edited: 3, cut: true })).toBe(
      '「A」有几句译文过期了（3 句原文改过、原文被剪切），只重译这些句子，被剪切的按剪后的原文重译、整句剪掉的随句一起剪掉，其余一个字不动。',
    );
    expect(intentPrompt({ tool: 'stale' })).toBe('这个视频有几句译文过期了：原文改过，只重译这些句子，其余一个字不动。');
  });

  it('起标题与做封面带个数，缺省 6 个 / 3 张', () => {
    expect(intentPrompt({ tool: 'title', title: 'A', count: 8 })).toBe('给「A」起 8 个候选标题，角度各不相同，每个写一行理由，挑一个推荐。');
    expect(intentPrompt({ tool: 'title', title: 'A' })).toContain('起 6 个候选标题');
    expect(intentPrompt({ tool: 'cover', title: 'A' })).toContain('做 3 张封面候选');
  });
});

describe('设置态折成附加要求', () => {
  it('找可剪的口：全勾不加，没勾的合成一句', () => {
    expect(cleanupExtra({ fillers: true, pauses: true, repeats: true })).toEqual([]);
    expect(cleanupExtra({ fillers: false, pauses: true, repeats: false })).toEqual(['口癖不找、重复起句不找']);
  });

  it('写作：范围在最前，篇幅不进起标题与封面，视角只进博客与简介', () => {
    expect(writingExtra('blog', { scope: '第 1 章 · 开场', length: 'long', style: 'pop', language: '英语', view: 'viewer', note: ' 提一下嘉宾 ' })).toEqual([
      '只看第 1 章 · 开场',
      '篇幅：长',
      '风格：科普',
      '用英语写',
      '视角：观众',
      '提一下嘉宾',
    ]);
    expect(writingExtra('title', { length: 'short', style: 'custom', customStyle: '  像朋友聊天 ', platform: 'B 站', view: 'author' })).toEqual([
      '风格：像朋友聊天',
      '要发到：B 站，按它的规定写，写完提醒我核对',
    ]);
    // 自定义风格没写字、视角自动：都不进句子
    expect(writingExtra('desc', { style: 'custom', customStyle: ' ', view: 'auto' })).toEqual([]);
  });

  it('做封面：要说的事、画幅、封面字', () => {
    expect(writingExtra('cover', { idea: '一句话讲清', ratio: '9:16', coverText: 'phrase', length: 'long' })).toEqual([
      '封面要说的一件事：一句话讲清',
      '画幅 9:16',
      '封面上的字：一句短语',
    ]);
  });
});

describe('画布比例', () => {
  it('约成最简整数比；量不出来时按 16:9', () => {
    expect(canvasRatio(1920, 1080)).toBe('16:9');
    expect(canvasRatio(1080, 1920)).toBe('9:16');
    expect(canvasRatio(1000, 1000)).toBe('1:1');
    expect(canvasRatio(0, 1080)).toBe('16:9');
  });
});

describe('英文界面', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  const english = () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
  };

  it('工具名、分组与选项随语言换；读的是同一份目录对象', () => {
    const polish = aiTool('polish');
    expect(polish.name).toBe('润色文稿');
    english();
    expect(polish.name).toBe('Polish transcript');
    expect(AI_TOOL_GROUP_LABEL[polish.group]).toBe('Transcript');
    expect(LENGTHS.map((l) => l.label)).toEqual(['Short', 'Medium', 'Long']);
    for (const t of AI_TOOLS.filter((x) => x.tier === 'soon')) expect(t.why).toMatch(/Runtime doesn’t have this workflow yet/);
  });

  it('拉丁与西里尔界面语言的附加要求保留句末标点与句间空格', () => {
    vi.stubEnv('BAOCUT_LOCALE', undefined);
    for (const locale of LOCALES.filter((value) => !['zh-Hans', 'zh-Hant', 'ja', 'ko'].includes(value))) {
      setLocale(locale);
      const head = intentPrompt({ tool: 'polish' });
      expect(intentPrompt({ tool: 'polish', extra: ['First requirement', 'Second requirement!'] })).toBe(
        `${head} First requirement. Second requirement!`,
      );
    }
  });

  it('意图句与附加要求用英文写，句末补英文句号、句间空一格', () => {
    english();
    expect(intentPrompt({ tool: 'polish', title: 'Code', scope: 'Chapter 2 · Intro', extra: ['Keep it short', 'Thanks!'] })).toBe(
      'Polish the transcript of Chapter 2 · Intro of “Code”: fix typos, add punctuation, and split into paragraphs by topic, without rewriting my wording. Keep it short. Thanks!',
    );
    expect(intentPrompt({ tool: 'stale', edited: 1, cut: 2 })).toBe(
      'Some translations in this video are out of date (1 sentence edited in the source, 2 sentences cut in the source). Retranslate only those sentences; retranslate cut ones from the source as cut, and remove the translations of fully cut sentences along with them. Leave everything else exactly as it is.',
    );
    expect(intentPrompt({ tool: 'title' })).toContain('Suggest 6 title candidates');
    expect(cleanupExtra({ fillers: false, pauses: false, repeats: true })).toEqual(['Don’t look for filler words and long pauses']);
    expect(writingExtra('blog', { length: 'long', style: 'pop', view: 'viewer' })).toEqual(['Length: Long', 'Style: Explainer', 'Point of view: viewer']);
  });
});
