import { useEffect, useRef } from 'react';
import { ToastQueue } from '@react-spectrum/s2';
import { REMOTE_COPY, SERVICES_PAGE_COPY } from '../../copy.ts';
import { liveApprovalCount } from '../../model/services-mcp.ts';
import { serviceStates, servicesAlert, type ServiceStates } from '../../model/services.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useServices } from '../../state/services-store.ts';
import { useShare } from '../../state/share-store.ts';
import { useNow } from '../use-now.ts';
import { flipShare, refreshNodes, refreshShare } from './share-commands.ts';

/**
 * 节点协议没有订阅主题（`nodes.*` 只有请求），共享状态靠轮询：
 * - 每次连上 Runtime 读一次（rail 的角标与侧栏的灯靠它），断开时清掉，免得拿旧状态报错；
 * - 服务页开着、窗口在前台时每 5 秒读一次 `nodes.share.status`（本机请求，便宜）；
 * - 「使用其他电脑」开着时每 15 秒读一次 `nodes.list`（每个节点要实时探测，最长 2 秒）。
 * 窗口切到后台就停，回到前台立刻读一次。
 */
export const SHARE_POLL_MS = 5_000;
export const NODES_POLL_MS = 15_000;

function useConnectionId(): string | null {
  return useConnection((s) => (s.state.status === 'connected' ? s.state.connectionId : null));
}

function useVisiblePolling(task: () => void, intervalMs: number, enabled: boolean) {
  const latest = useRef(task);
  useEffect(() => {
    latest.current = task;
  });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const sync = () => {
      if (document.visibilityState !== 'visible') return stop();
      if (timer !== null) return;
      latest.current();
      timer = setInterval(() => latest.current(), intervalMs);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [intervalMs, enabled]);
}

/** 连上就读一次共享状态，断开就清掉。只在常驻的地方挂一次（rail）。 */
function useShareOnConnect() {
  const runtime = useRuntime();
  const connectionId = useConnectionId();
  useEffect(() => {
    if (!connectionId) {
      useShare.getState().setStatus(null);
      useShare.getState().setNodes(null);
      return;
    }
    void refreshShare(runtime);
  }, [runtime, connectionId]);
}

/** 服务页开着时轮询共享状态。 */
export function useSharePolling() {
  const runtime = useRuntime();
  const connectionId = useConnectionId();
  useVisiblePolling(() => void refreshShare(runtime), SHARE_POLL_MS, connectionId !== null);
}

/** 「使用其他电脑」开着时轮询已配对的节点。 */
export function useNodesPolling() {
  const runtime = useRuntime();
  const connectionId = useConnectionId();
  useVisiblePolling(() => void refreshNodes(runtime), NODES_POLL_MS, connectionId !== null);
}

/**
 * 连上 Runtime 就订阅 `services` 主题（架构设计 §4.8；命令与协议规范 §10.4），断开时清掉镜像。客户端每个主题只留一个订阅，
 * 所以只在常驻的地方挂一次（rail）；重连后客户端自己续订、重发快照。
 */
function useServicesTopic() {
  const runtime = useRuntime();
  const connectionId = useConnectionId();
  useEffect(() => {
    if (!connectionId) {
      useServices.getState().reset();
      return;
    }
    return runtime.watchServices({
      snapshot: (snapshot) => useServices.getState().replace(snapshot),
      event: (event) => useServices.getState().apply(event),
    });
  }, [runtime, connectionId]);
}

/** 四项服务此刻的状态（总览、侧栏、rail 共用）：MCP、Web、模型接口读 `services` 主题；远端算力另有共享状态的轮询。 */
export function useServiceStates(): ServiceStates {
  const services = useServices((s) => s.services);
  const share = useShare((s) => s.status);
  const phase = useShare((s) => s.phase);
  return serviceStates(services, share, phase);
}

/** 开始 / 停止共享（服务卡与总览行共用）：成功给一句提示，失败说原因。 */
export function useFlipShare(): (on: boolean) => void {
  const runtime = useRuntime();
  return (on) => {
    flipShare(runtime, on)
      .then((status) => {
        if (!status) return;
        if (!on) ToastQueue.neutral(REMOTE_COPY.stopped, { timeout: 3000 });
        else if (status.listening) ToastQueue.positive(REMOTE_COPY.started, { timeout: 3000 });
      })
      .catch((error: Error) => ToastQueue.negative(SERVICES_PAGE_COPY.failed(error.message), { timeout: 5000 }));
  };
}

/**
 * rail「服务」的角标：有服务出错、或外部客户端的请求在等确认（服务审批，50 秒时限）时给一句读屏用的说法，否则 null。
 * 顺带负责连上时读一次共享状态、订阅 `services` 主题。有审批在等时每秒重算一次，过了时限的不再算。
 */
export function useServicesAlert(): string | null {
  useShareOnConnect();
  useServicesTopic();
  const approvals = useServices((s) => s.approvals);
  const now = useNow(1000, approvals.length > 0);
  return servicesAlert(useServiceStates(), liveApprovalCount(approvals, now));
}
