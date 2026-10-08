import type { SpaceSearchMessages } from './space-search.ts';
import { pluralForm } from '@baocut/protocol';
export const es: SpaceSearchMessages = {
 documentKind: { speech: 'Transcripción', caption: 'Subtítulos', translation: 'Traducción', chapter: 'Capítulo' },
 pendingVideos: (count) => `El índice de contenido de ${count} ${pluralForm('es', count, { one: 'vídeo', other: 'vídeos' })} no ha terminado de actualizarse; pueden faltar vídeos en los resultados o estar desactualizados`,
 indexUpdating: 'El índice de contenido se está actualizando; los resultados pueden estar desactualizados',
 truncated: (count) => `Demasiadas coincidencias; se muestran solo las primeras ${count}`,
 notes: (notes) => `${notes.join('; ')}.`, sourceTime: (clock) => `Tiempo del material ${clock}`,
};
