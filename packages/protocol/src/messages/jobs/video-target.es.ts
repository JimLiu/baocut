import type { JobsVideoTargetMessages } from './video-target.ts';
export const es: JobsVideoTargetMessages = {
 stepLabel: 'Resolver destino', notSameVideo: 'hace referencia a un vídeo diferente de videoId', targetShapeOneOf: 'debe ser uno de { videoId }, { entryId } o { create }',
 createUnsupported: 'Este flujo no puede crear un vídeo: proporciona uno existente (videoId o entryId)', createShape: 'debe ser { projectId, name? } o { conversationId, name? }', mediaNotAllowed: 'no se puede proporcionar: los medios son el resultado de este flujo',
 unknownField: (p) => `tiene un campo desconocido ${p.key}`, scopeOnlyOne: 'solo acepta uno de projectId y conversationId', scopeRequired: 'necesita projectId o conversationId', nameLength: 'debe tener entre 1 y 200 caracteres', mediaPath: 'debe ser una ruta absoluta a un archivo multimedia local',
};
