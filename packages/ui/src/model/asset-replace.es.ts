import type { AssetReplaceMessages } from './asset-replace.ts';
import { pluralForm } from '@baocut/protocol';
const KIND_TEXT = { video: 'vídeo', image: 'imagen', audio: 'audio' } as const;
export const es: AssetReplaceMessages = {
  cantReplaceKind: 'Este tipo de material aún no se puede reemplazar.',
  sameKind: (kind) => `Solo puedes reemplazarlo con material del mismo tipo: se necesita material de ${KIND_TEXT[kind]}.`,
  sameAsset: 'Ese es el material actual. Elige otro.',
  unused: 'Este material no se usa en la línea de tiempo, por lo que no hay nada que reemplazar.',
  tooShort: 'El material nuevo es demasiado corto para llenar un solo fotograma.',
  allLocked: 'Todos los clips que lo usan están bloqueados (o son sustitutos prerrenderizados de una composición). Primero desbloquéalos.',
  clipLocked: 'Este clip está bloqueado. Primero desbloquéalo.',
  durationUnknown: 'Se desconoce la duración del material, por lo que los clips conservan su duración actual por ahora.',
  longEnoughMany: 'El material nuevo tiene suficiente duración. Ninguno de estos clips cambia de duración y la línea de tiempo sigue igual.',
  longEnoughOne: 'El material nuevo tiene suficiente duración. El clip conserva su duración y la línea de tiempo sigue igual.',
  shortenMany: (n, seconds) => `${pluralForm('es', n, { one: `Se acorta ${n} clip`, other: `Se acortan ${n} clips` })}, ${seconds} s en total`,
  shortenOne: (seconds) => `El clip se acorta ${seconds} s`,
  moved: (head, n) => `${head}, y ${pluralForm('es', n, { one: 'el siguiente clip de la pista se adelanta', other: `los siguientes ${n} clips de la pista se adelantan` })}.`,
  trackShorter: (head) => `${head}, y la pista se acorta.`,
  transitions: (n) => n === 1 ? 'Se eliminará la transición de estos clips.' : `Se eliminarán las ${n} transiciones de estos clips.`,
  captions: (n) => `${pluralForm('es', n, { one: `${n} subtítulo está sincronizado`, other: `${n} subtítulos están sincronizados` })} con estos clips y será necesario ajustar su alineación después del reemplazo.`,
  ducking: (n) => pluralForm('es', n, { one: `${n} regla de atenuación apunta a estos clips y no coincidirá después del reemplazo.`, other: `${n} reglas de atenuación apuntan a estos clips y no coincidirán después del reemplazo.` }),
};
