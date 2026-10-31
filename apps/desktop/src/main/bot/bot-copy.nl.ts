import { pluralForm } from '@baocut/protocol';
import type { BotMessages } from './bot-copy.ts';

export const nl: BotMessages = {
  trayOpen: 'BaoCut openen',
  trayWorking: (count: number) => `Lopende taken (${count})`,
  trayNoWorking: 'Geen lopende taken',
  trayPause: 'Alle automatisering pauzeren',
  trayResume: 'Automatisering hervatten',
  trayQuit: 'Achtergronddienst afsluiten',
  trayTooltip: 'BaoCut-achtergronddienst',
  trayTooltipNeedsYou: (count: number) =>
    pluralForm('nl', count, { one: `BaoCut: ${count} ding wacht op je`, other: `BaoCut: ${count} dingen wachten op je` }),
  trayTooltipPaused: 'BaoCut: automatisering gepauzeerd',
  notifyMerged: (count: number, channel: string) => `${count} dingen wachten op je in ${channel}`,
  notifySummary: (count: number) =>
    pluralForm('nl', count, { one: `Er heeft vannacht ${count} ding op je gewacht`, other: `Er hebben vannacht ${count} dingen op je gewacht` }),
  notifyReason: {
    'needs-review': 'Klaar voor je controle',
    'needs-input': 'Wacht op je invoer',
    reminder: 'Herinnering',
    'unattended-approval': 'Wacht op je toestemming',
    stalled: 'Gestopt, kijk er even naar',
  },
  residentQuitTitle: 'De Bot blijft op de achtergrond werken',
  residentQuitDetailMac:
    'Als je BaoCut sluit, blijft het geplande en lopende taken uitvoeren vanuit de menubalk. Sluit volledig af om alles te stoppen.',
  residentQuitDetailOther:
    'Als je BaoCut sluit, blijft het geplande en lopende taken uitvoeren vanuit het systeemvak. Sluit volledig af om alles te stoppen.',
  residentKeep: 'Op de achtergrond houden',
  residentQuit: 'Volledig afsluiten',
  quitServiceTitle: 'Achtergronddienst afsluiten?',
  quitServiceDetail:
    'De Bot stopt tot je BaoCut weer opent. Geplande taken die in de tussentijd aan de beurt zijn, worden als gemist genoteerd.',
  quitServiceThreads: (count: number) =>
    pluralForm('nl', count, { one: 'Deze lopende taak stopt:', other: `Deze ${count} lopende taken stoppen:` }),
  quitServiceSchedules: (count: number) =>
    pluralForm('nl', count, {
      one: 'Deze geplande taak wordt niet uitgevoerd:',
      other: `Deze ${count} geplande taken worden niet uitgevoerd:`,
    }),
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Achtergronddienst afsluiten',
  more: (count: number) => `en nog ${count}`,
  cancel: 'Annuleren',
};
