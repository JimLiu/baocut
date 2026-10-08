import { create } from 'zustand';
import { applyServicesEvent } from '@baocut/client';
import type { ServiceApproval, ServiceStatus, ServicesEvent, ServicesSnapshot } from '@baocut/protocol';

/**
 * 对外服务的镜像（架构设计 §4.8；命令与协议规范 §10.4 的 `services` 主题）：每项服务的状态、配置、客户端与最近的请求，
 * 加上待处理的服务审批。只由 Runtime 的快照与事件改写；订阅由 rail 常驻的 hook 开（`RuntimeSession.watchServices`），
 * 断开时清掉，免得拿旧状态报错。总览、侧栏的灯、rail 的角标与各服务页读同一份。
 */
export interface ServicesStore {
  ready: boolean;
  services: ServiceStatus[];
  approvals: ServiceApproval[];
  replace(snapshot: ServicesSnapshot): void;
  apply(event: ServicesEvent): void;
  reset(): void;
}

export const useServices = create<ServicesStore>()((set) => ({
  ready: false,
  services: [],
  approvals: [],
  replace: (snapshot) => set({ ready: true, services: snapshot.services, approvals: snapshot.approvals }),
  apply: (event) => set((s) => applyServicesEvent({ services: s.services, approvals: s.approvals }, event)),
  reset: () => set({ ready: false, services: [], approvals: [] }),
}));
