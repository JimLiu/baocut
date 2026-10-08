import type { VideoInfoMessages } from './video-info-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: VideoInfoMessages = {
  section: { media: 'Origen y medios', source: 'Información de origen' },
  speakers: (count: number) => `${count} ${pluralForm('es', count, { one: 'hablante', other: 'hablantes' })}`,
  chapters: (count: number) => `${count} ${pluralForm('es', count, { one: 'capítulo', other: 'capítulos' })}`,
  paragraphs: (count: number) => `${count} ${pluralForm('es', count, { one: 'párrafo', other: 'párrafos' })}`,
  list: (names: readonly string[]) => names.join(', '),
  sourceKind: { 'link-import': 'Importado desde URL', 'user-import': 'Archivo local', generated: 'Generado', library: 'Biblioteca del usuario' },
  row: { contents: 'Contenido', translation: 'Traducción', location: 'Ubicación', file: 'Archivo', media: 'Medios', transcript: 'Transcripción', channel: 'Canal', published: 'Publicado', platform: 'Plataforma', mediaId: 'ID de vídeo', url: 'URL', title: 'Título original', description: 'Descripción' },
};
