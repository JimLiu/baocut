import { pluralForm } from '@baocut/protocol';
import type { BotMessages } from './bot-copy.ts';

export const es: BotMessages = {
  trayOpen: 'Abrir BaoCut',
  trayWorking: (count: number) => `Tareas en curso (${count})`,
  trayNoWorking: 'No hay tareas en curso',
  trayPause: 'Pausar toda la automatización',
  trayResume: 'Reanudar la automatización',
  trayQuit: 'Salir del servicio en segundo plano',
  trayTooltip: 'Servicio en segundo plano de BaoCut',
  trayTooltipNeedsYou: (count: number) =>
    pluralForm('es', count, { one: `BaoCut: ${count} cosa te espera`, other: `BaoCut: ${count} cosas te esperan` }),
  trayTooltipPaused: 'BaoCut: automatización en pausa',
  notifyMerged: (count: number, channel: string) => `${count} cosas te esperan en ${channel}`,
  notifySummary: (count: number) =>
    pluralForm('es', count, { one: `${count} cosa te esperó durante la noche`, other: `${count} cosas te esperaron durante la noche` }),
  notifyReason: {
    'needs-review': 'Lista para tu revisión',
    'needs-input': 'Necesita tu respuesta',
    reminder: 'Recordatorio',
    'unattended-approval': 'Esperando tu aprobación',
    stalled: 'Se detuvo y necesita revisión',
  },
  residentQuitTitle: 'El Bot sigue trabajando en segundo plano',
  residentQuitDetailMac:
    'Si cierras BaoCut, seguirá ejecutando las tareas programadas y en curso desde la barra de menús. Sal por completo para detenerlo todo.',
  residentQuitDetailOther:
    'Si cierras BaoCut, seguirá ejecutando las tareas programadas y en curso desde el área de notificaciones. Sal por completo para detenerlo todo.',
  residentKeep: 'Mantener en segundo plano',
  residentQuit: 'Salir por completo',
  quitServiceTitle: '¿Salir del servicio en segundo plano?',
  quitServiceDetail:
    'El Bot se detiene hasta que vuelvas a abrir BaoCut. Las tareas programadas que venzan mientras tanto se registran como perdidas.',
  quitServiceThreads: (count: number) =>
    pluralForm('es', count, { one: 'Se detendrá esta tarea en curso:', other: `Se detendrán estas ${count} tareas en curso:` }),
  quitServiceSchedules: (count: number) =>
    pluralForm('es', count, { one: 'Esta tarea programada no se ejecutará:', other: `Estas ${count} tareas programadas no se ejecutarán:` }),
  quitServiceScheduleLine: (name: string, at: string) => `${name} · ${at}`,
  quitServiceConfirm: 'Salir del servicio en segundo plano',
  more: (count: number) => `y ${count} más`,
  cancel: 'Cancelar',
};
