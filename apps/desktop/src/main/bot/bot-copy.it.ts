import { pluralForm } from '@baocut/protocol';
import type { BotMessages } from './bot-copy.ts';

export const it: BotMessages = {
  trayOpen: 'Apri BaoCut',
  trayWorking: (count: number) => `Attività in corso (${count})`,
  trayNoWorking: 'Nessuna attività in corso',
  trayPause: 'Sospendi tutta l’automazione',
  trayResume: 'Riprendi l’automazione',
  trayQuit: 'Esci dal servizio in background',
  trayTooltip: 'Servizio in background di BaoCut',
  trayTooltipNeedsYou: (count: number) =>
    pluralForm('it', count, { one: `BaoCut: ${count} cosa ti aspetta`, other: `BaoCut: ${count} cose ti aspettano` }),
  trayTooltipPaused: 'BaoCut: automazione sospesa',
  notifyMerged: (count: number, channel: string) => `${count} cose ti aspettano in ${channel}`,
  notifySummary: (count: number) =>
    pluralForm('it', count, { one: `${count} cosa ti ha aspettato stanotte`, other: `${count} cose ti hanno aspettato stanotte` }),
  notifyReason: {
    'needs-review': 'Pronta per la tua revisione',
    'needs-input': 'Serve una tua risposta',
    reminder: 'Promemoria',
    'unattended-approval': 'In attesa della tua approvazione',
    stalled: 'Si è fermata, dai un’occhiata',
  },
  residentQuitTitle: 'Il Bot continua a lavorare in background',
  residentQuitDetailMac:
    'Se chiudi BaoCut, continua a eseguire le attività pianificate e in corso dalla barra dei menu. Esci del tutto per fermare ogni cosa.',
  residentQuitDetailOther:
    'Se chiudi BaoCut, continua a eseguire le attività pianificate e in corso dall’area di notifica. Esci del tutto per fermare ogni cosa.',
  residentKeep: 'Mantieni in background',
  residentQuit: 'Esci del tutto',
  quitServiceTitle: 'Uscire dal servizio in background?',
  quitServiceDetail:
    'Il Bot si ferma finché non riapri BaoCut. Le attività pianificate che scadono nel frattempo vengono registrate come perse.',
  quitServiceThreads: (count: number) =>
    pluralForm('it', count, { one: 'Questa attività in corso si fermerà:', other: `Queste ${count} attività in corso si fermeranno:` }),
  quitServiceSchedules: (count: number) =>
    pluralForm('it', count, {
      one: 'Questa attività pianificata non verrà eseguita:',
      other: `Queste ${count} attività pianificate non verranno eseguite:`,
    }),
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Esci dal servizio in background',
  more: (count: number) => `e altri ${count}`,
  cancel: 'Annulla',
};
