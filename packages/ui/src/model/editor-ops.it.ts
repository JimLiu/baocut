import type { EditorOpsMessages } from './editor-ops.ts';
import { pluralForm } from '@baocut/protocol';

export const it: EditorOpsMessages = {
  dubStatus: { failed: 'Non sintetizzato', 'needs-fit': 'Troppo lungo', stale: 'Traduzione non aggiornata', draft: 'Non posizionato' },
  dubStatusCount: (n, status) => pluralForm('it', n, { one: `${n} frase ${{ failed: 'non sintetizzata', 'needs-fit': 'troppo lunga', stale: 'con traduzione non aggiornata', draft: 'non posizionata' }[status]}`, other: `${n} frasi ${{ failed: 'non sintetizzate', 'needs-fit': 'troppo lunghe', stale: 'con traduzione non aggiornata', draft: 'non posizionate' }[status]}` }),
  stemVocals: 'Voci separate', stemBackground: 'Sfondo separato', background: 'Sfondo',
  sentenceN: (n: number) => `Frase ${n}`,
  dub: 'Doppiaggio',
  files: (n: number) => `${n} file`,
  sentences: (n: number) => pluralForm('it', n, { one: `${n} frase`, other: `${n} frasi` }),
  muted: (n: number) => pluralForm('it', n, { one: `${n} frase con audio disattivato`, other: `${n} frasi con audio disattivato` }),
  dubTitle: (language: string | null) => `Doppiaggio · ${language ?? 'Lingua sconosciuta'}`,
  aside: (groups: number, files: number) => `${groups ? `${pluralForm('it', groups, { one: `${groups} gruppo di doppiaggio`, other: `${groups} gruppi di doppiaggio` })} · ` : ''}${files} file`,
};
