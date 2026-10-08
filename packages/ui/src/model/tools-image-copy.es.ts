import type { ToolsImageMessages } from './tools-image-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: ToolsImageMessages = {
  emptyPrompt: 'Primero describe la imagen',
  promptTooLong: (n: number, max: number) => `El prompt tiene ${n} caracteres · este modelo admite como máximo ${max}`,
  maxImages: (max: number) => `Hasta ${max} ${pluralForm('es', max, { one: 'imagen', other: 'imágenes' })} a la vez`,
  seedInteger: 'La semilla debe ser un número entero', pickModel: 'Primero elige un modelo',
  downloadFirst: (label: string) => `Primero descarga ${label}`,
  connectFirst: (provider: string) => `Primero conecta ${provider}`,
  local: 'En este ordenador', steps: (n: number) => `${n} ${pluralForm('es', n, { one: 'paso', other: 'pasos' })}`,
  deviceTime: 'El tiempo depende de tu dispositivo', offline: 'Funciona sin conexión',
  images: (n: number) => `${n} ${pluralForm('es', n, { one: 'imagen', other: 'imágenes' })}`,
  aspects: (n: number) => `${n} ${pluralForm('es', n, { one: 'relación de aspecto', other: 'relaciones de aspecto' })}`,
  providerSize: 'Tamaño establecido por el proveedor', takesSeed: 'Admite una semilla',
  localChip: 'Generado en este ordenador · sin conexión',
  cloudChip: (provider: string) => `En línea · ${provider} · facturado por uso`,
  imageName: (n: number) => `Imagen ${n}`, seed: (seed: number) => `Semilla ${seed}`,
  decoding: 'Decodificando', stepOf: (done: number, total: number) => `Paso ${done}/${total}`,
};
