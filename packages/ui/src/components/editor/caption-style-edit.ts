import type { DocumentRecord, EditOperation, Sequence, TransactionReceipt } from '@baocut/protocol';
import { withCaptionStyle } from '../../model/caption-lines.ts';
import { captionStyleOperations } from '../../model/caption-presets.ts';
import type { Json, LineKind } from '../../render/text-style.ts';
import { useCaptionPreferences } from '../../state/caption-preferences-store.ts';
import { useEditor } from '../../state/editor-store.ts';

/**
 * 字幕样式的一笔修改（属性页与舞台上拖字幕共用）：拖动中的值叠给预览（store 的文档草稿，见 video-editor 的 DraftDocuments），
 * 松手写入文档的新版本。字幕还没有样式文档时没有草稿可叠，松手新建一份，并让序列里还没有样式、能改的字幕都用它。
 */

/** 拖动中：把这份根样式叠给预览。 */
export function previewCaptionStyle(record: DocumentRecord | undefined, body: unknown, style: Json): void {
  if (!record) return;
  useEditor.getState().setDocumentDraft({ documentId: record.id, baseRevision: record.currentRevision, body: withCaptionStyle(body, style) });
}

/**
 * 松手：写入（或新建）样式文档，失败就丢掉草稿。成功后把这一笔记进新字幕选项（`before` 是改之前的根样式；
 * `singleLine` 见 `rememberCaptionPreferences`）。
 */
export function saveCaptionStyle(
  apply: (operations: EditOperation[], label?: string) => Promise<TransactionReceipt | null>,
  edit: { sequence: Sequence; record: DocumentRecord | undefined; body: unknown; before: Json | null; style: Json; label: string },
  singleLine?: LineKind,
): void {
  const { sequence, record, body, before, style, label } = edit;
  const nextBody = withCaptionStyle(body, style);
  let operations: EditOperation[];
  if (record) {
    useEditor.getState().setDocumentDraft({ documentId: record.id, baseRevision: record.currentRevision, body: nextBody });
    operations = [{ type: 'putDocument', documentId: record.id, kind: record.kind, body: nextBody }];
  } else {
    operations = captionStyleOperations(sequence, undefined, nextBody);
  }
  void apply(operations, label).then((receipt) => {
    if (!receipt) useEditor.getState().clearDrafts();
    else if (before) useCaptionPreferences.getState().remember(before, style, singleLine);
  });
}
