import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AssetRecord, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { langName } from '../../model/tools-models.ts';
import { contentCounts, editorExtras, snapshotFacts, translationTargets } from '../../model/video-info.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { canEdit, type OpenVideo } from '../../state/video-store.ts';
import { VideoInfoDialog } from '../video-info-dialog.tsx';
import { useEditorActions } from './editor-context.tsx';
import { mediaCandidates } from './transcribe-run.ts';
import { VIDEO_BAR_COPY as VB } from './video-bar-copy.ts';

const NO_ASSETS: Record<Id, AssetRecord> = {};
const NO_DOCUMENTS: Record<Id, DocumentRecord> = {};

/**
 * 编辑器顶栏 ⓘ 打开的视频详情：事实都从打开的视频快照与转写正文里来。正文与文稿面板同一份缓存，面板没取过时按同样方式取。
 * 名字经 `renameVideo` 改，与点标题改名是同一笔修改；视频暂时不能修改时名称置灰。
 */
export function EditorVideoInfo({ video, sequence, onClose }: { video: OpenVideo; sequence: Sequence | null; onClose(): void }) {
  const { apply } = useEditorActions();
  const snapshot = video.state?.video ?? null;
  const assets = snapshot?.assets ?? NO_ASSETS;
  const documents = snapshot?.documents ?? NO_DOCUMENTS;
  const candidates = useMemo(() => (sequence ? mediaCandidates(sequence, assets, documents) : []), [sequence, assets, documents]);
  const speeches = useMemo(() => candidates.flatMap((c) => (c.speech ? [{ assetId: c.asset.id, record: c.speech }] : [])), [candidates]);
  const bodies = useDocumentBodies(speeches.map((s) => s.record));

  const title = snapshot?.name ?? video.ref?.name ?? VB.untitled;
  const facts = snapshotFacts({
    title,
    location: video.ref?.path ?? null,
    sequence,
    candidates,
    speechBody: bodies[0],
    languageName: langName,
  });
  const extras = sequence
    ? editorExtras(
        contentCounts(
          sequence,
          speeches.map((s, i) => ({ assetId: s.assetId, body: bodies[i] })),
        ),
        translationTargets(documents, langName),
      )
    : [];

  return (
    <VideoInfoDialog
      facts={facts}
      extras={extras}
      onRename={canEdit(video) ? async (name) => (await apply([{ type: 'renameVideo', name }], VB.rename)) !== null : undefined}
      onClose={onClose}
    />
  );
}

/** 几份文档的正文（同 `useDocumentBody`，一次接一组）：没取到的先是 undefined，取到了重画。 */
function useDocumentBodies(records: readonly DocumentRecord[]): unknown[] {
  const documents = useRuntime().videos.documents;
  const keys = records.map((r) => `${r.id}@${r.currentRevision}`).join('|');
  useEffect(() => {
    for (const record of records) documents.load(record.id, record.currentRevision);
    // keys 已经概括了 records 里要取的东西。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, keys]);
  const subscribe = useCallback((listener: () => void) => documents.subscribe(listener), [documents]);
  // 快照取一个字符串签名，免得每次渲染都是新数组；真正的正文在渲染时 peek。
  useSyncExternalStore(subscribe, () => records.map((r) => (documents.peek(r.id, r.currentRevision) === undefined ? 0 : 1)).join(''));
  return records.map((r) => documents.peek(r.id, r.currentRevision));
}
