import type { ForkMessages } from './fork-copy.ts';

export const es: ForkMessages = {
  button: 'Bifurcar desde este turno',
  fork: 'Continuar en una sesión nueva',
  forkHint: 'Lleva la conversación hasta este turno',
  restore: 'Continuar con los videos restaurados a ese momento…',
  restoreOne: (name) => `«${name}» vuelve al final de este turno`,
  restoreMany: (n) => `${n} videos vuelven al final de este turno`,
  restoreNone: 'Las versiones de ese momento ya no existen o no se pueden leer',
  checking: 'Comprobando el historial de versiones…',
  dialogTitle: 'Bifurcar y restaurar videos',
  dialogLead:
    'La sesión nueva lleva la conversación hasta este turno. Los videos de abajo vuelven al final de este turno. Cada restauración se guarda como una versión nueva, así que puedes volver desde el historial de versiones.',
  listLabel: 'Videos que restaurar',
  cancel: 'Cancelar',
  confirm: 'Bifurcar y restaurar',
  ok: (version, undone) =>
    `Restaurar la versión ${version}. Se deshacen las ${undone} versiones posteriores (tus cambios y los de otras sesiones)`,
  pruned: 'La versión de ese momento ya no existe (el historial de versiones solo guarda las recientes y las guardadas)',
  createdAfter: 'Este video se creó después de este turno, así que se queda como está',
  chainBroken: 'El historial de versiones no se puede leer hasta ese momento',
  done: 'Bifurcada en una sesión nueva',
  doneRestored: (n) =>
    `Bifurcada en una sesión nueva y ${n} videos restaurados a ese momento. Puedes volver desde el historial de versiones`,
  failed: (error) => `No se pudo bifurcar: ${error}`,
  forkedFrom: (title, turn) => `Bifurcada de «${title}» · hasta el turno ${turn}`,
  sourceDeleted: '(sesión original eliminada)',
  history: (turns, omitted) => `Historial incluido · ${turns} turnos${omitted ? ` (${omitted} anteriores omitidos)` : ''}`,
  hideHistory: 'Ocultar historial',
};
