import type { EditorOpsMessages } from './editor-ops.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: EditorOpsMessages = {
  dubStatus: { failed: 'Não sintetizado', 'needs-fit': 'Longo demais', stale: 'Tradução desatualizada', draft: 'Não colocado' },
  dubStatusCount: (n, status) => pluralForm('pt-BR', n, { one: `${n} frase ${{ failed: 'não sintetizada', 'needs-fit': 'longa demais', stale: 'com tradução desatualizada', draft: 'não colocada' }[status]}`, other: `${n} frases ${{ failed: 'não sintetizadas', 'needs-fit': 'longas demais', stale: 'com tradução desatualizada', draft: 'não colocadas' }[status]}` }),
  stemVocals: 'Vocais separados', stemBackground: 'Fundo separado', background: 'Plano de fundo',
  sentenceN: (n: number) => `Frase ${n}`,
  dub: 'Dublagem',
  files: (n: number) => pluralForm('pt-BR', n, { one: `${n} arquivo`, other: `${n} arquivos` }),
  sentences: (n: number) => pluralForm('pt-BR', n, { one: `${n} frase`, other: `${n} frases` }),
  muted: (n: number) => pluralForm('pt-BR', n, { one: `${n} frase silenciada`, other: `${n} frases silenciadas` }),
  dubTitle: (language: string | null) => `Dublagem · ${language ?? 'Idioma desconhecido'}`,
  aside: (groups: number, files: number) => `${groups ? `${pluralForm('pt-BR', groups, { one: `${groups} grupo de dublagem`, other: `${groups} grupos de dublagem` })} · ` : ''}${pluralForm('pt-BR', files, { one: `${files} arquivo`, other: `${files} arquivos` })}`,
};
