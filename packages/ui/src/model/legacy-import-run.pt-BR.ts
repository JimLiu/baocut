import { pluralForm } from '@baocut/protocol';
import type { LegacyImportRunMessages } from './legacy-import-run.ts';

const imported = (n: number) => pluralForm('pt-BR', n, { one: `${n} importado`, other: `${n} importados` });
const notImported = (n: number) => pluralForm('pt-BR', n, { one: `${n} não importado`, other: `${n} não importados` });
const stillNotImported = (n: number) =>
  pluralForm('pt-BR', n, { one: `${n} ainda não importado`, other: `${n} ainda não importados` });

export const ptBR: LegacyImportRunMessages = {
  offlineTitle: (name) => `A unidade “${name}” não está conectada`,
  offlineWhy: (n, root) =>
    pluralForm('pt-BR', n, {
      one: `Os vídeos usados por este projeto estão nesta unidade (${root}), que não pode ser lida agora.`,
      other: `Os vídeos usados por estes ${n} projetos estão nesta unidade (${root}), que não pode ser lida agora.`,
    }),
  offlineFix:
    'Conecte a unidade e clique em “Tentar novamente”. Se você não fizer nada, o BaoCut tenta de novo na próxima vez que iniciar. Se não precisar mais da mídia, clique em “Pular” para não importar.',
  offlineShort: (n, name) =>
    pluralForm('pt-BR', n, {
      one: `${n} projeto tem a mídia em “${name}”, que não está conectada`,
      other: `${n} projetos têm a mídia em “${name}”, que não está conectada`,
    }),
  missingTitle: 'Os arquivos de mídia não estão onde estavam',
  missingWhy:
    'Arquivos usados pelo projeto foram movidos, renomeados ou excluídos, então os caminhos salvos no projeto anterior não os encontram mais.',
  missingFix:
    'Coloque os arquivos de volta onde estavam e clique em “Tentar novamente”. Se não conseguir recuperá-los, clique em “Pular”.',
  missingShort: (n) =>
    pluralForm('pt-BR', n, {
      one: `${n} projeto tem arquivos de mídia que não foram encontrados`,
      other: `${n} projetos têm arquivos de mídia que não foram encontrados`,
    }),
  unreadableTitle: 'Não é possível ler o arquivo do projeto anterior',
  unreadableWhy: 'O arquivo do projeto anterior pode estar danificado, então tentar novamente provavelmente não vai adiantar.',
  unreadableFix:
    'Mostre-o na pasta para verificar se o original ainda está lá e abre na versão anterior. Se não precisar dele, clique em “Pular”.',
  unreadableShort: (n) =>
    pluralForm('pt-BR', n, {
      one: `${n} arquivo de projeto não pode ser lido`,
      other: `${n} arquivos de projeto não podem ser lidos`,
    }),
  failedTitle: 'A importação parou no meio',
  failedWhy: 'O projeto foi lido, mas a importação parou no meio. O relatório de importação registra o que aconteceu.',
  failedFix:
    'Clique em “Tentar novamente” para tentar de novo. Se continuar falhando, mostre o relatório na pasta. Se não precisar do projeto, clique em “Pular”.',
  failedShort: (n) =>
    pluralForm('pt-BR', n, {
      one: `${n} projeto parou no meio da importação`,
      other: `${n} projetos pararam no meio da importação`,
    }),
  missingMany: (n, first) => `Faltam ${n} arquivos, por exemplo ${first}`,
  missingOne: (file) => `Falta ${file}`,
  missingNone: 'Arquivos de mídia não encontrados',
  failedReport: (report) => `Relatório de importação: ${report}`,
  failedNoReport: 'Nenhum relatório de importação foi gravado',
  note: (parts) => `${parts.join('; ')}.`,
  hintOffline: (name) =>
    `Conecte “${name}” e clique em “Tentar todos novamente”. Se você não fizer nada, o BaoCut tenta de novo na próxima vez que iniciar. Para resolver um por um, abra os detalhes.`,
  hintOther: 'O motivo e o que fazer com cada um estão nos detalhes. Você pode pular os que não precisar.',
  subProgress: (done, total) => `Importados ${done}/${total}`,
  subImported: (n) => `Importados ${n}`,
  subPending: (n) => `A resolver ${n}`,
  subSkipped: (n) => `Pulados ${n}`,
  subDest: (dest) => `Para ${dest}`,
  attention: (n) => `${n} a resolver`,
  phaseImporting: 'Importando',
  phaseWaiting: 'Aguardando outras tarefas',
  detailImporting: (title) => `Importando “${title}”`,
  detailWaiting:
    'Outras tarefas estão em andamento, então a importação está pausada. Ela continua automaticamente quando elas terminarem.',
  bannerRunning: (done, total) => `Importando projetos anteriores · ${done}/${total}`,
  bannerResult: (done, pending) => `Importação de projetos anteriores concluída: ${imported(done)}, ${notImported(pending)}`,
  doneAll: (n) =>
    pluralForm('pt-BR', n, { one: `${n} projeto anterior importado`, other: `${n} projetos anteriores importados` }),
  doneSome: (done, pending) => `Importação concluída: ${imported(done)}, ${notImported(pending)}`,
  retriedAll: (n) =>
    pluralForm('pt-BR', n, {
      one: 'O projeto tentado novamente foi importado',
      other: `Todos os ${n} projetos tentados novamente foram importados`,
    }),
  retriedSome: (n, ok) => `Dos ${n} tentados novamente, ${imported(ok)} e ${stillNotImported(n - ok)}`,
  retriedNone: (n) =>
    pluralForm('pt-BR', n, {
      one: 'O projeto tentado novamente ainda não foi importado',
      other: `Os ${n} projetos tentados novamente ainda não foram importados`,
    }),
  retrying: (n) => pluralForm('pt-BR', n, { one: `Importando ${n} projeto de novo`, other: `Importando ${n} projetos de novo` }),
  skipped: (n) =>
    pluralForm('pt-BR', n, {
      one: `${n} projeto pulado. Ele não será importado automaticamente.`,
      other: `${n} projetos pulados. Eles não serão importados automaticamente.`,
    }),
  actionFailed: (message) => `Não foi possível fazer isso: ${message}`,
  undo: 'Desfazer',
  viewReasons: 'Ver motivo',
  viewInSpace: 'Ver no Space',
  viewProgress: 'Ver progresso',
  close: 'Fechar',
  retryAll: 'Tentar todos novamente',
  skipAll: 'Pular todos',
  retry: 'Tentar novamente',
  skip: 'Pular',
  reveal: 'Mostrar na pasta',
  importInstead: 'Importar',
  statImported: 'Importados',
  statPending: 'Não importados',
  statSkipped: 'Pulados',
  statLive: 'Ainda não importados',
  pendingSection: 'Projetos não importados',
  pendingHint: 'Se você não fizer nada, o BaoCut tenta de novo na próxima vez que iniciar. Os pulados não são importados.',
  howTo: 'O que fazer: ',
  groupTitle: (title, n) => `${title} · ${n}`,
  liveSection: 'Importando',
  importingChip: 'Importando',
  queuedChip: 'Na fila',
  importedSection: 'Importados',
  skippedSection: 'Pulados',
  skippedHint: 'Eles não serão importados automaticamente. Os arquivos originais ficam onde estão.',
  expand: (n) => `Mostrar mais ${n}`,
  collapse: 'Mostrar menos',
};
