import type { LibraryMessages } from './library-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: LibraryMessages = {
 help: `Uso:
  baocut library import <file>     Importar un archivo de intercambio, detectando el tipo por contenido (no
                                   extensión): glosarios Markdown, paquetes de voces .bcvoice, JSON de colores
                                   y estilos de subtítulos del kit de marca, pegatinas Lottie, imágenes, vídeos y fuentes
  baocut library export <library> <id> <path>
                                   Exportar la versión actual: glosarios como Markdown, voces como .bcvoice,
                                   materiales de marca como archivo original; no se sobrescribe un destino existente
  baocut library remove <library> <id>
                                   Eliminar un elemento (no afecta al contenido ya copiado a vídeos)
  baocut library voice-clone <voice id> --provider <id> [--name <name>]
                                   Subir la grabación de referencia de la voz al proveedor para crear un clon
                                   (solo elevenlabs por ahora): requiere declaración de consentimiento y autorización
                                   de envío de datos que cubra "audio" (baocut grants create); es una tarea, Ctrl-C cancela
  baocut library voice-clone-remove <voice id> --provider <id> [--local-only]
                                   Eliminar un clon: pide al proveedor eliminarlo primero y después borra
                                   el registro si termina bien; --local-only solo borra el registro local
  baocut library video-selection <video id> [options]
                                   Elementos de biblioteca activados en el vídeo (guardados en él, se puede deshacer): se muestran
                                   sin opciones; las partes proporcionadas se reemplazan completas y el resto no cambia.
                                   Los vídeos nuevos activan automáticamente los glosarios marcados como "activado por defecto"
    --transcribe-glossaries <id,…> Glosarios de transcripción (usados cuando una transcripción
                                   no especifica ninguno); una cadena vacía los borra
    --translate-glossaries <id,…>  Glosarios de traducción (usados por translate y la
                                   traducción de dub); una cadena vacía los borra
    --speaker-voice <transcript id>:<speaker>=<voice>[@<Provider>]
                                   Voz de un hablante (repetible, reemplazada completa):
                                   library:<id> o ID de voz de un proveedor (entonces con @Provider)
    --clear-speaker-voices         Borrar las voces de los hablantes`,
 importUsage: 'Uso: baocut library import <file>', exportUsage: 'Uso: baocut library export <glossaries|voices|brand> <id> <path>', removeUsage: 'Uso: baocut library remove <glossaries|voices|brand> <id>', voiceCloneUsage: 'Uso: baocut library voice-clone <voice id> --provider <id> [--name <name>]', voiceCloneRemoveUsage: 'Uso: baocut library voice-clone-remove <voice id> --provider <id> [--local-only]', videoSelectionUsage: 'Uso: baocut library video-selection <video id> [--translate-glossaries <id,…>] [--speaker-voice …]…',
 imported: (label, id, name) => `Importado a ${label}: ${id}  ${name}`, exported: (id, version, file, bytes) => `Exportado ${id}, versión ${version}, a ${file} (${bytes} ${pluralForm('es', bytes, { one: 'byte', other: 'bytes' })})`, deleted: (id) => `Eliminado ${id}`, remoteCloneOutcome: { deleted: 'eliminado remotamente', 'not-found': 'la voz ya no estaba en el servicio remoto', skipped: 'sin contactar al servicio remoto' }, voiceCloneRemoved: (id, provider, remote) => `Eliminado el clon de ${id} en ${provider} (${remote})`, libraryLabels: { glossaries: 'Glosario', voices: 'Voz', brand: 'Kit de marca' }, unknownLibrary: (text) => `No existe esa biblioteca: ${text ?? '(falta)'}. Disponibles: glossaries, voices, brand`, speakerVoiceFormat: (text) => `--speaker-voice acepta <transcript id>:<speaker>=<voice>[@<Provider>]; se recibió ${text}`, listSep: ', ', none: '(ninguno)', selectionHead: (videoId, documentId, revision) => `Vídeo ${videoId}${documentId ? ` (documento library-selection ${documentId}, versión ${revision})` : ' (aún no hay nada activado)'}`, transcribeGlossaries: (list) => `Glosarios de transcripción: ${list}`, translateGlossaries: (list) => `Glosarios de traducción: ${list}`, speakerVoicesNone: 'Voces de hablantes: (ninguna)', speakerVoice: (documentId, speakerId, voice, providerId) => `Voz del hablante: ${documentId}:${speakerId} = ${voice}${providerId ? ` (solo en ${providerId})` : ''}`,
};
