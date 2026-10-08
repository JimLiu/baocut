import { checkRoute, rejectionOf } from '../../model/model-check.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useModelCheck } from '../../state/model-check-store.ts';
import { useModels } from '../../state/models-store.ts';
import { startSelfTest } from './local-model-actions.ts';

/**
 * 提交一次检查：被停用的（上次加载失败）先重新启用。被拒时记进 store，写在状态行上，不弹 toast。
 * 按提交那一刻的模型包状态走：修完自动检查时，模型包可能刚刚变过。
 */
export async function startCheck(session: Pick<RuntimeSession, 'enableModelBundle' | 'testModelBundle'>, bundleId: string): Promise<void> {
  const store = useModelCheck.getState();
  store.reject(bundleId, null);
  try {
    const latest = useModels.getState().bundles.find((b) => b.bundleId === bundleId);
    if (latest && checkRoute(latest) === 'enable-then-test') await session.enableModelBundle(bundleId);
    await startSelfTest(session, bundleId);
  } catch (error) {
    store.reject(bundleId, rejectionOf(error));
  }
}
