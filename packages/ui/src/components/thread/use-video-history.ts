import { useEffect, useSyncExternalStore } from 'react';
import type { HistoryEntry, Id } from '@baocut/protocol';
import { useRuntime } from '../../runtime/context.tsx';
import { useVideo } from '../../state/video-store.ts';

/** 往回看多少笔：再早的变更卡退回按会话里记下的撤销判断。 */
const LIMIT = 200;

/**
 * 编辑器开着的那个视频的修改历史（`videos.history`），线程里所有变更卡共用一份：按「视频@版本」取一次，
 * 版本变了再取，取到之前先用上一份。`videos.history` 要视频在 Runtime 里开着，所以只在编辑器开着这个视频时有。
 */
let current: { videoId: Id; key: string; entries: HistoryEntry[] } | null = null;
let loading: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const read = () => current;

export function useVideoHistory(videoId: Id): readonly HistoryEntry[] | null {
  const runtime = useRuntime();
  const revision = useVideo((s) =>
    s.video?.videoId === videoId && s.video.status === 'ready' ? (s.video.state?.video.revision ?? null) : null,
  );
  const snapshot = useSyncExternalStore(subscribe, read);

  useEffect(() => {
    if (!revision) return;
    const key = `${videoId}@${revision}`;
    if (current?.key === key || loading === key) return;
    loading = key;
    runtime.videos
      .history(LIMIT)
      .then((entries) => {
        if (loading !== key) return;
        loading = null;
        // 取的是编辑器此刻开着的视频：中途换了视频就不收。
        if (useVideo.getState().video?.videoId !== videoId) return;
        current = { videoId, key, entries };
        for (const listener of listeners) listener();
      })
      .catch(() => {
        if (loading === key) loading = null;
      });
  }, [runtime, videoId, revision]);

  return revision && snapshot?.videoId === videoId ? snapshot.entries : null;
}
