import { create } from 'zustand';
import type { ArtifactOpenResult, ArtifactsEvent, ArtifactsSnapshot, Id } from '@baocut/protocol';

/**
 * `artifacts` 主题（docs/design/artifacts §5）的界面一侧：Open Artifact 的 daemon 连上没有、智能体要给用户看的作品，
 * 以及作品页面（Shell）经 Runtime 转来的消息。`RuntimeSession.start()` 只订阅一次（同一主题再订会顶掉前一次），
 * 作品标签按视图票据登记自己要的 Shell 消息。
 */

type ShellListener = (message: unknown) => void;
type ShowListener = (conversationId: Id | null, open: ArtifactOpenResult) => void;

interface ArtifactsState extends ArtifactsSnapshot {
  /** 连上过没有：还没拿到快照时不说「不可用」。 */
  known: boolean;
}

export const useArtifacts = create<ArtifactsState>()(() => ({ available: false, error: null, known: false }));

const shellListeners = new Map<string, Set<ShellListener>>();
const showListeners = new Set<ShowListener>();

/** 一个作品标签听它那个视图的 Shell 消息；返回取消。 */
export function onShellMessage(view: string, listener: ShellListener): () => void {
  let set = shellListeners.get(view);
  if (!set) shellListeners.set(view, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) shellListeners.delete(view);
  };
}

/** 智能体要给用户看一份作品（`artifacts.show`）：由 `RuntimeSession` 决定在不在功能区的作品标签里打开。返回取消。 */
export function onArtifactShow(listener: ShowListener): () => void {
  showListeners.add(listener);
  return () => void showListeners.delete(listener);
}

/**
 * 已经由 Runtime 打开、带着视图票据的页面：作品标签先用它，不再调一次 `artifacts.open`（票据只认一次）。
 * 按作品链接存，取走就删。
 */
const preopened = new Map<string, ArtifactOpenResult>();

export function takePreopened(url: string): ArtifactOpenResult | null {
  const open = preopened.get(url) ?? null;
  preopened.delete(url);
  return open;
}

export function rememberPreopened(open: ArtifactOpenResult): void {
  preopened.set(open.url, open);
}

/** 交给 `client.subscribe('artifacts', artifactsFeed)`。 */
export const artifactsFeed = {
  snapshot(snapshot: ArtifactsSnapshot): void {
    useArtifacts.setState({ available: snapshot.available, error: snapshot.error, known: true });
  },
  event(event: ArtifactsEvent): void {
    switch (event.type) {
      case 'artifacts.state':
        useArtifacts.setState({ available: event.available, error: event.error, known: true });
        return;
      case 'artifacts.shell':
        for (const listener of shellListeners.get(event.view) ?? []) listener(event.message);
        return;
      case 'artifacts.show':
        // 由听的一方决定打不打开；打开时才 `rememberPreopened`，不打开的票据不留着（过期了再用会白开一次）。
        for (const listener of showListeners) listener(event.conversationId, event.open);
        return;
    }
  },
};
