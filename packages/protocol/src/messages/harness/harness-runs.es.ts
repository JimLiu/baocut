import type { HarnessRunsMessages } from './harness-runs.ts';
export const es: HarnessRunsMessages = {
 retrying: (p) => `${p.message} (reintentando)`, modeChanged: (p) => `Modo de acceso cambiado a «${p.to}» (antes «${p.from}»). Se aplica a las acciones posteriores.`,
 jobsCancelled: (p) => `Se solicitó cancelar las tareas en segundo plano sin terminar de esta sesión (${p.count}). Se conservan los resultados terminados.`,
 jobsCancelledGenerated: (p) => `Se solicitó cancelar las tareas en segundo plano sin terminar de esta sesión (${p.count}, generación o transcripción). Se conservan los resultados terminados.`,
 goalChangedStopped: 'Objetivo cambiado: se detuvo la tarea anterior. Se inicia una tarea nueva para el nuevo objetivo.',
 goalChangedKept: 'Objetivo cambiado: se detuvo el turno de la tarea anterior. Las tareas en segundo plano ya enviadas terminan normalmente y sus resultados permanecen como candidatos. Se inicia una tarea nueva para el nuevo objetivo.',
 stopReplyUnconfirmed: (p) => `Se pidió dejar de responder, pero no se pudo confirmar que ${p.agent} se detuviera.`, stopUnconfirmed: (p) => `Se pidió detenerse, pero no se pudo confirmar que ${p.agent} se detuviera.`,
 stopTimedOut: (p) => `${p.agent} no confirmó la detención en 10 segundos, por lo que se terminó su proceso. Los pasos sin confirmación de cancelación pueden haber surtido efecto.`,
 agentRemovedNotice: (p) => `Se eliminó el agente ${p.agent}, por lo que esta tarea no terminó. Los cambios ya realizados no se deshacen automáticamente.`, agentRemoved: (p) => `Se eliminó el agente ${p.agent}`,
 runtimeStoppedNotice: 'La tarea seguía en curso cuando se detuvo el Runtime, por lo que se interrumpió.', runtimeExitedNotice: 'El Runtime terminó mientras la tarea estaba en curso, por lo que no terminó. Los cambios ya realizados no se deshacen automáticamente.',
 runtimeExited: 'El Runtime terminó mientras la tarea estaba en curso', turnFailed: 'El turno falló', processExited: (p) => `El proceso de ${p.agent} terminó inesperadamente: ${p.error}`,
 noErrorMessage: 'sin mensaje de error', fileChangeSummary: 'Editar archivos',
};
