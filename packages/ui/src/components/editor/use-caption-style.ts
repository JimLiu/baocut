import { useEffect } from 'react';
import type { CaptionItem, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { captionChips, captionKind, onScreen, type CaptionChip } from '../../model/caption-tracks.ts';
import { DEFAULT_CAPTION_STYLE, captionStyleRoot } from '../../model/property-values.ts';
import type { Json, LineKind } from '../../render/text-style.ts';
import { useEditor } from '../../state/editor-store.ts';
import { draftedBody, dropStaleDraft } from './draft-documents.ts';
import { useDocumentBody } from './use-document-body.ts';

export interface CaptionStyleState {
  /** 字幕样式文档；字幕还在用缺省样式时没有（第一次修改新建一份）。 */
  record: DocumentRecord | undefined;
  /** 正文叠上草稿；还没取到是 undefined。 */
  body: unknown;
  /** Studio 根样式；正文还没取到或样式格式认不出时是 null。 */
  root: Json | null;
  /** 这一件所在的那枚字幕轨 chip。 */
  chip: CaptionChip | undefined;
  /** 这一件是原文还是译文。 */
  own: LineKind;
  /** 画面上用这份样式的字幕（还没有样式时：同样没有样式、能改、第一次修改会一起挂上的那些）。 */
  sharing: CaptionChip[];
  /** 原文与译文共用这份样式，叠成双语两行。 */
  paired: boolean;
}

/**
 * 一条字幕的样式文档（字幕属性页与舞台上的字幕工具条共用）：正文叠上拖动中的草稿，新版本的正文到了就丢掉旧草稿；
 * 这份样式管哪几种行，原文与译文都在就是双语两行。
 */
export function useCaptionStyle(item: CaptionItem, sequence: Sequence, documents: Record<Id, DocumentRecord>): CaptionStyleState {
  const record = item.styleDocumentId ? documents[item.styleDocumentId] : undefined;
  const loaded = useDocumentBody(record);
  const draft = useEditor((s) => s.documentDraft);
  const body = record ? draftedBody(draft, record.id, record.currentRevision, loaded) : DEFAULT_CAPTION_STYLE;
  useEffect(() => {
    if (record) dropStaleDraft(record.id, record.currentRevision, loaded);
  }, [record, loaded]);
  const root = body === undefined ? null : captionStyleRoot(body);

  const chips = captionChips(sequence, documents);
  const chip = chips.find((c) => c.itemIds.includes(item.id));
  const own = captionKind(item.documentId, documents);
  const sharing = onScreen(chips).filter((c) =>
    item.styleDocumentId ? c.styleDocumentId === item.styleDocumentId : !c.styleDocumentId && !c.locked,
  );
  const paired = new Set<LineKind>([own, ...sharing.map((c) => c.kind)]).size > 1;
  return { record, body, root, chip, own, sharing, paired };
}
