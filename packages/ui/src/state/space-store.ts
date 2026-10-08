import { create } from 'zustand';
import { applySpaceEvent } from '@baocut/client';
import type { SpaceEntry, SpaceEvent, SpaceScanIssue, SpaceSnapshot } from '@baocut/protocol';

/** Space 目录的镜像（架构设计 §5.7）。只由 Runtime 的快照与事件改写。 */
export interface SpaceStore {
  ready: boolean;
  scanning: boolean;
  entries: SpaceEntry[];
  issues: SpaceScanIssue[];
  replace(snapshot: SpaceSnapshot): void;
  apply(event: SpaceEvent): void;
}

export const useSpace = create<SpaceStore>()((set) => ({
  ready: false,
  scanning: true,
  entries: [],
  issues: [],
  replace: (snapshot) => set({ ready: true, ...snapshot }),
  apply: (event) => set((s) => applySpaceEvent(s, event)),
}));
