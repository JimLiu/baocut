import { useCallback } from 'react';
import type { ServiceConfigureParams, ServiceStatus } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { SERVICE_COPY, SERVICES_PAGE_COPY } from '../../copy.ts';
import { runtimeServiceId, serviceErrorMessage, type ServiceId } from '../../model/services.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useServices } from '../../state/services-store.ts';
import { COMMON_COPY } from './services-copy.ts';
import { useFlipShare } from './use-share-status.ts';

/*
 * 服务页的动作（架构设计 §4.8）：起停、改配置、复制。结果都经 `services` 主题回到 services-store；
 * 这里只把返回的状态先灌一次（主题的事件随后到，内容相同），并给一句提示。
 */

/** 把一项服务的新状态写进镜像（不等主题事件，按钮立刻跟上）。 */
export function putService(service: ServiceStatus) {
  useServices.getState().apply({ type: 'service.updated', service });
}

function failed(error: unknown) {
  ToastQueue.negative(SERVICES_PAGE_COPY.failed(serviceErrorMessage(error)), { timeout: 5000 });
}

/**
 * 起停一项服务（总览行与服务卡共用）。远端算力走 `nodes.share.*`（共享状态更细，见 use-share-status.ts）；
 * 其余走 `services.start` / `services.stop`。端口被占用时 `services.start` 照常返回、状态是 `error`，这时说原因。
 */
export function useFlipService(id: ServiceId): (on: boolean) => void {
  const runtime = useRuntime();
  const flipShare = useFlipShare();
  return useCallback(
    (on: boolean) => {
      if (id === 'remote') return flipShare(on);
      const name = SERVICE_COPY[id].name;
      const serviceId = runtimeServiceId(id);
      (on ? runtime.startService(serviceId) : runtime.stopService(serviceId))
        .then((service) => {
          putService(service);
          if (!on) ToastQueue.neutral(COMMON_COPY.stopped(name), { timeout: 3000 });
          else if (service.state === 'error') ToastQueue.negative(COMMON_COPY.startFailed(service.error ?? COMMON_COPY.errorFix), { timeout: 5000 });
          else ToastQueue.positive(COMMON_COPY.started(name), { timeout: 3000 });
        })
        .catch(failed);
    },
    [runtime, flipShare, id],
  );
}

/**
 * 改一项服务的配置：立即生效。成功时给 `done` 那句（不给就不提示），失败说原因；返回是否成功。
 * 开着（或出错）的服务改了端口会按新端口重开：新端口被占用时配置照样保存、服务进入 `error`，这时说没能重启与原因。
 */
export function useConfigureService(): (params: ServiceConfigureParams, done?: string) => Promise<boolean> {
  const runtime = useRuntime();
  return useCallback(
    async (params, done) => {
      try {
        const before = useServices.getState().services.find((s) => s.serviceId === params.serviceId);
        const service = await runtime.configureService(params);
        putService(service);
        // 原本好好的、或原本就出错但这次换了原因（例如为躲开被占的端口换了一个，新端口也被占）都要说；原因没变就不重复。
        if (service.state === 'error' && (before?.state !== 'error' || before.error !== service.error))
          ToastQueue.negative(COMMON_COPY.restartFailed(service.error ?? COMMON_COPY.errorFix), { timeout: 5000 });
        else if (done) ToastQueue.neutral(done, { timeout: 3000 });
        return true;
      } catch (error) {
        failed(error);
        return false;
      }
    },
    [runtime],
  );
}

/** 复制到剪贴板并提示「…已复制」；剪贴板不可用时请用户自己选中复制。 */
export function copyText(text: string, label: string) {
  if (!navigator.clipboard) {
    ToastQueue.negative(COMMON_COPY.copyFailed, { timeout: 5000 });
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => ToastQueue.positive(COMMON_COPY.copied(label), { timeout: 2000 }),
    () => ToastQueue.negative(COMMON_COPY.copyFailed, { timeout: 5000 }),
  );
}

/** 失败的通用提示（客户端、别名、会话等子动作共用）。 */
export const toastFailure = failed;
