import { pluralForm } from '@baocut/protocol';
import type { BotMessages } from './bot-copy.ts';

export const ru: BotMessages = {
  trayOpen: 'Открыть BaoCut',
  trayWorking: (count: number) => `Задачи в работе (${count})`,
  trayNoWorking: 'Нет задач в работе',
  trayPause: 'Приостановить всю автоматизацию',
  trayResume: 'Возобновить автоматизацию',
  trayQuit: 'Выйти из фоновой службы',
  trayTooltip: 'Фоновая служба BaoCut',
  trayTooltipNeedsYou: (count: number) =>
    pluralForm('ru', count, {
      one: `BaoCut: вас ждёт ${count} дело`,
      few: `BaoCut: вас ждут ${count} дела`,
      many: `BaoCut: вас ждут ${count} дел`,
      other: `BaoCut: вас ждут ${count} дела`,
    }),
  trayTooltipPaused: 'BaoCut: автоматизация приостановлена',
  notifyMerged: (count: number, channel: string) =>
    pluralForm('ru', count, {
      one: `В «${channel}» вас ждёт ${count} дело`,
      few: `В «${channel}» вас ждут ${count} дела`,
      many: `В «${channel}» вас ждут ${count} дел`,
      other: `В «${channel}» вас ждут ${count} дела`,
    }),
  notifySummary: (count: number) => `За ночь накопилось дел, которые ждут вас: ${count}`,
  notifyReason: {
    'needs-review': 'Готово к вашей проверке',
    'needs-input': 'Нужен ваш ответ',
    reminder: 'Напоминание',
    'unattended-approval': 'Ждёт вашего разрешения',
    stalled: 'Остановилась, нужно посмотреть',
  },
  residentQuitTitle: 'Bot продолжит работать в фоне',
  residentQuitDetailMac:
    'Если закрыть BaoCut, он продолжит выполнять запланированные и текущие задачи из строки меню. Чтобы остановить всё, выйдите полностью.',
  residentQuitDetailOther:
    'Если закрыть BaoCut, он продолжит выполнять запланированные и текущие задачи из области уведомлений. Чтобы остановить всё, выйдите полностью.',
  residentKeep: 'Оставить в фоне',
  residentQuit: 'Выйти полностью',
  quitServiceTitle: 'Выйти из фоновой службы?',
  quitServiceDetail:
    'Bot не будет работать, пока вы снова не откроете BaoCut. Запланированные задачи, срок которых наступит за это время, будут отмечены как пропущенные.',
  quitServiceThreads: (count: number) => `Будут остановлены задачи в работе (${count}):`,
  quitServiceSchedules: (count: number) => `Не будут выполнены запланированные задачи (${count}):`,
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Выйти из фоновой службы',
  more: (count: number) => `и ещё ${count}`,
  cancel: 'Отмена',
};
