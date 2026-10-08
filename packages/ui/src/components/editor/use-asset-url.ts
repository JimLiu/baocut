import { useCallback, useEffect, useRef, useState } from 'react';
import type { Id, VersionRef } from '@baocut/protocol';
import { useRuntime } from '../../runtime/context.tsx';
import { mediaUrlKey } from '../../runtime/media-url-cache.ts';
import { useConnection } from '../../state/connection-store.ts';

/**
 * 视频素材的媒体地址（架构设计 §4.5）。句柄有期限，Runtime 重启后旧地址失效：
 * 媒体元素报错时调用 `retry` 重新取一次；重新连上之后也重新取。
 * 地址经视频控制器的地址缓存要（同一素材版本共用一个请求）；缓存里已有新鲜的地址时第一次渲染就给出。
 */
export function useAssetUrl(videoId: Id | null, asset: VersionRef): { url: string | null; error: string | null; retry(): void } {
  const urls = useRuntime().videos.mediaUrls;
  const connected = useConnection((s) => s.state.status === 'connected');
  const key = videoId ? mediaUrlKey(videoId, asset) : null;
  const initial = () => ({ key, url: videoId ? urls.peek(videoId, asset) : null, error: null as string | null });
  const [state, setState] = useState(initial);
  // 换了素材（或视频）时不拿上一个的地址或错误顶着：先看缓存，没有就空着，等这次的结果。
  const current = state.key === key ? state : initial();
  const [attempt, setAttempt] = useState(0);
  // 这一次渲染给出去的地址：媒体元素报错时拿它去缓存里比对。
  const shown = useRef({ key, url: current.url });
  shown.current = { key, url: current.url };

  useEffect(() => {
    if (!videoId || !connected) return;
    const target = { id: asset.id, revision: asset.revision };
    const k = mediaUrlKey(videoId, target);
    // 缓存里的就是正在用的：不用再要（上千个元素同时挂上时各自都在这里停下）。
    const hit = urls.peek(videoId, target);
    if (hit && hit === shown.current.url && shown.current.key === k) return;
    let cancelled = false;
    urls.get(videoId, target).then(
      (url) => {
        if (cancelled) return;
        setState((prev) => (prev.key === k && prev.url === url && prev.error === null ? prev : { key: k, url, error: null }));
      },
      (error: Error) => !cancelled && setState({ key: k, url: null, error: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [urls, videoId, asset.id, asset.revision, connected, attempt]);

  const retry = useCallback(() => {
    // 先报错的那个把失效的地址从缓存里删掉；其余的跟上同一个新请求。
    const { key: failedKey, url: failedUrl } = shown.current;
    if (videoId && failedUrl && failedKey === mediaUrlKey(videoId, { id: asset.id, revision: asset.revision })) {
      urls.invalidate(videoId, { id: asset.id, revision: asset.revision }, failedUrl);
    }
    setAttempt((n) => (n < 3 ? n + 1 : n));
  }, [urls, videoId, asset.id, asset.revision]);
  return { url: current.url, error: current.error, retry };
}
