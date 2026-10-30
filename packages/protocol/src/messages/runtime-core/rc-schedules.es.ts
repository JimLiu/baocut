import type { RcSchedulesMessages } from './rc-schedules.ts';

export const es: RcSchedulesMessages = {
  notFound: (p) => `No se encontró la tarea programada: ${p.id}`,
  conversationNotFound: (p) => `No se encontró la sesión: ${p.id}`,
  conversationArchived: 'Esta sesión está archivada. Restáurala desde Sesiones archivadas antes de programarla.',
  noProject: 'Esta sesión no está en un proyecto, así que no puede abrir una sesión nueva en un proyecto cada vez.',
  invalid: 'Revisa la tarea programada: el mensaje, la frecuencia y el límite de ejecuciones deben ser válidos.',
  notActive: 'Solo una tarea programada activa puede ejecutarse ahora.',
  resumeArchived:
    'La sesión de destino está archivada. Restáurala desde Sesiones archivadas o edita la tarea programada para abrir una sesión nueva cada vez.',
  resumeDeleted: 'La sesión de destino se eliminó. Edita la tarea programada para abrir una sesión nueva cada vez.',
  resumeProjectRemoved: 'El proyecto se quitó de BaoCut, así que no se puede abrir una sesión nueva en él.',
  resumeCompleted: 'Ya se ejecutó el número máximo de veces. Aumenta el límite antes de continuar.',
  runStopped: 'Se detuvo antes de terminar',
};
