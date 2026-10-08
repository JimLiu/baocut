import {
  defineMessages,
  localizeText,
  type ExternalToolStatus,
  type ExternalToolUpdateMethod,
  type ExternalToolUpdatePlan,
  type JobCommandRun,
  type JobRecord,
} from '@baocut/protocol';
import { zhHans } from './tool-update.zh-Hans.ts';
import { zhHant } from './tool-update.zh-Hant.ts';
import { ja } from './tool-update.ja.ts';
import { ko } from './tool-update.ko.ts';
import { es } from './tool-update.es.ts';
import { fr } from './tool-update.fr.ts';
import { de } from './tool-update.de.ts';
import { nl } from './tool-update.nl.ts';
import { ptBR } from './tool-update.pt-BR.ts';
import { it } from './tool-update.it.ts';
import { ru } from './tool-update.ru.ts';
import { pl } from './tool-update.pl.ts';
import { tr } from './tool-update.tr.ts';
import { vi } from './tool-update.vi.ts';

/** 更新下载工具的文案（译文在 `tool-update.<语言>.ts`）。「重新检测」是卡片上那颗按钮的名字。 */
const en = {
  standalone: 'Official standalone binary',
  updateInTerminal: 'Update in Terminal',
  unknownInstall: 'Can’t tell how this yt-dlp was installed. Run the command that matches how you installed it, then click “Check again”.',
  cannotRun: 'BaoCut can’t run this command for you.',
  thenRecheck: 'Then click “Check again”.',
  runThenRecheck: 'Run this command in Terminal, then click “Check again”.',
  updateWith: (method: string) => `Update with ${method}`,
  stoppedTitle: 'Update stopped',
  stoppedBody: 'The command may have only partly run. Check the output below, then click “Check again” to confirm the current yt-dlp version.',
  failedTitle: (exitCode: string | null) => (exitCode === null ? 'Update didn’t finish' : `Update didn’t finish (exit code ${exitCode})`),
  failedBody: (error: string | null) =>
    `${error ? `${error.replace(/[。.]$/, '')}. ` : ''}Your existing yt-dlp is unaffected. The output is below; you can also copy the command, run it in Terminal, then click “Check again”.`,
  updatedTo: (version: string) => `Updated to ${version}`,
  upToDate: (version: string | null) => (version ? `Already up to date (${version})` : 'Already up to date'),
  logTruncated: '… (earlier output omitted; the full output is in the task record)\n',
  logStopped: '(Stopped)',
  logExitCode: (exitCode: string) => `(Exit code ${exitCode})`,
};
export type ToolUpdateMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 按原安装方式更新下载工具（产品设计 §2.7「下载视频」，架构设计 §12.9；设计稿 model-tool-update.js）。
 *
 * 卡片里直接显示要执行的完整命令（一行代码块，右边是执行与复制）；点执行就是确认，交回的就是这一条。
 * 判断不了安装方式、或要管理员权限时不代为执行，只给命令；判断不了时列出的常用命令看 Runtime 所在主机的平台
 * （状态里的 `platform`），不看这个界面跑在哪。结束后按前后版本说结果。
 */

export const UPDATE_METHOD_LABEL: Record<ExternalToolUpdateMethod, string> = {
  homebrew: 'Homebrew',
  pipx: 'pipx',
  pip: 'pip',
  get standalone() {
    return M.standalone;
  },
  winget: 'winget',
  scoop: 'Scoop',
  chocolatey: 'Chocolatey',
};

type ManualCommand = { label: string; command: string };

const MANUAL_POSIX: readonly ManualCommand[] = [
  { label: 'Homebrew', command: 'brew upgrade yt-dlp' },
  { label: 'pip', command: 'python3 -m pip install -U "yt-dlp[default]"' },
  {
    get label() {
      return M.standalone;
    },
    command: 'yt-dlp -U',
  },
];

const MANUAL_WINDOWS: readonly ManualCommand[] = [
  { label: 'winget', command: 'winget upgrade yt-dlp.yt-dlp' },
  { label: 'Scoop', command: 'scoop update yt-dlp' },
  { label: 'pip', command: 'py -m pip install -U "yt-dlp[default]"' },
  {
    get label() {
      return M.standalone;
    },
    command: 'yt-dlp -U',
  },
];

/** 判断不了安装方式时列出的常见做法，按 Runtime 所在主机：Windows 上是 winget、Scoop、`py -m pip` 与 `-U`，其他系统是 Homebrew、pip 与 `-U`。 */
export function manualUpdateCommands(platform: string | null | undefined): readonly ManualCommand[] {
  return platform === 'win32' ? MANUAL_WINDOWS : MANUAL_POSIX;
}

