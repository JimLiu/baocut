import type { ToolTargetsMessages } from './tool-targets-copy.ts';
export const es: ToolTargetsMessages = {
  unknownLanguage: 'Idioma desconocido',
  langCount: (label: string, count: number) => `${label} ×${count}`,
  joinLangs: (labels: readonly string[]) => labels.join(', '),
  tagTranscript: (langs: string) => `Transcripción · ${langs}`,
  tagTranslation: (langs: string) => `Traducción · ${langs}`,
  tagDub: (langs: string) => `Doblaje · ${langs}`,
  tagPending: 'Aún se está leyendo el contenido; se elegirá una transcripción al comenzar',
  blockTranscribing: 'Transcribiendo; podrás retranscribir al terminar',
  blockQueued: 'Ya está en cola para transcribir',
  blockTranscribingWait: 'Transcribiendo; podrás elegirlo al terminar',
  blockQueuedWait: 'En cola para transcribir; podrás elegirlo cuando esté transcrito',
  blockFailed: 'La última transcripción falló; primero vuelve a transcribirlo',
  blockNoTranscript: 'Aún no hay transcripción; primero transcríbelo',
  duplicateTranscript: (langs: string) =>
    `Este vídeo ya tiene una transcripción en ${langs}. Por defecto se crea un vídeo nuevo y este vídeo y sus traducciones no cambian. Con «Sustituir la transcripción de este vídeo» se cambia la transcripción actual: las traducciones se trasladan emparejando el original, las frases cuyo original cambió se marcan como desactualizadas y todo es un único cambio que puedes deshacer.`,
  duplicateTranslation: (lang: string) =>
    `Este vídeo ya tiene una traducción en ${lang}. Esto añade otra y conserva la existente; elige cuál usar en el editor.`,
  duplicateDub: (lang: string) => `Este vídeo ya tiene un doblaje en ${lang}. Esto añade otro conjunto y conserva el existente.`,
  duplicateTitle: {
    transcribe: 'Este vídeo ya tiene transcripción',
    'translate-subtitles': 'Se conservan las traducciones existentes',
    dub: 'Se conservan los doblajes existentes',
  },
  translationOption: (lang: string, nth: number | null) => `Traducción en ${lang}${nth === null ? '' : ` #${nth}`}`,
  translatedFrom: (lang: string) => `De la transcripción en ${lang}`,
  destNewVideo: 'Vídeo nuevo',
  destNewVideoNote: 'Un vídeo nuevo en el mismo proyecto que enlaza el mismo recurso; este vídeo y sus traducciones no cambian',
  destReplace: 'Sustituir la transcripción de este vídeo',
  destReplaceNote:
    'Cambia la transcripción actual; traducciones, subtítulos y doblajes se trasladan en el mismo cambio, que puedes deshacer',
  newVideoName: (name: string) => `${name} · Retranscrito`,
  impactTranslation: (lang: string, units: number) => `${lang} · ${units} ${units === 1 ? 'frase' : 'frases'}`,
  impactDub: (lang: string, groups: number) =>
    `${lang} · ${groups} ${groups === 1 ? 'conjunto' : 'conjuntos'} · se conserva el doblaje de las frases cuya traducción no cambia, marcado como posiblemente desincronizado`,
  impactRule:
    'Las frases cuyo original no cambia conservan la traducción y su estado de revisión, alineadas por frase; las que cambiaron o no se pueden emparejar se marcan como desactualizadas y luego se traducen de nuevo con «Actualizar traducciones desactualizadas». Las cifras exactas aparecen en el resultado.',
  impactUndo: 'Un único cambio que puedes deshacer',
};
