import { describe, expect, it } from 'vitest';
import { mergeDraft, pickHandoff } from './ai-tools-handoff.ts';

const conversations = [
  { id: 'c1', projectId: 'p1' },
  { id: 'c2', projectId: 'p2' },
  { id: 'c3', projectId: null },
];

describe('交给 Agent 落到哪条会话', () => {
  it('当前会话和视频同属一个项目：就用它', () => {
    expect(pickHandoff({ source: { projectId: 'p1', conversationId: null }, current: 'c1', conversations })).toEqual({
      kind: 'existing',
      conversationId: 'c1',
    });
  });

  it('当前会话在别的项目、或不在会话里：在视频的项目里新建', () => {
    expect(pickHandoff({ source: { projectId: 'p1', conversationId: null }, current: 'c2', conversations })).toEqual({ kind: 'create', projectId: 'p1' });
    expect(pickHandoff({ source: { projectId: 'p1', conversationId: null }, current: null, conversations })).toEqual({ kind: 'create', projectId: 'p1' });
    // 列表里还没有的会话（刚删掉）不算
    expect(pickHandoff({ source: { projectId: 'p1', conversationId: null }, current: 'gone', conversations })).toEqual({ kind: 'create', projectId: 'p1' });
  });

  it('视频在一条无项目会话的目录里：用那条会话', () => {
    expect(pickHandoff({ source: { projectId: null, conversationId: 'c3' }, current: 'c1', conversations })).toEqual({
      kind: 'existing',
      conversationId: 'c3',
    });
    expect(pickHandoff({ source: { projectId: null, conversationId: 'c3' }, current: 'c3', conversations })).toEqual({
      kind: 'existing',
      conversationId: 'c3',
    });
  });

  it('没有视频、或来源的会话已经不在：交不出去', () => {
    expect(pickHandoff({ source: null, current: 'c1', conversations })).toEqual({ kind: 'none' });
    expect(pickHandoff({ source: { projectId: null, conversationId: 'gone' }, current: 'c1', conversations })).toEqual({ kind: 'none' });
    expect(pickHandoff({ source: { projectId: null, conversationId: null }, current: 'c1', conversations })).toEqual({ kind: 'none' });
  });
});

describe('填进输入框的草稿', () => {
  it('输入框是空的：就是这句', () => {
    expect(mergeDraft(undefined, '润色。')).toBe('润色。');
    expect(mergeDraft('  ', ' 润色。 ')).toBe('润色。');
  });

  it('输入框里有字：接在后面，不覆盖；同一句不重复填', () => {
    expect(mergeDraft('先看看第 2 章 ', '润色。')).toBe('先看看第 2 章\n\n润色。');
    expect(mergeDraft('先看看\n\n润色。', '润色。')).toBe('先看看\n\n润色。');
  });

  it('没有要填的：原样留着', () => {
    expect(mergeDraft('写了一半', '')).toBe('写了一半');
  });
});