/**
 * 给人看的退出码：负数或超过 0xFFFF 的（Windows 的 HRESULT 一类）按 8 位十六进制写。winget 没有可升级的版本时以
 * 0x8A15002B 退出，Runtime 把它算成成功（已是最新），输出框的最后一行照样写出这个退出码。
 */
export function exitCodeText(code: number): string {
  return code < 0 || code > 0xffff ? `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}` : String(code);
}

/**
 * 卡片里有没有「更新」一节：找到了系统里（或你指定的、环境变量指定的）那一份。BaoCut 下载的副本用卡片的主按钮换版本，
 * 没装、正在安装的没有可更新的；正在更新时总有（输出在这一节里）。
 */
export function hasUpdateSection(status: ExternalToolStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.updateJobId) return true;
  return !!status.path && status.source !== 'managed' && !status.installJobId && (!!status.update || !!status.version);
}

/** Runtime 的原因里已经写了「用管理员身份打开终端执行这条命令」的几条（rcExternalTools 目录）。 */
const SAYS_HOW_TO_RUN = new Set(
  ['wingetMachineWide', 'scoopGlobal', 'chocolateyAdmin', 'pipAdminWin', 'standaloneAdminWin'].map((name) => `rcExternalTools.${name}`),
);

/** 「更新」一节：命令上面的标签，不能代为执行时命令下面的说明。 */
export function updateSectionCopy(plan: ExternalToolUpdatePlan | null): { label: string; hint: string | null } {
  if (!plan) return { label: M.updateInTerminal, hint: M.unknownInstall };
  if (!plan.runnable) {
    const reason = localizeText(plan.reason, plan.reasonRef) ?? M.cannotRun;
    // Runtime 的原因里已经说了在终端里怎么执行（Windows 上要管理员权限的几种）时不再重复。
    const how = plan.reasonRef && SAYS_HOW_TO_RUN.has(plan.reasonRef.key) ? M.thenRecheck : M.runThenRecheck;
    return { label: M.updateInTerminal, hint: `${reason}${how}` };
  }
  return { label: M.updateWith(UPDATE_METHOD_LABEL[plan.method] ?? plan.method), hint: null };
}

/** 一次更新结束后的事实：任务的终态、命令的退出码与错误，以及前后两次探测的版本。 */
export interface UpdateOutcome {
  state: JobRecord['state'];
  exitCode: number | null;
  /** 任务的错误（没能启动、超时这类没有退出码的失败时有用）。 */
  error: string | null;
  before: string | null;
  after: string | null;
}

export interface UpdateSummary {
  tone: 'positive' | 'neutral' | 'notice' | 'negative';
  title: string;
  body: string | null;
}

/**
 * 结束后的一句话：停止的不猜结果，让人看输出、重新检测；失败说退出码（没有退出码时说任务的错误）；
 * 成功时按重新检测的版本说更新到了哪个版本、或已是最新。
 */
export function updateSummary(o: UpdateOutcome): UpdateSummary {
  if (o.state === 'cancelled') return { tone: 'notice', title: M.stoppedTitle, body: M.stoppedBody };
  if (o.state !== 'completed') {
    return {
      tone: 'negative',
      title: M.failedTitle(o.exitCode === null ? null : exitCodeText(o.exitCode)),
      body: M.failedBody(o.exitCode === null && o.error ? o.error : null),
    };
  }
  if (o.after && o.after !== o.before) return { tone: 'positive', title: M.updatedTo(o.after), body: null };
  const version = o.after ?? o.before;
  return { tone: 'neutral', title: M.upToDate(version), body: null };
}

/** 输出框里的文字：命令的输出（前面截掉过时先说一句），结束后补一行退出码或「已停止」。 */
export function updateLog(command: JobCommandRun | null | undefined, state: JobRecord['state'] | null, live: boolean): string {
  const output = (command?.output ?? '').replace(/\n+$/, '');
  const head = command?.truncated ? M.logTruncated : '';
  const tail = live || !state ? '' : state === 'cancelled' ? M.logStopped : command?.exitCode !== null && command?.exitCode !== undefined ? M.logExitCode(exitCodeText(command.exitCode)) : '';
  const text = `${head}${output}${output && tail ? '\n' : ''}${tail}`;
  return text || '…';
}

/** 更新前的版本：用户点执行时记下的；从别处开始的（CLI、重启前）用任务记录里的（Runtime 把它记在 `modelId`）。 */
export function updateBefore(recorded: string | null | undefined, job: Pick<JobRecord, 'modelId'> | null | undefined): string | null {
  if (recorded) return recorded;
  const fromJob = job?.modelId;
  return fromJob && fromJob !== 'unknown' ? fromJob : null;
}
