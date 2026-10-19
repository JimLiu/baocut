import type { VideoVersionsMessages } from './video-versions-copy.ts';

export const es: VideoVersionsMessages = {
  title: 'Historial',
  close: 'Cerrar historial',
  tipRevision: (revision: string) => `Revisión ${revision}`,
  viewChanges: 'Cambios',
  tipLatest: (version: number) => `La más reciente es la versión ${version}`,
  tipNone: 'Aún no hay versiones',
  tipOutside: 'Este vídeo no está en un proyecto',
  loading: 'Cargando historial de versiones',
  loadFailed: (message: string) => `No se pudo cargar el historial de versiones: ${message}`,
  stateSynced: 'Instantánea al día',
  stateSyncedDesc: 'La instantánea de espacio de trabajo de la carpeta del vídeo coincide con el contenido actual.',
  statePending: 'Escribiendo instantánea',
  statePendingDesc: 'Los cambios recientes pasan a la instantánea y al historial de versiones en unos segundos.',
  stateConflict: 'La instantánea y BaoCut tienen cambios',
  stateConflictDesc:
    'Los archivos de la instantánea cambiaron fuera de BaoCut, y BaoCut también tiene cambios que aún no están en la instantánea. BaoCut no sobrescribirá la instantánea hasta que elijas qué conservar.',
  stateInvalid: 'No se puede leer la instantánea',
  stateInvalidDesc:
    'Los archivos de la instantánea no se pueden analizar, así que BaoCut no los importó. BaoCut vuelve a comprobarlos cuando los corrijas, o puedes sobrescribirlos con el contenido de BaoCut.',
  stateExternal: 'Importando cambios externos',
  stateExternalDesc:
    'Los archivos de la instantánea cambiaron fuera de BaoCut (git pull, una unidad sincronizada o una edición manual) y BaoCut no tiene otros cambios, así que los está importando como una versión «Cambio externo».',
  stateMissing: 'Aún no hay instantánea',
  stateMissingDesc: 'La instantánea de espacio de trabajo aún no se ha escrito, o falta video.json.',
  stateRebuild: 'Pendiente de reconstruir',
  stateRebuildDesc: 'Solo está la instantánea de espacio de trabajo, sin la biblioteca del vídeo. BaoCut reconstruye el vídeo a partir de ella al abrirlo.',
  footer: (keep: number) =>
    `Las versiones se guardan en .bcut-snapshot/history/ dentro de la carpeta del vídeo y no dependen de git. BaoCut conserva ${keep === 1 ? 'la versión sin nombre más reciente' : `las ${keep} versiones sin nombre más recientes`} y todas las versiones guardadas.`,
  save: 'Guardar versión',
  saveIntro: 'Guarda el contenido actual como una versión con nombre. Las versiones guardadas nunca se limpian automáticamente; solo tú puedes eliminarlas.',
  nameLabel: 'Nombre',
  namePlaceholder: 'Por ejemplo: Corte para aprobación',
  nameRequired: 'Ponle un nombre a esta versión',
  noteLabel: 'Nota (opcional)',
  cancel: 'Cancelar',
  saveSubmit: 'Guardar',
  conflictIntro:
    'Estos archivos de la instantánea cambiaron fuera de BaoCut, quizá por git pull, una unidad sincronizada o una edición manual, y BaoCut también tiene cambios que aún no están en la instantánea:',
  conflictOutro: 'Hasta que elijas qué conservar, BaoCut no sobrescribirá la instantánea. Puedes seguir editando el vídeo, pero no puedes guardar versiones ni volver a ellas.',
  invalidIntro:
    'Estos archivos de la instantánea no se pueden analizar. Puede que tengan marcadores de conflicto de fusión, estén truncados o se hayan dañado al editarlos a mano:',
  invalidOutro:
    'BaoCut no los importó. Puedes seguir editando el vídeo, pero no puedes guardar versiones ni volver a ellas. BaoCut vuelve a comprobarlos cuando corrijas estos archivos, o puedes conservar el contenido de BaoCut y sobrescribirlos.',
  externalIntro: 'Estos archivos de la instantánea cambiaron fuera de BaoCut, quizá por git pull, una unidad sincronizada o una edición manual:',
  externalOutro:
    'BaoCut no tiene cambios que falten en la instantánea, así que los importa directamente como una versión «Cambio externo». Después puedes deshacer la importación.',
  stripConflict: 'La instantánea cambió fuera de BaoCut y BaoCut también tiene cambios nuevos. Elige qué conservar.',
  stripInvalid: 'No se pueden leer los archivos de la instantánea. BaoCut no los importó.',
  view: 'Ver',
  keepVideo: 'Conservar el contenido de BaoCut',
  useSnapshot: 'Usar la instantánea del disco',
  keepTitle: '¿Conservar el contenido de BaoCut?',
  keepConfirm: 'Sobrescribir la instantánea del disco',
  keepBody: (count: number, files: string, invalid: boolean) =>
    `El contenido de BaoCut se escribe de inmediato en la instantánea y sobrescribe ${count === 1 ? `el archivo ${invalid ? 'ilegible' : 'modificado'}` : `los ${count} archivos ${invalid ? 'ilegibles' : 'modificados'}`} del disco${files ? ` (${files})` : ''}. Esos cambios del disco no pasan al historial de versiones y no se pueden recuperar en BaoCut; si venían de git o de una unidad sincronizada, puedes recuperarlos allí.`,
  diskTitle: '¿Usar la instantánea del disco?',
  diskConfirm: 'Usar la instantánea del disco',
  diskBody: (files: string) =>
    `El contenido del vídeo se sustituye por la instantánea del disco${files ? ` (${files})` : ''} y se registra como una versión «Cambio externo». Los cambios de BaoCut que aún no están en la instantánea pasan antes al historial de versiones: vuelve a antes de la versión «Cambio externo» para recuperarlos. También puedes deshacerlo.`,
  keptTitle: 'Se conservó el contenido de BaoCut',
  keptText: (version: number | null) =>
    `La instantánea del disco ya coincide con BaoCut${version ? `, y tus cambios recientes están en la versión ${version}` : ''}. Los cambios que había en el disco no pasaron al historial de versiones.`,
  usedDiskTitle: (version: number) => `Se usó la instantánea del disco, registrada como versión ${version} «Cambio externo»`,
  usedDiskText: (version: number) => `Vuelve a antes de la versión ${version} para recuperar lo que había en BaoCut. También puedes deshacerlo.`,
  importedTitle: (version: number | null) => (version ? `Cambios externos importados como versión ${version} «Cambio externo»` : 'Cambios externos importados'),
  importedText:
    'Los archivos de la instantánea cambiaron fuera de BaoCut y BaoCut no tenía otros cambios, así que se importaron directamente. Vuelve a antes de esta versión para ver el contenido previo a la importación, o deshazla.',
  importUndoneTitle: 'Importación deshecha',
  importUndoneText:
    'El vídeo recupera su contenido de antes de la importación y se vuelve a escribir en la instantánea en unos segundos, lo que descarta este cambio externo. Deshacer también es un cambio y pasa a una versión nueva.',
  refusedBroken: 'No se puede volver a esta versión',
  refusedOther: 'No se hizo',
  refusedText: (message: string) => `${message}. El vídeo no ha cambiado.`,
  savedTitle: (version: number, name: string) => `Guardada como versión ${version} «${name}»`,
  savedText: 'Las versiones guardadas se quedan; la regla de conservación nunca las elimina.',
  restoredTitle: (version: number, before: boolean, recorded: number) =>
    before
      ? `Vuelta a antes de la versión ${version}, registrada como versión ${recorded}`
      : `Vuelta a la versión ${version}, registrada como versión ${recorded}`,
  restoredText: 'Es un cambio normal: puedes deshacerlo aquí, o en el editor después de cerrar este diálogo.',
  undo: 'Deshacer',
  undoneTitle: (version: number, before: boolean) =>
    before ? `Deshecho: volver a antes de la versión ${version}` : `Deshecho: volver a la versión ${version}`,
  undoneText: 'El vídeo recupera su contenido anterior. Deshacer también es un cambio y pasa a la versión más reciente.',
  noopTitle: 'Sin cambios',
  noopText: (version: number, before: boolean) =>
    before
      ? `El vídeo ya está como antes de que empezara la versión ${version}. No se aplicó ningún cambio ni se creó una versión nueva.`
      : `El vídeo ya está como al final de la versión ${version}. No se aplicó ningún cambio ni se creó una versión nueva.`,
  deletedTitle: (name: string) => `Se eliminó la versión guardada «${name}»`,
  deletedText: 'El contenido del vídeo no cambió.',
  emptyTitle: 'Aún no hay versiones',
  emptyText: (missing: boolean): string =>
    missing
      ? 'La instantánea de espacio de trabajo aún no se ha escrito. Tu próximo cambio será la versión 1, o puedes guardar una versión ahora.'
      : 'Tu próximo cambio será la versión 1, o puedes guardar una versión ahora.',
  outsideTitle: 'Este vídeo no está en un proyecto',
  outsideText: 'Solo los vídeos de un proyecto tienen historial de versiones. Mueve primero el vídeo a un proyecto.',
  listLabel: 'Versiones',
  versionN: (version: number) => `Versión ${version}`,
  openBadge: 'Aún abierta',
  blockedFlag: 'No se puede volver',
  unreadableTitle: 'No se puede leer este archivo de versión',
  kindSegment: 'Ediciones',
  kindSave: 'Versión guardada',
  kindRestore: 'Vuelta a una versión',
  kindExternal: 'Cambio externo',
  kindRebuild: 'Reconstrucción',
  revisions: (from: string, to: string) => (from === to ? `Revisión ${to}` : `Revisiones ${from}–${to}`),
  openHint: 'La versión más reciente sigue abierta: hasta que pasen 5 minutos sin cambios o cumpla 30 minutos, tus próximos cambios se suman a ella.',
  openHintPending: 'La versión más reciente sigue abierta. Los cambios recientes se están escribiendo y se sumarán a ella en unos segundos.',
  openHintConflict: 'La versión más reciente sigue abierta, pero los cambios nuevos no entrarán en el historial de versiones hasta que se resuelva el conflicto de la instantánea.',
  openHintExternal:
    'La versión más reciente sigue abierta. Se está importando la instantánea del disco: primero se cierra esta versión, y los cambios externos forman una versión propia.',
  externalHint:
    'Esta versión vino de fuera de BaoCut: los archivos de la instantánea cambiaron por git pull, una unidad sincronizada o una edición manual, y BaoCut los importó como esta versión. Vuelve a antes de esta versión para recuperar lo que había en BaoCut antes de la importación.',
  restoreEnd: 'Volver a esta versión',
  restoreBefore: 'Volver a antes de esta versión',
  deleteSaved: 'Eliminar esta versión guardada',
  whyNotFound: 'Esta versión ya no existe',
  whyUnreadable: (version: number) => `El archivo de la versión ${version} no se puede leer, así que no se puede volver a ella ni a estados anteriores`,
  whyBroken: (version: number) => `El historial de versiones no coincide en la versión ${version}, así que no se puede volver a estados anteriores`,
  noopBoth: (version: number) => `El vídeo ya está en el estado de la versión ${version} (su contenido es el mismo antes y después), así que volver a ella no cambia nada`,
  noopEnd: (version: number) => `El vídeo ya está como al final de la versión ${version}, así que volver a ella no cambia nada`,
  noopBefore: (version: number) => `El vídeo ya está como antes de que empezara la versión ${version}, así que volver ahí no cambia nada`,
  factActors: 'Cambiado por',
  factConversations: 'Sesiones',
  factFiles: 'Qué cambió',
  factCheckpoint: 'Punto de control',
  actorYou: 'Tú',
  actorAgent: 'Agente',
  actorExternal: (name: string) => `Servicio externo ${name}`,
  actorSystem: 'BaoCut',
  actionCount: (label: string, count: number) => (count > 1 ? `${label} ×${count}` : label),
  listSeparator: ', ',
  noActions: 'No se registraron cambios',
  noActionsRebuild: 'BaoCut reconstruyó el vídeo a partir de su instantánea; sin cambios de contenido',
  omitted: (count: number) => (count === 1 ? 'Otro cambio solo se contabilizó' : `Otros ${count} cambios solo se contabilizaron`),
  notHere: '(no está en este equipo)',
  openConversation: (title: string) => `Abrir la sesión «${title}»`,
  fileTimeline: 'Línea de tiempo',
  fileDocument: 'Documento',
  changeAdd: 'Añadido',
  changeDelete: 'Eliminado',
  changeModify: 'Modificado',
  noFiles: 'Sin cambios de contenido',
  diffTitle: 'Cambios',
  copyDiff: 'Copiar diff',
  copied: 'Copiado',
  copyFailed: 'No se pudo copiar. Selecciona el texto y cópialo manualmente.',
  diffEmpty: 'El diff de esta versión está vacío: el contenido es el mismo que al final de la versión anterior.',
  diffLabel: (version: number) => `Diff de la versión ${version}`,
  diffLoading: 'Cargando diff',
  diffFailed: (message: string) => `No se pudo leer esta versión: ${message}`,
  diffMore: (count: number) =>
    count === 1
      ? 'Hay 1 línea más que no se muestra. Copia el diff para verlo completo.'
      : `Hay ${count} líneas más que no se muestran. Copia el diff para verlo completo.`,
  unreadableHeading: (file: string) => `No se puede leer ${file}`,
  unreadableText: (why: string) =>
    `La cabecera o el diff del archivo de versión están dañados; puede que esté truncado o editado a mano. ${why}. Las versiones más recientes no se ven afectadas.`,
  confirmRestoreTitle: (version: number, before: boolean) =>
    before ? `¿Volver a antes de la versión ${version}?` : `¿Volver a la versión ${version}?`,
  confirmRestoreBody: (version: number, before: boolean, when: string) =>
    `El contenido del vídeo se sustituirá por su estado ${before ? `de antes de que empezara la versión ${version}` : `del final de la versión ${version}`} (${when}). Es un cambio que puedes deshacer y se registra como una versión nueva. Las versiones existentes se conservan, y los puntos de control y las protecciones no cambian.`,
  confirmDeleteTitle: (name: string) => `¿Eliminar la versión guardada «${name}»?`,
  confirmDeleteMiddle: (next: number) =>
    `Solo se eliminan esta versión y su punto de control: sus cambios se combinan con la versión ${next}, la siguiente. El contenido del vídeo no cambia.`,
  confirmDeleteTop: 'Solo se quitan el nombre, la nota y el punto de control: esta versión pasa a ser un conjunto normal de ediciones y los cambios posteriores se suman a ella. El contenido del vídeo no cambia.',
  delete: 'Eliminar',
};
