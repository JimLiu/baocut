import { setLocale } from '@baocut/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HELP_COPY } from '../copy.ts';
import { HELP_GUIDES, HELP_MORE, helpCta, quickStart, searchGuides, type HelpGuide } from './help-guides.ts';

const guide = (id: string): HelpGuide => {
  const found = HELP_GUIDES.find((g) => g.id === id);
  if (!found) throw new Error(`没有指南 ${id}`);
  return found;
};

describe('searchGuides', () => {
  it('按中英文关键词和正文里的症状检索，不分大小写', () => {
    expect(searchGuides('  CaPtIoN  ').some((g) => g.id === 'subtitle')).toBe(true);
    expect(searchGuides('画面外').some((g) => g.id === 'missing')).toBe(true);
    expect(searchGuides('字幕 不显示').map((g) => g.id)).toEqual(['missing']);
  });

  it('空查询保留目录；不匹配的查询不返回无关指南', () => {
    expect(searchGuides(' \n ')).toEqual(HELP_GUIDES);
    expect(searchGuides('不存在的帮助主题')).toEqual([]);
  });

  it('没有短名的指南不会因为空值被「null」搜中', () => {
    expect(searchGuides('null')).toEqual([]);
  });
});

describe('目录', () => {
  it('id 不重复，每篇都有三步', () => {
    expect(new Set(HELP_GUIDES.map((g) => g.id)).size).toBe(HELP_GUIDES.length);
    for (const g of HELP_GUIDES) expect(g.steps).toHaveLength(3);
  });

  it('快速上手的每篇都有路径卡短名，其余没有', () => {
    for (const g of HELP_GUIDES) expect(g.short !== null).toBe(g.group === 'start');
    expect(quickStart().map((g) => g.id)).toEqual(['import', 'subtitle', 'translate', 'export']);
  });

  it('「你可能还想了解」指向存在的指南', () => {
    for (const id of HELP_MORE) expect(HELP_GUIDES.some((g) => g.id === id)).toBe(true);
  });

  it('正文用「视频」，不写旧版的「影片」与这里没有的功能（快速修补、剪映等工程、体积估算……）', () => {
    const text = JSON.stringify(HELP_GUIDES);
    for (const word of ['影片', 'yt-dlp', '音源分离', 'AI Tools', '快速修补', '剪映', 'CapCut', 'Final Cut', 'FLAC', '估算']) expect(text).not.toContain(word);
  });
});

describe('helpCta', () => {
  it('不需要视频的去处照常', () => {
    expect(helpCta(guide('import'), false)).toEqual({ label: '从文件新建视频', target: 'new', needsVideo: false });
    expect(helpCta(guide('agent'), false).target).toBe('agent');
    expect(helpCta(guide('model'), true).target).toBe('models');
  });

  it('没开视频时，要在视频里做的换成「选择一个视频」', () => {
    for (const id of ['subtitle', 'translate', 'export', 'style', 'workspace', 'missing'])
      expect(helpCta(guide(id), false)).toEqual({ label: HELP_COPY.pickVideo, target: 'space', needsVideo: true });
  });

  it('开着视频时：字幕打开字幕页，样式与其余只回到视频', () => {
    expect(helpCta(guide('subtitle'), true)).toEqual({ label: '打开字幕面板', target: 'subtitle', needsVideo: false });
    expect(helpCta(guide('style'), true)).toEqual({ label: HELP_COPY.backToVideo, target: 'close', needsVideo: false });
    expect(helpCta(guide('reframe'), true)).toEqual({ label: HELP_COPY.backToVideo, target: 'close', needsVideo: false });
  });

  it('翻译打开字幕页（「＋ 翻译成…」在那里）；导出弹层帮助打不开，只回到视频', () => {
    expect(helpCta(guide('translate'), true)).toEqual({ label: '打开字幕面板', target: 'subtitle', needsVideo: false });
    expect(helpCta(guide('export'), true)).toEqual({ label: HELP_COPY.backToVideo, target: 'close', needsVideo: false });
  });
});

describe('英文界面', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('正文与按钮换成英文，结构不变；按英文关键词检索', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(guide('import').title).toBe('Create a video and import assets');
    for (const g of HELP_GUIDES) expect(g.steps).toHaveLength(3);
    expect(helpCta(guide('import'), false)).toEqual({ label: 'New video from file', target: 'new', needsVideo: false });
    expect(searchGuides('subtitles NOT SHOWING').map((g) => g.id)).toEqual(['missing']);
    expect(searchGuides('字幕')).toEqual([]);
  });
});
