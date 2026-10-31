import { pluralForm } from '@baocut/protocol';
import type { BotMessages } from './bot-copy.ts';

export const de: BotMessages = {
  trayOpen: 'BaoCut öffnen',
  trayWorking: (count: number) => `Laufende Aufgaben (${count})`,
  trayNoWorking: 'Keine laufenden Aufgaben',
  trayPause: 'Alle Automatisierungen pausieren',
  trayResume: 'Automatisierungen fortsetzen',
  trayQuit: 'Hintergrunddienst beenden',
  trayTooltip: 'BaoCut-Hintergrunddienst',
  trayTooltipNeedsYou: (count: number) =>
    pluralForm('de', count, { one: `BaoCut: ${count} Sache wartet auf Sie`, other: `BaoCut: ${count} Sachen warten auf Sie` }),
  trayTooltipPaused: 'BaoCut: Automatisierung pausiert',
  notifyMerged: (count: number, channel: string) => `In ${channel} warten ${count} Sachen auf Sie`,
  notifySummary: (count: number) =>
    pluralForm('de', count, { one: `Über Nacht hat ${count} Sache auf Sie gewartet`, other: `Über Nacht haben ${count} Sachen auf Sie gewartet` }),
  notifyReason: {
    'needs-review': 'Bereit zur Prüfung',
    'needs-input': 'Wartet auf Ihre Eingabe',
    reminder: 'Erinnerung',
    'unattended-approval': 'Wartet auf Ihre Freigabe',
    stalled: 'Angehalten, bitte ansehen',
  },
  residentQuitTitle: 'Der Bot arbeitet im Hintergrund weiter',
  residentQuitDetailMac:
    'Wenn Sie BaoCut schließen, führt es geplante und laufende Aufgaben über die Menüleiste weiter aus. Beenden Sie es vollständig, um alles zu stoppen.',
  residentQuitDetailOther:
    'Wenn Sie BaoCut schließen, führt es geplante und laufende Aufgaben über den Infobereich weiter aus. Beenden Sie es vollständig, um alles zu stoppen.',
  residentKeep: 'Im Hintergrund behalten',
  residentQuit: 'Vollständig beenden',
  quitServiceTitle: 'Hintergrunddienst beenden?',
  quitServiceDetail:
    'Der Bot ruht, bis Sie BaoCut wieder öffnen. Geplante Aufgaben, die in der Zwischenzeit fällig werden, werden als verpasst vermerkt.',
  quitServiceThreads: (count: number) =>
    pluralForm('de', count, { one: 'Diese laufende Aufgabe wird gestoppt:', other: `Diese ${count} laufenden Aufgaben werden gestoppt:` }),
  quitServiceSchedules: (count: number) =>
    pluralForm('de', count, {
      one: 'Diese geplante Aufgabe wird nicht ausgeführt:',
      other: `Diese ${count} geplanten Aufgaben werden nicht ausgeführt:`,
    }),
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Hintergrunddienst beenden',
  more: (count: number) => `und ${count} weitere`,
  cancel: 'Abbrechen',
};
