import { pluralForm } from '@baocut/protocol';
import type { BotMessages } from './bot-copy.ts';

export const pl: BotMessages = {
  trayOpen: 'Otwórz BaoCut',
  trayWorking: (count: number) => `Zadania w toku (${count})`,
  trayNoWorking: 'Brak zadań w toku',
  trayPause: 'Wstrzymaj całą automatyzację',
  trayResume: 'Wznów automatyzację',
  trayQuit: 'Zakończ usługę w tle',
  trayTooltip: 'Usługa w tle BaoCut',
  trayTooltipNeedsYou: (count: number) =>
    pluralForm('pl', count, {
      one: `BaoCut: ${count} sprawa czeka na Ciebie`,
      few: `BaoCut: ${count} sprawy czekają na Ciebie`,
      many: `BaoCut: ${count} spraw czeka na Ciebie`,
      other: `BaoCut: ${count} sprawy czeka na Ciebie`,
    }),
  trayTooltipPaused: 'BaoCut: automatyzacja wstrzymana',
  notifyMerged: (count: number, channel: string) =>
    pluralForm('pl', count, {
      one: `W kanale ${channel} czeka na Ciebie ${count} sprawa`,
      few: `W kanale ${channel} czekają na Ciebie ${count} sprawy`,
      many: `W kanale ${channel} czeka na Ciebie ${count} spraw`,
      other: `W kanale ${channel} czeka na Ciebie ${count} sprawy`,
    }),
  notifySummary: (count: number) =>
    pluralForm('pl', count, {
      one: `W nocy czekała na Ciebie ${count} sprawa`,
      few: `W nocy czekały na Ciebie ${count} sprawy`,
      many: `W nocy czekało na Ciebie ${count} spraw`,
      other: `W nocy czekało na Ciebie ${count} sprawy`,
    }),
  notifyReason: {
    'needs-review': 'Gotowe do Twojego przeglądu',
    'needs-input': 'Potrzebna Twoja odpowiedź',
    reminder: 'Przypomnienie',
    'unattended-approval': 'Czeka na Twoją zgodę',
    stalled: 'Zatrzymało się, zajrzyj',
  },
  residentQuitTitle: 'Bot dalej pracuje w tle',
  residentQuitDetailMac:
    'Po zamknięciu BaoCut nadal wykonuje zaplanowane i bieżące zadania z paska menu. Zakończ całkowicie, aby wszystko zatrzymać.',
  residentQuitDetailOther:
    'Po zamknięciu BaoCut nadal wykonuje zaplanowane i bieżące zadania z obszaru powiadomień. Zakończ całkowicie, aby wszystko zatrzymać.',
  residentKeep: 'Zostaw w tle',
  residentQuit: 'Zakończ całkowicie',
  quitServiceTitle: 'Zakończyć usługę w tle?',
  quitServiceDetail:
    'Bot nie działa, dopóki ponownie nie otworzysz BaoCut. Zaplanowane zadania, których termin przypadnie w tym czasie, zostaną oznaczone jako pominięte.',
  quitServiceThreads: (count: number) => `Zadania w toku, które zostaną zatrzymane (${count}):`,
  quitServiceSchedules: (count: number) => `Zaplanowane zadania, które się nie wykonają (${count}):`,
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Zakończ usługę w tle',
  more: (count: number) => `i ${count} więcej`,
  cancel: 'Anuluj',
};
