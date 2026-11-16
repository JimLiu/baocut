import { useCallback } from 'react';
import type { DocumentRecord, Id, ScreenViewBody, RecordingBody } from '@baocut/protocol';
import { patchView, readRecording, readScreenView } from '../../model/screen-view.ts';
import type { DocumentChange } from '@baocut/protocol';
import { useEditorActions } from './editor-context.tsx';
import { useDocumentBody } from './use-document-body.ts';

export interface ScreenViewState {
  documentId: Id;
  /** 取景文档的正文；还没取到或不是这个格式时 null。 */
  view: ScreenViewBody | null;
  /** 文档头指向的录制清单；普通视频的取景没有。 */
  recording: RecordingBody | null;
  /** 写一笔取景文档的修改（空表不提交）。 */
  patch(changes: DocumentChange[]): void;
}

/** 一份屏幕取景文档与它的录制清单（屏幕录制设计 §5）。 */
export function useScreenView(documents: Record<Id, DocumentRecord>, documentId: Id): ScreenViewState {
  const { apply } = useEditorActions();
  const record = documents[documentId];
  const view = readScreenView(useDocumentBody(record));
  const manifest = record?.sourceDocumentId ? documents[record.sourceDocumentId] : undefined;
  const recording = readRecording(useDocumentBody(manifest));
  const patch = useCallback(
    (changes: DocumentChange[]) => {
      if (changes.length) void apply([patchView(documentId, changes)]);
    },
    [apply, documentId],
  );
  return { documentId, view, recording, patch };
}
