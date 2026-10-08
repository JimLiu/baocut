import type { JobsCaptionLayerMessages } from './caption-layer.ts';
export const es: JobsCaptionLayerMessages = {
 label: 'Añadir capa de subtítulos', noSource: 'No hay un documento para el que añadir una capa de subtítulos',
 videoClosed: 'El vídeo se cerró, por lo que no se añadió una capa de subtítulos. Abre el vídeo y vuelve a intentarlo.',
 empty: 'El documento no tiene subtítulos que mostrar, por lo que no se añadió una capa de subtítulos',
 notOnTimeline: 'Ningún clip de la línea de tiempo usa este material, por lo que los subtítulos no pueden aparecer en pantalla. No se añadió una capa de subtítulos.',
 noDocumentId: 'Se añadió la capa de subtítulos, pero no se devolvió su ID de documento', rejected: 'Se rechazó la transacción para añadir la capa de subtítulos',
 documentGone: 'El documento de la capa de subtítulos ya no está en el vídeo', needsOutputStore: 'Leer los subtítulos de Speech Worker requiere el almacén de resultados',
 notSpeech: 'El documento no es una transcripción', speechUnreadable: 'No se pudo leer el cuerpo de la transcripción', translationUnreadable: 'No se pudo leer el cuerpo de la traducción',
 unaligned: (p) => `${p.count} unidades de traducción no están alineadas (alignment es null), por lo que no se puede calcular su temporización`,
 noSourceSpeech: 'No se encontró la transcripción de la que procede esta traducción', subtitlesName: 'Subtítulos', translationName: 'Traducción', styleName: 'Estilo de subtítulos',
};
