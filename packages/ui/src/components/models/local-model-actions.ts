import type { Id, ModelInstallPlan, ModelInstallResult, ModelRemoveResult } from '@baocut/protocol';
import type { RuntimeSession } from '../../runtime/session.ts';

/**
 * 本地模型包的命令（架构设计 §6.3）：安装与修复的两步确认、停下、删除、检查。模型包的新状态与进度由 `models` 主题送回来，
 * 这里不改本地状态；失败原样抛给调用方（对话框留着写原因，或弹出提示）。
 */

type Session = Pick<
  RuntimeSession,
  'installModelBundle' | 'repairModelBundle' | 'cancelModelInstall' | 'removeModelBundle' | 'testModelBundle'
>;

/**
 * `complete`：自己的文件在盘上的模型包补上缺的组件（可选组件，或别的模型带来的公共组件），与 `install` 同一个请求（计划里只有
 * 缺的那几件），只是不再问许可、标题不同。
 */
export type InstallMode = 'install' | 'complete' | 'repair';

function call(session: Session, mode: InstallMode, bundleId: string, confirmBytes?: number): Promise<ModelInstallResult> {
  return mode === 'repair' ? session.repairModelBundle(bundleId, confirmBytes) : session.installModelBundle(bundleId, confirmBytes);
}

/** 第一步：只拿计划，不下载（修复时 Runtime 会先把已装的文件校验一遍）。 */
export function planInstall(session: Session, mode: InstallMode, bundleId: string): Promise<ModelInstallResult> {
  return call(session, mode, bundleId);
}

export type ConfirmOutcome =
  /** 提交了安装任务（同一个模型包已经在装时是那个任务）。 */
  | { kind: 'started'; jobId: Id }
  /** 要下载的大小变了：按新计划再确认一次。 */
  | { kind: 'replan'; plan: ModelInstallPlan }
  /** 已经齐全，没有要下载的。 */
  | { kind: 'up-to-date'; plan: ModelInstallPlan };

/** 第二步：把计划里的 `confirmBytes` 原样交回去。大小变了（`MODEL_INSTALL_SIZE_CHANGED`）时带回新计划，不算失败。 */
export async function confirmInstall(session: Session, mode: InstallMode, plan: ModelInstallPlan): Promise<ConfirmOutcome> {
  let result: ModelInstallResult;
  try {
    result = await call(session, mode, plan.bundleId, plan.confirmBytes);
  } catch (error) {
    const details = (error as { details?: { code?: unknown; plan?: ModelInstallPlan } } | null)?.details;
    if (details?.code === 'MODEL_INSTALL_SIZE_CHANGED' && details.plan) return { kind: 'replan', plan: details.plan };
    throw error;
  }
  if (result.jobId) return { kind: 'started', jobId: result.jobId };
  return result.plan.upToDate ? { kind: 'up-to-date', plan: result.plan } : { kind: 'replan', plan: result.plan };
}

/** 停下安装：`discard` 为 false 时保留已经收到的部分（下次续传），为 true 时一并删掉。 */
export async function stopInstall(session: Session, bundleId: string, discard: boolean): Promise<void> {
  await session.cancelModelInstall(bundleId, discard);
}

/** 删除模型包；别的模型包还在用的共享组件 Runtime 会保留，结果里列出。 */
export function removeBundle(session: Session, bundleId: string): Promise<ModelRemoveResult> {
  return session.removeModelBundle(bundleId);
}

/** 检查：返回任务 ID，结论记在模型包的 `selfTest` 上。 */
export function startSelfTest(session: Pick<Session, 'testModelBundle'>, bundleId: string): Promise<Id> {
  return session.testModelBundle(bundleId);
}
