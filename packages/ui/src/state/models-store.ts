import { create } from 'zustand';
import { applyModelsEvent } from '@baocut/client';
import type { ModelBundleStatus, ModelCapabilitiesView, ModelsEvent, ModelsSnapshot } from '@baocut/protocol';

/** 模型服务的只读视图镜像（架构设计 §6.8）：每种能力下各 Provider 的模型、默认值与可用性，加上本地模型包的状态。 */
export interface ModelsStore {
  ready: boolean;
  capabilities: ModelCapabilitiesView | null;
  bundles: ModelBundleStatus[];
  replace(snapshot: ModelsSnapshot): void;
  apply(event: ModelsEvent): void;
}

export const useModels = create<ModelsStore>()((set) => ({
  ready: false,
  capabilities: null,
  bundles: [],
  replace: (snapshot) => set({ ready: true, capabilities: snapshot.capabilities, bundles: snapshot.bundles }),
  apply: (event) =>
    set((s) => {
      // 快照到之前不会有 bundle 事件；真来了也只是先记下这一个包。
      const base: ModelsSnapshot = { capabilities: s.capabilities as ModelCapabilitiesView, bundles: s.bundles };
      const next = applyModelsEvent(base, event);
      return { ready: next.capabilities !== null, capabilities: next.capabilities, bundles: next.bundles };
    }),
}));
