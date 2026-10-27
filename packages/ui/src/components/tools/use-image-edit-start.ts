import { useRef, useState } from 'react';
import { newId, type GrantRequestItem } from '@baocut/protocol';
import { grantAndRestart, startTool, type PipelineRequest, type StartOutcome } from '../../model/tool-runs.ts';
import { useRuntime } from '../../runtime/context.tsx';

interface Ask {
  /** 提交时表单的样子：表单改了，这次授权请求作废。 */
  key: string;
  request: PipelineRequest;
  commandId: string;
  items: GrantRequestItem[];
  /** 这一轮（同一个 commandId）发放过的项。 */
  granted: Set<string>;
}

export interface ImageEditStart {
  /** 当前表单被当场授权拒绝、等用户同意的那几项；表单改了就没了。 */
  asking: GrantRequestItem[] | null;
  busy: boolean;
  start(request: PipelineRequest): void;
  /** 同意：逐项发放，再用同一个 commandId 重提。 */
  agree(): void;
}

/**
 * 图片处理的提交（同视频工具的 `useToolStart`）：每次开始一个新的 commandId；在线模型被当场授权拒绝时把待批准项交给页面
 * （授权卡），用户同意后发放并用同一个 commandId 重提。`key` 是表单的样子，改了就作废这次授权请求。
 */
export function useImageEditStart(key: string, handlers: { started: () => void; failed: (error: Error) => void }): ImageEditStart {
  const session = useRuntime();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const run = (work: () => Promise<StartOutcome>, base: Omit<Ask, 'items'>) => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    void work()
      .then((outcome) => {
        if (outcome.kind === 'grants') {
          setAsk({ ...base, items: outcome.items });
          return;
        }
        setAsk(null);
        if (outcome.kind === 'started') handlers.started();
        else handlers.failed(outcome.error);
      })
      .finally(() => {
        inflight.current = false;
        setBusy(false);
      });
  };

  return {
    asking: ask && ask.key === key ? ask.items : null,
    busy,
    start(request) {
      const base = { key, request, commandId: newId('cmd'), granted: new Set<string>() };
      run(() => startTool(session, request, base.commandId), base);
    },
    agree() {
      if (!ask || ask.key !== key) return;
      const { items, ...base } = ask;
      run(() => grantAndRestart(session, base.request, base.commandId, items, base.granted), base);
    },
  };
}
