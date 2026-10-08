import type { EditorOpsMessages } from './editor-ops.ts';
import { pluralForm } from '@baocut/protocol';
const DUB_STATUS = { failed: 'Sin sintetizar', 'needs-fit': 'Demasiado largo', stale: 'Traducción desactualizada', draft: 'Sin colocar' } as const;
const filesEs = (n: number) => `${n} ${pluralForm('es', n, { one: 'archivo', other: 'archivos' })}`;
const sentencesEs = (n: number) => `${n} ${pluralForm('es', n, { one: 'frase', other: 'frases' })}`;
export const es: EditorOpsMessages = {
  dubStatus: DUB_STATUS,
  dubStatusCount: (n, status) => `${sentencesEs(n)} ${{ failed: 'sin sintetizar', 'needs-fit': 'con duración excesiva', stale: 'con traducción desactualizada', draft: 'sin colocar' }[status]}`,
  stemVocals: 'Voces separadas', stemBackground: 'Fondo separado', background: 'Fondo', sentenceN: (n) => `Frase ${n}`, dub: 'Doblaje',
  files: filesEs, sentences: sentencesEs, muted: (n) => `${sentencesEs(n)} ${pluralForm('es', n, { one: 'silenciada', other: 'silenciadas' })}`,
  dubTitle: (language) => `Doblaje · ${language ?? 'Idioma desconocido'}`,
  aside: (groups, files) => groups ? `${groups} ${pluralForm('es', groups, { one: 'grupo de doblaje', other: 'grupos de doblaje' })} · ${filesEs(files)}` : filesEs(files),
};
