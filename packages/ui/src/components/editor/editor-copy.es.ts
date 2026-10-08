import type { EditorMessages } from './editor-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: EditorMessages = {
 withNote: (label, note) => `${label} (${note})`, labeled: (label, value) => `${label}: ${value}`, thenNext: (message, next) => `${message}. ${next}`, gap: ' ', undo: 'Deshacer', redo: 'Rehacer', cancel: 'Cancelar', retry: 'Reintentar', addClip: 'Añadir clip', editor: 'Editor', notEditableNow: 'El vídeo no se puede editar ahora', timeline: 'Línea de tiempo', moveClips: 'Mover clips', moveTrack: 'Mover pista', importAndAdd: 'Importar y añadir materiales', seconds2: (seconds) => `${seconds.toFixed(2).replace('.', ',')} s`, emptyTimeline: 'Arrastra materiales aquí o añádelos desde el panel derecho',
 hideTrack: (label) => `Ocultar ${label}: no se muestra en la vista previa`, showTrack: (label) => `Mostrar ${label}`, hideTrackLabel: 'Ocultar pista', showTrackLabel: 'Mostrar pista', unmuteTrack: (label) => `Activar sonido de ${label}`, muteTrack: (label) => `Silenciar ${label}`, unmuteTrackLabel: 'Activar sonido', muteTrackLabel: 'Silenciar pista', unlockTrack: (label) => `Desbloquear ${label}`, lockTrack: (label) => `Bloquear ${label}: sus clips no se pueden mover, recortar ni eliminar`, unlockTrackLabel: 'Desbloquear pista', lockTrackLabel: 'Bloquear pista',
 playTip: { play: 'Reproducir · Space', pause: 'Pausar · Space', replay: "Volver a reproducir" }, playLabel: { play: 'Reproducir', pause: 'Pausar', replay: "Volver a reproducir" }, undoTip: (label, keys) => `Deshacer «${label}» ${keys}`, redoTip: (label, keys) => `Rehacer «${label}» ${keys}`, nothingToUndo: 'Nada que deshacer', nothingToRedo: 'Nada que rehacer', splitTip: 'Dividir en el cabezal de reproducción · S', split: 'Dividir', splitClips: 'Dividir clip', deleteTip: 'Eliminar selección · Delete', deleteSelected: 'Eliminar selección', playhead: 'Posición del cabezal de reproducción', totalLength: (duration) => `Duración total ${duration}`, editFailed: (message) => `No se pudo hacer el cambio: ${message}`, cantOpen: 'No se puede abrir este vídeo', openingAria: 'Abriendo vídeo', opening: 'Abriendo vídeo…', resizeTimeline: 'Cambiar tamaño de la línea de tiempo', workingDraft: 'Borrador de trabajo', previewCanvas: 'Vista previa', previewFailed: 'La vista previa no se puede dibujar', emptyDrag: 'Arrastra materiales a la línea de tiempo', emptyOr: 'o añádelos desde el panel de medios derecho', problemsCount: (n) => `${n} ${pluralForm('es', n, { one: 'elemento no se puede dibujar', other: 'elementos no se pueden dibujar' })}`, problemsTitle: 'Parte del contenido de este fotograma no se puede dibujar', rendererFailed: (message) => `El renderizador de vista previa no se cargó: ${message}`, spectrumTooLarge: (itemId, assetId, mb) => `Forma de onda ${itemId}: el material ${assetId} supera ${mb} MB, por lo que la vista previa no analiza su sonido; la exportación no se ve afectada`,
  stall: {
    loading: 'Cargando vista previa',
    title: 'La vista previa se ha quedado atascada',
    engine: 'El motor de vista previa aún se está cargando',
    video: 'Aún se está preparando este vídeo',
    media: (name: string) => `Esperando el medio: ${name}`,
    mediaUnnamed: 'Esperando los medios',
    preparing: 'Preparando la vista previa',
    converting: (name: string) => `Convirtiendo para poder reproducir: ${name}`,
    convertingUnnamed: 'Convirtiendo el medio para poder reproducirlo',
    once: 'Solo ocurre la primera vez que se abre. Tu archivo original no cambia.',
    prepare: (name: string) => `La conversión del medio no avanza: ${name}`,
    prepareUnnamed: 'La conversión del medio no avanza',
    captions: (name: string) => `Esperando los subtítulos: ${name}`,
    captionsUnnamed: 'Esperando los subtítulos',
    fonts: (name: string) => `Esperando las fuentes: ${name}`,
    paint: 'La imagen dejó de actualizarse',
    body: (seconds: number) => `Han pasado ${seconds} s. Reintentar solo vuelve a cargar la vista previa; tu vídeo no cambia.`,
  },
};
