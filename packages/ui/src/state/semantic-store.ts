import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import type { SemanticIndexStatus } from '@baocut/protocol';
import { useRuntime } from '../runtime/context.tsx';
import { indexUpdating, visualUpdating } from '../model/semantic-status.ts';
import { useModels } from './models-store.ts';

/**
 * 本机语义索引的总体状态（`space.indexStatus`，创作辅助集成设计 §2.11）：设置 › 语义索引与各入口的那一句共用一份。
 * 用到时取（离上次超过几秒才再取）；装上或删掉文字搜索模型包时重取；`poll` 的地方在索引没跟上时每隔几秒再取。
 * Web 同样能取（白名单含 `space.indexStatus`）。
 */
interface SemanticState {
  status: SemanticIndexStatus | null;
  error: string | null;
  at: number;
}

export const useSemanticState = create<SemanticState>()(() => ({ status: null, error: null, at: 0 }));

const FRESH_MS = 5_000;
const POLL_MS = 4_000;
let inflight: Promise<void> | null = null;

function load(client: ReturnType<typeof useRuntime>['client']): Promise<void> {
  inflight ??= client
    .request('space.indexStatus', {})
    .then(
      (status) => useSemanticState.setState({ status, error: null, at: Date.now() }),
      (error: unknown) => useSemanticState.setState({ error: error instanceof Error ? error.message : String(error), at: Date.now() }),
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 文字搜索模型包装没装好的指纹：变了就重取状态。 */
function embedKey(bundles: ReturnType<typeof useModels.getState>['bundles']): string {
  return bundles
    .filter((b) => b.capability === 'embed')
    .map((b) => `${b.bundleId}:${b.state}`)
    .join(',');
}

export function useSemanticStatus(options: { poll?: boolean } = {}): SemanticState & { refresh: () => Promise<void> } {
  const runtime = useRuntime();
  const state = useSemanticState();
  const models = useModels((s) => embedKey(s.bundles));
  const refresh = useCallback(() => load(runtime.client), [runtime]);
  useEffect(() => {
    if (Date.now() - useSemanticState.getState().at > FRESH_MS) void refresh();
  }, [refresh]);
  useEffect(() => {
    if (useSemanticState.getState().at > 0) void refresh();
  }, [models, refresh]);
  const updating = (indexUpdating(state.status) || visualUpdating(state.status)) && !state.status?.paused;
  useEffect(() => {
    if (!options.poll || !updating) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [options.poll, updating, refresh]);
  return { ...state, refresh };
}
