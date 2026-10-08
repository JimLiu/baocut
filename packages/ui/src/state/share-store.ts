import { create } from 'zustand';
import type { PairedNode, ShareStatus } from '@baocut/protocol';
import type { ServicePhase } from '../model/services.ts';

/**
 * 远端算力的镜像：`nodes.share.status` 的最近一次结果、起停中的那一两秒、已配对节点的最近一次 `nodes.list`。
 * 节点协议没有订阅主题，服务页可见时轮询刷新（见 components/services/use-share-status.ts）；rail 的角标与侧栏的灯读同一份。
 */
export interface ShareStore {
  status: ShareStatus | null;
  phase: ServicePhase | null;
  nodes: PairedNode[] | null;
  setStatus(status: ShareStatus | null): void;
  setPhase(phase: ServicePhase | null): void;
  setNodes(nodes: PairedNode[] | null): void;
}

export const useShare = create<ShareStore>()((set) => ({
  status: null,
  phase: null,
  nodes: null,
  setStatus: (status) => set({ status }),
  setPhase: (phase) => set({ phase }),
  setNodes: (nodes) => set({ nodes }),
}));
