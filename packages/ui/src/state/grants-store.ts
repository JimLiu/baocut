import { create } from 'zustand';
import type { Grant, GrantsEvent, GrantsSnapshot } from '@baocut/protocol';

/** 数据外发授权的镜像（`grants` 主题，架构设计 §12.5）：快照连已结束的（撤销、到期、用完）一起给。 */
export interface GrantsStore {
  ready: boolean;
  grants: Grant[];
  replace(snapshot: GrantsSnapshot): void;
  apply(event: GrantsEvent): void;
}

export const useGrants = create<GrantsStore>()((set) => ({
  ready: false,
  grants: [],
  replace: (snapshot) => set({ ready: true, grants: snapshot.grants }),
  apply: (event) =>
    set((s) => {
      if (event.type === 'grant.removed') return { grants: s.grants.filter((g) => g.grantId !== event.grantId) };
      const at = s.grants.findIndex((g) => g.grantId === event.grant.grantId);
      if (at < 0) return { grants: [...s.grants, event.grant] };
      const grants = [...s.grants];
      grants[at] = event.grant;
      return { grants };
    }),
}));
