import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../state/editor-store.ts';
import { DraftDocuments, draftedBody, dropStaleDraft } from './draft-documents.ts';

// Node 里没有可用的 localStorage：给持久化一个内存版本，先于 store 模块加载。
vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
});

const draft = { documentId: 'doc_style', baseRevision: 'r1', body: { y: 40 } };

describe('文档草稿', () => {
  beforeEach(() => useEditor.setState({ documentDraft: null }));

  it('草稿所基于的版本取草稿；别的文档不受影响', () => {
    expect(draftedBody(draft, 'doc_style', 'r1', { y: 86 })).toEqual({ y: 40 });
    expect(draftedBody(draft, 'doc_other', 'r1', { y: 86 })).toEqual({ y: 86 });
    expect(draftedBody(null, 'doc_style', 'r1', { y: 86 })).toEqual({ y: 86 });
  });

  it('提交后的新版本还没取到时先用草稿，取到之后用新正文', () => {
    expect(draftedBody(draft, 'doc_style', 'r2', undefined)).toEqual({ y: 40 });
    expect(draftedBody(draft, 'doc_style', 'r2', { y: 41 })).toEqual({ y: 41 });
  });

  it('新版本的正文到了就丢掉草稿；同一版本的不丢', () => {
    useEditor.setState({ documentDraft: draft });
    dropStaleDraft('doc_style', 'r1', { y: 86 });
    expect(useEditor.getState().documentDraft).toBe(draft);
    dropStaleDraft('doc_style', 'r2', undefined);
    expect(useEditor.getState().documentDraft).toBe(draft);
    dropStaleDraft('doc_style', 'r2', { y: 41 });
    expect(useEditor.getState().documentDraft).toBeNull();
  });

  it('预览来源叠上草稿，草稿变了通知重画', () => {
    const bodies = new Map([['doc_style@r1', { y: 86 }]]);
    const inner = { peek: (id: string, rev: string) => bodies.get(`${id}@${rev}`), load: vi.fn(), subscribe: () => () => {} };
    const documents = new DraftDocuments(inner);
    const listener = vi.fn();
    const off = documents.subscribe(listener);
    expect(documents.peek('doc_style', 'r1')).toEqual({ y: 86 });
    useEditor.setState({ documentDraft: draft });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(documents.peek('doc_style', 'r1')).toEqual({ y: 40 });
    off();
    useEditor.setState({ documentDraft: null });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('提交后预览自己去取新版本，取到就丢掉草稿：撤销回到旧版本时画旧正文，不再露出草稿', async () => {
    const bodies = new Map<string, unknown>([['doc_style@r1', { y: 86 }]]);
    const inner = { peek: (id: string, rev: string) => bodies.get(`${id}@${rev}`), load: vi.fn(), subscribe: () => () => {} };
    const documents = new DraftDocuments(inner);
    useEditor.setState({ documentDraft: draft });
    // 提交了，文档到了 r2，正文还没取到：先画草稿，并且去取 r2（预览拿到的不是 undefined，自己不会去取）。
    expect(documents.peek('doc_style', 'r2')).toEqual({ y: 40 });
    expect(inner.load).toHaveBeenCalledWith('doc_style', 'r2');
    bodies.set('doc_style@r2', { y: 40 });
    expect(documents.peek('doc_style', 'r2')).toEqual({ y: 40 });
    await Promise.resolve();
    expect(useEditor.getState().documentDraft).toBeNull();
    // 撤销：文档回到 r1。
    expect(documents.peek('doc_style', 'r1')).toEqual({ y: 86 });
    // 拖动中（还在草稿所基于的版本上）不去取。
    inner.load.mockClear();
    useEditor.setState({ documentDraft: draft });
    documents.peek('doc_style', 'r1');
    expect(inner.load).not.toHaveBeenCalled();
  });
});
