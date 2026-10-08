import type { Id, Revision } from '@baocut/protocol';
import { useEditor, type DocumentDraft } from '../../state/editor-store.ts';
import type { PreviewDocuments } from './preview-engine.ts';

/**
 * 文档正文叠上属性页的草稿（字幕样式拖动中的值）：草稿所基于的那个版本取草稿；提交之后文档有了新版本、
 * 新正文还没取到时也先用草稿，免得样式先跳回旧的再跳到新的。新正文到了就用新正文。
 */
export function draftedBody(draft: DocumentDraft | null, documentId: Id, revision: Revision, body: unknown): unknown {
  if (!draft || draft.documentId !== documentId) return body;
  return revision === draft.baseRevision || body === undefined ? draft.body : body;
}

/** 草稿已经被新版本的正文取代：丢掉，免得撤销回到旧版本时它又露出来。 */
export function dropStaleDraft(documentId: Id, revision: Revision, body: unknown): void {
  const draft = useEditor.getState().documentDraft;
  if (draft?.documentId === documentId && draft.baseRevision !== revision && body !== undefined)
    useEditor.setState({ documentDraft: null });
}

/** 给预览的文档来源：正文来自缓存，叠上草稿；草稿变了也通知重画。 */
export class DraftDocuments implements PreviewDocuments {
  readonly #inner: PreviewDocuments;

  constructor(inner: PreviewDocuments) {
    this.#inner = inner;
  }

  peek(documentId: Id, revision: Revision): unknown {
    const body = this.#inner.peek(documentId, revision);
    const draft = useEditor.getState().documentDraft;
    if (draft?.documentId === documentId && draft.baseRevision !== revision && body !== undefined)
      queueMicrotask(() => dropStaleDraft(documentId, revision, body));
    return draftedBody(draft, documentId, revision, body);
  }

  load(documentId: Id, revision: Revision): void {
    this.#inner.load(documentId, revision);
  }

  forgetPending(): void {
    this.#inner.forgetPending?.();
  }

  subscribe(listener: () => void): () => void {
    const offInner = this.#inner.subscribe(listener);
    const offDraft = useEditor.subscribe((state, previous) => {
      if (state.documentDraft !== previous.documentDraft) listener();
    });
    return () => {
      offInner();
      offDraft();
    };
  }
}
