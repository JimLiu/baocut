import type { ToolsGalleryMessages } from './tools-gallery.ts';
import { pluralForm } from '@baocut/protocol';
export const es: ToolsGalleryMessages = {
  transcode: 'Codificado en este ordenador con ffmpeg · no se ha subido nada',
  linkReady: 'Herramienta de descarga lista',
  pipelineMissing: 'Esta versión del Runtime aún no tiene un flujo para esta herramienta, por lo que no se puede usar por ahora',
  withRemedy: (message: string, remedy: string) => `${message}. ${remedy}`,
  localModels: (n: number) => `${n} ${pluralForm('es', n, { one: 'modelo local', other: 'modelos locales' })}`,
  cloudConnected: (n: number) => `${n} ${pluralForm('es', n, { one: 'proveedor en línea conectado', other: 'proveedores en línea conectados' })}`,
  noSpeech: 'Aún no hay un modelo de síntesis de voz disponible',
  noImage: 'Aún no hay un modelo de generación de imágenes disponible',
  noText: 'Aún no hay un modelo de texto disponible',
};
