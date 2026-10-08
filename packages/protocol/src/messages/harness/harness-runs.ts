import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './harness-runs.zh-Hans.ts';
import { zhHant } from './harness-runs.zh-Hant.ts';
import { ja } from './harness-runs.ja.ts';
import { ko } from './harness-runs.ko.ts';
import { es } from './harness-runs.es.ts';
import { fr } from './harness-runs.fr.ts';
import { de } from './harness-runs.de.ts';
import { nl } from './harness-runs.nl.ts';
import { ptBR } from './harness-runs.pt-BR.ts';
import { it } from './harness-runs.it.ts';
import { ru } from './harness-runs.ru.ts';
import { pl } from './harness-runs.pl.ts';
import { tr } from './harness-runs.tr.ts';
import { vi } from './harness-runs.vi.ts';

/** 会话里任务运行时的提示与任务失败原因（`packages/harness`）。`agent` 是 Agent 的显示名。 */
const en = {
  retrying: (p: { message: string }) => `${p.message} (retrying)`,
  modeChanged: (p: { to: string; from: string }) => `Access mode changed to "${p.to}" (was "${p.from}"). Applies to later actions.`,
  jobsCancelled: (p: { count: number }) =>
    `Requested cancellation of this session's unfinished background tasks (${p.count}). Finished results are kept.`,
  jobsCancelledGenerated: (p: { count: number }) =>
    `Requested cancellation of this session's unfinished background tasks (${p.count}, generation or transcription). Finished results are kept.`,
  goalChangedStopped: 'Goal changed: the old task was stopped. Starting a new task for the new goal.',
  goalChangedKept:
    "Goal changed: the old task's turn was stopped. Background tasks already submitted finish as usual and their outputs stay as candidates. Starting a new task for the new goal.",
  stopReplyUnconfirmed: (p: { agent: string }) => `Asked to stop replying, but couldn't confirm that ${p.agent} stopped.`,
  stopUnconfirmed: (p: { agent: string }) => `Asked to stop, but couldn't confirm that ${p.agent} stopped.`,
  stopTimedOut: (p: { agent: string }) =>
    `${p.agent} didn't confirm stopping within 10 seconds, so its process was ended. Steps not confirmed as cancelled may already have taken effect.`,
  agentRemovedNotice: (p: { agent: string }) =>
    `Agent ${p.agent} was removed, so this task didn't finish. Changes already made aren't undone automatically.`,
  agentRemoved: (p: { agent: string }) => `Agent ${p.agent} was removed`,
  runtimeStoppedNotice: 'The task was still running when the Runtime stopped, so it was interrupted.',
  runtimeExitedNotice: "The Runtime exited while the task was running, so this task didn't finish. Changes already made aren't undone automatically.",
  runtimeExited: 'The Runtime exited while the task was running',
  turnFailed: 'The turn failed',
  processExited: (p: { agent: string; error: string }) => `${p.agent} process ended unexpectedly: ${p.error}`,
  noErrorMessage: 'no error message',
  /** 文件修改审批没有说明时的摘要。 */
  fileChangeSummary: 'Edit files',
};

export type HarnessRunsMessages = typeof en;

export const HarnessRuns = defineCatalog('harnessRuns', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
