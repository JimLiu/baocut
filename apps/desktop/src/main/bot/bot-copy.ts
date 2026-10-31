import { defineMessages, type BotNotificationReason } from '@baocut/protocol';
import { zhHans } from './bot-copy.zh-Hans.ts';
import { zhHant } from './bot-copy.zh-Hant.ts';
import { ja } from './bot-copy.ja.ts';
import { ko } from './bot-copy.ko.ts';
import { es } from './bot-copy.es.ts';
import { fr } from './bot-copy.fr.ts';
import { de } from './bot-copy.de.ts';
import { nl } from './bot-copy.nl.ts';
import { ptBR } from './bot-copy.pt-BR.ts';
import { it } from './bot-copy.it.ts';
import { ru } from './bot-copy.ru.ts';
import { pl } from './bot-copy.pl.ts';
import { tr } from './bot-copy.tr.ts';
import { vi } from './bot-copy.vi.ts';

/**
 * 主进程里 Bot 后台服务的文案（技术方案 §15.2）：托盘 / 菜单栏菜单、系统通知、常驻时的退出确认与「退出后台服务」确认。
 * 英文是键与类型的来源，译文在 `bot-copy.<语言>.ts`。菜单项按各平台菜单的习惯用标题式大小写。
 */
const en = {
  // ---- 托盘 / 菜单栏（tray.ts）----
  trayOpen: 'Open BaoCut',
  trayWorking: (count: number) => `Working Tasks (${count})`,
  trayNoWorking: 'No tasks working',
  trayPause: 'Pause All Automation',
  trayResume: 'Resume Automation',
  trayQuit: 'Quit Background Service',
  trayTooltip: 'BaoCut background service',
  trayTooltipNeedsYou: (count: number) => (count === 1 ? 'BaoCut: 1 thing needs you' : `BaoCut: ${count} things need you`),
  trayTooltipPaused: 'BaoCut: automation paused',

  // ---- 系统通知（bot-monitor.ts）----
  /** 同一频道 5 分钟里攒下的多件事（count ≥ 2）。 */
  notifyMerged: (count: number, channel: string) => `${count} things need you in ${channel}`,
  /** 免打扰时段结束时的汇总。 */
  notifySummary: (count: number) => (count === 1 ? '1 thing waited for you overnight' : `${count} things waited for you overnight`),
  /** 单条通知的副标题（macOS）与没有报告首句时的正文。 */
  notifyReason: {
    'needs-review': 'Ready for your review',
    'needs-input': 'Needs your input',
    reminder: 'Reminder',
    'unattended-approval': 'Waiting for your approval',
    stalled: 'Stopped and needs a look',
  } satisfies Record<BotNotificationReason, string>,

  // ---- 常驻时退出应用（bot-quit.ts）----
  residentQuitTitle: 'The Bot keeps working in the background',
  residentQuitDetailMac: 'Close BaoCut and it keeps running scheduled and working tasks from the menu bar. Quit completely to stop everything.',
  residentQuitDetailOther:
    'Close BaoCut and it keeps running scheduled and working tasks from the notification area. Quit completely to stop everything.',
  residentKeep: 'Keep in Background',
  residentQuit: 'Quit Completely',

  // ---- 退出后台服务（托盘菜单，bot-quit.ts）----
  quitServiceTitle: 'Quit the background service?',
  quitServiceDetail: 'The Bot stops until you open BaoCut again. Scheduled tasks that come due meanwhile are recorded as missed.',
  quitServiceThreads: (count: number) => (count === 1 ? 'This working task will stop:' : `These ${count} working tasks will stop:`),
  quitServiceSchedules: (count: number) => (count === 1 ? 'This scheduled task won’t run:' : `These ${count} scheduled tasks won’t run:`),
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Quit Background Service',
  more: (count: number) => `and ${count} more`,
  cancel: 'Cancel',
};

export type BotMessages = typeof en;

export const B = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
