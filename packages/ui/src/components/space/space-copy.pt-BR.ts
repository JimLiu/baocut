import { pluralForm } from '@baocut/protocol';
import { revealLabel } from '../../copy.ts';
import type { SpaceMessages } from './space-copy.ts';

const count = (n: number, one: string, many: string) => `${n} ${pluralForm('pt-BR', n, { one, other: many })}`;

export const ptBR: SpaceMessages = {
  searchPlaceholder: "Buscar nomes, arquivos ou falas nos vídeos",
  searchLabel: "Buscar no Space",

  openVideo: "Abrir vídeo",
  viewInfo: "Ver informações",
  transcribe: { first: 'Transcrever…', redo: 'Retranscrever…', retry: 'Tentar transcrever de novo…' },
  info: "Detalhes do vídeo…",
  view: "Ver",
  continue: "Continuar na sessão",
  favorite: "Favoritos",
  unfavorite: "Remover dos favoritos",
  rename: "Renomear",
  get reveal() {
    return revealLabel();
  },
  viewTask: "Ver tarefa",
  trash: "Mover à Lixeira",
  restore: "Restaurar da Lixeira",
  purge: "Excluir permanentemente",
  clear: "Limpar",
  columnMeasure: "Duração ou dimensões",
  columnStatus: "Estado",
  noValue: "—",
  favorited: "Favorito",

  statusPicker: "Estado",
  refreshMenu: "Atualizar",
  rescan: "Verificar pastas de projetos novamente",
  rescanHint: "Reler arquivos das pastas de projetos e sessões",
  rebuild: "Reconstruir índice",
  rebuildHint: "Descarta catálogo derivado e índice para reconstruir; favoritos, nomes e Lixeira mantidos",
  scanning: "Verificando pastas",
  rebuilt: (entries: number, pending: number) =>
    pending > 0
      ? `Índice reconstruído · ${count(entries, "item", "itens")} · índice de conteúdo de ${count(pending, "vídeo", "vídeos")} ainda atualizando em segundo plano`
      : `Índice reconstruído · ${count(entries, "item", "itens")}`,

  newLabel: "Novo",
  newBlank: "Novo vídeo vazio",
  newBlankHint: "Vídeo vazio 16:9 abre direto, sem transcrição ou fila",
  newFromFile: "Novo vídeo de arquivo",
  newFromFileHint: "Vídeo/áudio abre no compositor Home para pedir o que fazer; imagens vão à linha do tempo",
  newFromPackage: "Novo vídeo de pacote portátil",
  newFromPackageHint: "Um .baocut exportado com todas as mídias",
  pickPackageTitle: "Escolher pacote portátil",
  pickPackageButton: "Abrir",
  pickPackageFilter: "Pacote portátil BaoCut",
  openPackage: "Abrir como novo vídeo",
  packageBlocked: (reason: string) => `Abrir como novo vídeo: ${reason}`,
  packageOpening: (name: string) => `Abrindo “${name}"…`,
  packageOpened: (name: string) => `Aberto “${name}” como novo vídeo`,
  importAssets: "Importar mídias",
  importAssetsHint: "Registra arquivos como mídias de projeto; externos copiados para imports/",
  whichProject: "Qual projeto",
  noProject: "Abra uma pasta de projeto no Home primeiro",
  pickNotMedia: "Não é arquivo de vídeo, áudio ou imagem",
  createdFromFile: (name: string) => `Vídeo criado “${name}” e mídia colocada`,
  createdEmpty: (reason: string) => `Vídeo criado, mídia não colocada: ${reason}`,

  importTitle: "Importar mídias",
  importProject: "Importar ao projeto",
  importHint:
    "Escolha vídeo, áudio ou imagem. Arquivos internos registrados no local; externos copiados a imports/, originais mantidos. Nada adicionado a vídeo.",
  importPick: "Escolher arquivos…",
  importNoProject: "Sem projetos; abra pasta no Home primeiro.",
  importing: "Importando",

  factSource: "Fonte",
  factFile: "Arquivo",
  factMeasure: "Duração ou dimensões",
  factSize: "Tamanho",
  factStatus: "Estado",
  factActivity: "Atividade recente",
  factConversation: "Sessão de origem",
  factGenerated: "Gerar",
  factVersion: "Versão",
  factNote: "Notas",
  viewConversation: "Ver sessão de origem",
  close: "Fechar",
  editBlocked: (reason: string) => `Editar novamente: ${reason}`,
  continueBlocked: (reason: string) => `Continuar na sessão: ${reason}`,
  version: (frozen: string, current: string | null) =>
    current && current !== frozen ? `Versão do vídeo ${frozen}; o vídeo atual é ${current}` : `Versão do vídeo ${frozen}`,
  missingTitle: "Arquivo não encontrado",

  missingFile: "Arquivo não encontrado",
  missingBody: "Item ainda aqui; estado recupera quando o arquivo voltar.",
  failedTitle: "Geração falhou",
  failedBody: "Nenhum arquivo produzido. Veja motivo e repita em Tarefas, ou limpe se não precisar.",
  changedTitle: "Vídeo de origem mudou depois",
  changedBody: "Resultado corresponde a versão anterior. Ainda funciona, mas não reflete o vídeo atual.",
  reexport: "Exportar novamente da origem",
  noPreviewVideo: "Vídeos abrem no editor.",

  capability: {
    synthesizeSpeech: "Narração",
    generateImage: "Gerar imagem",
    generateText: "Texto gerado",
    export: "Exportar",
  } as Record<string, string>,

  trashed: (name: string) => `Movido à Lixeira · ${name}`,
  undo: "Desfazer",
  restored: (name: string) => `Restaurado · ${name}`,
  purged: (name: string) => `Excluído permanentemente · ${name}`,
  cleared: (name: string) => `Limpo · ${name}`,
  renamed: "Renomeado",
  continued: (created: boolean, name: string, title: string) =>
    created
      ? `Nova sessão com “${name}” anexado: escreva o pedido e envie`
      : `De volta a “${title}” com “${name}” anexado: escreva o pedido e envie`,
  sourceGone: "Vídeo de origem fora de pasta de projeto/sessão; não pode abrir",

  failed: (what: string, reason: string) => `${what} falhou: ${reason}`,

  trashVideoTitle: "Excluir este vídeo?",
  trashVideoBody: "A pasta inteira vai à Lixeira do projeto, restaurável. Mídias originais vinculadas ficam no local.",
  trashVideoRelated: (n: number) =>
    `${count(n, "item", "itens")} exportados ou gerados dele ficam no Space, não são excluídos com o vídeo:`,
  trashVideoConfirm: "Excluir vídeo",

  purgeTitle: "Excluir permanentemente?",
  purgeBody: (name: string) =>
    `“${name}” será excluído do disco, sem restaurar. Se vídeo ou tarefa ainda usa, nada excluído e os vínculos serão mostrados.`,
  purgeVideoBody: (name: string) =>
    `A pasta inteira do vídeo “${name}” será excluída sem restaurar. Mídias originais vinculadas inalteradas.`,
  purgeConfirm: "Excluir permanentemente",
  blockedTitle: "Ainda não pode excluir",
  blockedBody: (name: string) => `“${name}” está em uso, nada excluído:`,
  gotIt: "Entendi",

  renameTitle: "Renomear",
  renameLabel: "Nome de exibição",
  renameHint: (fileName: string) =>
    `Só muda nome no Space, não o arquivo. Vazio retoma “${fileName}".`,
  save: "Salvar",

  changedDialogTitle: "O vídeo de origem mudou",
  changedDialogBody: (frozen: string | null, current: string | null) =>
    `Resultado corresponde à versão ${frozen ?? "(desconhecido)"}; o vídeo atual é ${current ?? "(desconhecido)"}. A cópia de trabalho atual abrirá.`,
  changedOpenCurrent: "Abrir cópia de trabalho atual",
  changedFromFrozen: "Continuar daquela versão",
  changedFromFrozenReason:
    "Não pode continuar da versão exportada; Runtime não volta a uma versão. Abra a cópia atual e veja a versão no Histórico.",

  hitsTitle: "Falado nos vídeos",
  hitsCount: (n: number) => count(n, "correspondência", "correspondências"),
  hitsSearching: "Buscando no índice de conteúdo",
  hitsNone: "Nenhuma fala corresponde",
  hitsError: (reason: string) => `Não foi possível buscar no índice: ${reason}`,
  hitUnopenable: "Vídeo fora de projeto/sessão ou na Lixeira; não pode abrir",
  hitSourceClock: "Está numa mídia, não na linha do tempo; abra o vídeo e procure",
  hitStale: "Vídeo mudou após indexar; posição pode estar incorreta",

  hitsGrouped: (n: number, videos: number) => `${count(n, "correspondência", "correspondências")} · ${count(videos, "vídeo", "vídeos")}`,
  hitKind: "Tipo de documento",
  hitKindAll: "Todos os tipos",
  hitSpeaker: "Falante",
  hitSpeakerAll: "Todos os falantes",
  hitSpeakerNone: "Nenhum resultado tem falante",
  hitsNoneFiltered: "Nada neste tipo ou falante. Tente outro.",
  hitsMore: (n: number) => `Mostrar ${n} a mais`,

  cancel: "Cancelar",
  openForEdit: "Abrir no editor",
  newVideo: "Criar vídeo",
  revealUnavailable: "Arquivo fora de projeto/sessão; sem local para mostrar",
  sidebarLabel: "Categorias do Space",
  kindsHeader: "Categorias",
  mineHeader: "Organizar resultados",
  sidebarNote: "Space mostra vídeos, mídias e resultados dos projetos. Arquivos ficam nas pastas próprias.",
  all: "Todos",
  emptyFiltered: "Sem itens correspondentes",
  emptyTrash: "Lixeira vazia",
  emptyFavorite: "Sem favoritos ainda",
  emptyAll: "Sem itens ainda",

  emptyCategory: (label: string) => `Nada em ${label} ainda`,
  emptyFilteredBody: "Tente outras palavras ou limpe filtros de projeto e estado.",
  emptyTrashBody: "Itens na Lixeira aparecem aqui; restaure ou exclua permanentemente.",
  emptyBody: "Peça ao agente; resultados aparecem aqui. Importe mídias em “Novo” ou abra pasta no Home.",
  projectPicker: "Projetos",
  allProjects: "Todos os projetos",
  sortPicker: "Ordenar",
  viewPicker: "Ver",
  viewGrid: "Grade",
  viewList: "Lista",
  issuesTitle: (n: number) => (pluralForm('pt-BR', n, { one: `${n} pasta não listada inteira`, other: `${n} pastas não listadas inteiras` })),
  issueTruncated: (detail: string) => `Arquivos demais, lista parcial: ${detail}`,
  issueUnreadable: (detail: string) => `Não foi possível ler: ${detail}`,
  preparing: "Preparando Space…",
  preparingBody: "Na primeira vez, precisa verificar pastas. Aguarde um momento.",

  createIn: (project: string, hint: string) => `Em “${project}" · ${hint}`,

  whichProjectFor: (label: string) => `${label}: qual projeto`,
  entryActions: (name: string) => `Ações de “${name}”`,
  entriesLabel: "Itens do Space",
  columnName: "Nome",
  columnKind: "Tipo",
  columnSource: "Fonte",
  columnActivity: "Atividade recente",
  columnMenu: "Ações",

  relatedMore: (n: number) => `…${n} no total`,

  importSummaryIn: (text: string, project: string) => `${text} (${project})`,

  activityAt: (ago: string, at: string) => `${ago} (${at})`,

  withReason: (reason: string, body: string) => `${reason}. ${body}`,
};
