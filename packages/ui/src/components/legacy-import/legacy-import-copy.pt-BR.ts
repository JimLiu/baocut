import { pluralForm } from '@baocut/protocol';
import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const ptBR: LegacyImportMessages = {
  title: 'Importar projetos de uma versão anterior?',
  lead: (n) =>
    pluralForm('pt-BR', n, {
      one: `Há ${n} projeto de uma versão anterior do BaoCut neste computador. Importe-o para continuar editando nesta versão. Os arquivos originais ficam onde estão, sem alterações.`,
      other: `Há ${n} projetos de uma versão anterior do BaoCut neste computador. Importe-os para continuar editando nesta versão. Os arquivos originais ficam onde estão, sem alterações.`,
    }),
  found: 'Projetos encontrados',
  destination: 'Importar para',
  resetDefault: 'Usar local padrão',
  change: 'Alterar…',
  pickTitle: 'Escolha onde importar',
  destinationNote: 'Esta pasta aparece como um projeto em Home, e cada projeto anterior vira um vídeo dentro dela.',
  hint: 'Se pular, você será perguntado de novo na próxima vez que o BaoCut iniciar. Marque “Não lembrar novamente” para nunca importá-los.',
  never: 'Não lembrar novamente',
  skip: 'Pular',
  import: 'Importar',
  importing: (n) =>
    pluralForm('pt-BR', n, {
      one: `Importando ${n} projeto anterior em segundo plano`,
      other: `Importando ${n} projetos anteriores em segundo plano`,
    }),
  neverDone: 'Você não será mais lembrado de importar projetos anteriores. Os arquivos originais ficam como estão.',
  skipped: 'Pulado. Você será perguntado de novo na próxima vez que o BaoCut iniciar.',
  failed: (message) => `Não foi possível importar: ${message}`,
};
