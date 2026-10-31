import { pluralForm } from '@baocut/protocol';
import type { BotMessages } from './bot-copy.ts';

export const fr: BotMessages = {
  trayOpen: 'Ouvrir BaoCut',
  trayWorking: (count: number) => `Tâches en cours (${count})`,
  trayNoWorking: 'Aucune tâche en cours',
  trayPause: 'Suspendre toute l’automatisation',
  trayResume: 'Reprendre l’automatisation',
  trayQuit: 'Quitter le service en arrière-plan',
  trayTooltip: 'Service en arrière-plan de BaoCut',
  trayTooltipNeedsYou: (count: number) =>
    pluralForm('fr', count, { one: `BaoCut : ${count} élément vous attend`, other: `BaoCut : ${count} éléments vous attendent` }),
  trayTooltipPaused: 'BaoCut : automatisation suspendue',
  notifyMerged: (count: number, channel: string) => `${count} éléments vous attendent dans ${channel}`,
  notifySummary: (count: number) =>
    pluralForm('fr', count, { one: `${count} élément vous a attendu cette nuit`, other: `${count} éléments vous ont attendu cette nuit` }),
  notifyReason: {
    'needs-review': 'Prête pour votre relecture',
    'needs-input': 'Attend votre réponse',
    reminder: 'Rappel',
    'unattended-approval': 'Attend votre autorisation',
    stalled: 'Arrêtée, à vérifier',
  },
  residentQuitTitle: 'Le Bot continue de travailler en arrière-plan',
  residentQuitDetailMac:
    'Si vous fermez BaoCut, il continue d’exécuter les tâches planifiées et en cours depuis la barre des menus. Quittez complètement pour tout arrêter.',
  residentQuitDetailOther:
    'Si vous fermez BaoCut, il continue d’exécuter les tâches planifiées et en cours depuis la zone de notification. Quittez complètement pour tout arrêter.',
  residentKeep: 'Garder en arrière-plan',
  residentQuit: 'Quitter complètement',
  quitServiceTitle: 'Quitter le service en arrière-plan ?',
  quitServiceDetail:
    'Le Bot s’arrête jusqu’à ce que vous rouvriez BaoCut. Les tâches planifiées arrivant à échéance entre-temps sont notées comme manquées.',
  quitServiceThreads: (count: number) =>
    pluralForm('fr', count, { one: 'Cette tâche en cours va s’arrêter :', other: `Ces ${count} tâches en cours vont s’arrêter :` }),
  quitServiceSchedules: (count: number) =>
    pluralForm('fr', count, {
      one: 'Cette tâche planifiée ne s’exécutera pas :',
      other: `Ces ${count} tâches planifiées ne s’exécuteront pas :`,
    }),
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Quitter le service en arrière-plan',
  more: (count: number) => `et ${count} de plus`,
  cancel: 'Annuler',
};
