import type { MessageBoxOptions } from 'electron';
import { localizeText } from '@baocut/protocol';
import { M, type MainMessages } from './main-copy.ts';
import type { ActiveWork, RemoteCall } from './runtime-supervisor.ts';

/** 退出时怎么处理自己起的 Runtime（架构设计 §2.2、产品设计 §7.8）。 */
export type QuitChoice = 'background' | 'stop' | 'cancel';

/** 按钮的顺序：第一个是缺省（回车），最后一个是取消（Esc）。 */
const CHOICES: readonly QuitChoice[] = ['background', 'stop', 'cancel'];

const BUTTONS: Record<QuitChoice, () => string> = {
  background: () => M.quitKeepRunning,
  stop: () => M.quitStop,
  cancel: () => M.cancel,
};

/** 对话框里最多列几项远端调用，多出来的合成「还有 N 项」。 */
const REMOTE_SHOWN = 5;

/**
 * 退出前要不要问、问什么。自己起的 Runtime 手上还有活时，让用户选在后台继续、停止并退出或取消；没有活、问不到，或 Runtime
 * 不是自己起的（退出本来就不停它）时不问（null），照常退出。缺省是在后台继续：回车不会丢掉进行中的工作，活做完 Runtime 自己停。
 * 已经交给 Provider 的调用一并列出：停下也不会在那边取消，仍可能计费。
 */
export function quitPrompt(work: ActiveWork | null): MessageBoxOptions | null {
  const count = work ? work.jobs + work.tasks : 0;
  if (!work || count === 0) return null;
  return {
    type: 'warning',
    message: M.quitBusyTitle(count),
    detail: M.quitBusyDetail + remoteLines(work.remote),
    buttons: CHOICES.map((choice) => BUTTONS[choice]()),
    defaultId: 0,
    cancelId: CHOICES.indexOf('cancel'),
    noLink: true,
  };
}

/** 对话框的回答对应的选择；认不得的按取消。 */
export function quitChoice(response: number): QuitChoice {
  return CHOICES[response] ?? 'cancel';
}

function remoteLines(remote: readonly RemoteCall[]): string {
  if (remote.length === 0) return '';
  const lines = remote.slice(0, REMOTE_SHOWN).map((call) => `• ${callName(call)} · ${call.provider}`);
  if (remote.length > REMOTE_SHOWN) lines.push(M.remoteMore(remote.length - REMOTE_SHOWN));
  return `\n\n${M.remoteHeading}\n${lines.join('\n')}`;
}

/** 调用出自哪里：固定流程的步骤名，否则任务种类的名字；没有任务记录的是 Agent 任务。 */
function callName(call: RemoteCall): string {
  if (call.step) return localizeText(call.step.label, call.step.labelRef);
  const kinds: MainMessages['callKind'] = M.callKind;
  if (call.kind === null) return kinds.agent;
  return Object.hasOwn(kinds, call.kind) ? kinds[call.kind as keyof typeof kinds] : kinds.task;
}

/**
 * 为让系统授权生效而重新启动时的确认（只有停止与取消：留在后台的 Runtime 是旧进程，拿不到新授权）。手上没有活时不问（null）。
 * 按钮的顺序同样是缺省在前、取消在后；回答用 `restartChoice` 解读。
 */
export function relaunchPrompt(work: ActiveWork | null): MessageBoxOptions | null {
  const count = work ? work.jobs + work.tasks : 0;
  if (!work || count === 0) return null;
  return {
    type: 'warning',
    message: M.quitBusyTitle(count),
    detail: M.relaunchBusyDetail + remoteLines(work.remote),
    buttons: [M.relaunchStop, M.cancel],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
}

/** 重新启动确认的回答：只有第一个按钮是继续。 */
export const restartChoice = (response: number): 'restart' | 'cancel' => (response === 0 ? 'restart' : 'cancel');
