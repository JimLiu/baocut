import type { RestoreRefusal } from '../../model/transcript-cut.ts';
import type { TranscriptMessages, TranscriptToolsMessages } from './transcript-copy.ts';

import { pluralForm } from '@baocut/protocol';
import { secondsLabel } from './transcript-copy.ts';
export const ptBRSeconds = (seconds: number): string => seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1).replace('.', ',')} s` : `${Math.round(seconds)} s`;
const words = (n: number) => `${n} ${pluralForm('pt-BR', n, { one: 'palavra', other: 'palavras' })}`;

export const ptBRTranscript: TranscriptMessages = {
  title: "Transcrição",
  modes: "Modo de edição da transcrição",
  modeEdit: "Editar texto",
  modeCut: "Cortar mídia",

  hintEdit: "Muda só texto; vídeo e áudio ficam iguais. Duplo clique edita palavra; ⌫ exclui só texto.",
  hintCut: "Selecione texto e pressione ⌫ para cortar vídeo, áudio e legendas juntos. Palavras ficam riscadas e restauráveis.",

  emptyTitle: "Ainda sem transcrição",
  emptyNoMedia: "Adicione vídeo ou áudio. Após transcrever, as palavras aparecem aqui.",
  emptyNotPlaced: "Vídeo ou áudio fora da linha do tempo. Coloque e transcreva para ver o texto aqui.",
  emptyNotTranscribed: "Mídias na linha do tempo não transcritas. Transcreva em Legendas para ver o texto.",
  gotoSubtitle: "Transcrever em Legendas",
  addMedia: "Adicionar mídia",
  loading: "Carregando transcrição…",
  noWords: "Esta transcrição não tem palavras para mostrar.",
  notSpeech: "Formato desta transcrição não reconhecido.",


  stats: (count: number, cut: number) => (cut ? `${words(count)} · ${cut} cortadas` : words(count)),
  jump: "Ir aqui",
  cutWordTitle: "Cortar da linha do tempo",
  partialWordTitle: "Corte dentro desta palavra; só parte permanece na linha do tempo",

  selected: (count: number, seconds: number | null) =>
    seconds === null ? `${words(count)} selecionadas` : `${words(count)} selecionadas · ${secondsLabel(seconds)}`,
  cut: "Cortar",
  restore: "Restaurar",
  editWord: "Editar palavra",
  deleteText: "Excluir texto",
  clear: "Limpar seleção · Esc",
  aiFind: "Identificar cortes",
  aiFindHint: "Ou deixe a IA achar vícios de linguagem e pausas primeiro",

  cutDone: (seconds: number, ranges: number) =>
    ranges > 1 ? `O corte ${secondsLabel(seconds)} · ${ranges} intervalos` : `O corte ${secondsLabel(seconds)}`,
  cutNothing: "Palavras selecionadas fora da linha do tempo; nada para cortar.",
  cutTooShort: "Seleção menor que um quadro, não pode cortar.",
  restoreDone: (seconds: number) => `Restauradas ${secondsLabel(seconds)}`,
  restoreNotRelaid: "Alguns cortes não têm junção correspondente; removidos da lista, mas o conteúdo não voltou.",
  restoreRefused: {
    untracked: "Este intervalo foi removido sem corte (como aparar borda); não há corte para restaurar. Arraste a borda para recuperar.",
    partial: "Só parte foi cortada; intervalo não alterável. Clique na faixa do corte para restaurar essa parte primeiro.",
  } satisfies Record<RestoreRefusal, string>,
  textSaved: "Texto atualizado · vídeo e áudio inalterados",
  textDeleted: (count: number) => `Texto excluído de ${words(count)} · vídeo e áudio inalterados`,

  stale: (count: number) =>
    pluralForm('pt-BR', count, { one: `${count} faixa de legendas veio de transcrição antiga e não foi atualizada.`, other: `${count} faixas de legendas vieram de transcrição antiga e não foram atualizadas.` }),
  gotoCaptions: "Abrir Legendas",
  undo: "Desfazer",

  seamLabel: (seconds: number) => `O corte ${secondsLabel(seconds)} · clique para restaurar`,
  cutLabel: "Cortar na transcrição",
  restoreLabel: "Restaurar conteúdo cortado",
  liveCopy: "Copiar o que já foi transcrito",
  liveCopied: "Copiado o que já foi transcrito · a transcrição continua",
  liveSpeaker: "Reconhecendo",
  liveWaiting: "O texto reconhecido aparece aqui conforme chega. Alguns serviços devolvem tudo só no final.",
  liveNote: "O texto reconhecido aparece parágrafo por parágrafo. Você poderá editá-lo quando a transcrição terminar.",
  liveJump: "Ir para o mais recente",
  liveSaving: "Salvando a transcrição",
};

export const ptBRTranscriptTools: TranscriptToolsMessages = {

  toolsMenu: "Organizar transcrição",
  toolsTidy: "Organizar toda a transcrição",
  toolsFrom: "Começar pela transcrição",

  findTip: "Localizar e substituir · ⌘F",
  findLabel: "Localizar e substituir",
  findPlaceholder: "Localizar na transcrição",

  lockTranslation: "Traduções podem ser buscadas, não editadas; o painel Transcrição só altera o original",
  lockLoading: "Uma versão nova está carregando; substitua após concluir",
  replaceLabel: "Substituir texto da transcrição",
  replaceDone: (count: number) => `Substituídos ${count} ${pluralForm('pt-BR', count, { one: "correspondência", other: "correspondências" })} · vídeo e áudio inalterados`,
  replaceNothing: "Sem correspondências para alterar",

  copyMenu: "Copiar transcrição",
  copyAllHead: (lang: string) => `Copiar tudo · ${lang}`,
  copyText: "Copiar texto",
  copySpeaker: "Com falantes",
  copyTimed: "Com códigos de tempo e falantes",
  copyScopeHead: (scope: string) => `Copiar ${scope}`,
  copied: (scope: string, receipt: string) => `Copiado ${scope} · ${receipt}`,
  copyFailed: "Falha ao copiar · o navegador negou acesso à área de transferência",
  copyEmpty: "Nada para copiar",
  scopeAll: "tudo",
  scopePara: "este parágrafo",
  scopeChapter: (title: string) => `“${title}”`,
  scopeSelection: "texto selecionado",
  copySelection: "Copiar",
  copySelectionTip: "Copiar seleção · ⌘C",

  langLabel: "Idioma da transcrição",
  langSource: "Original",
  langTranslation: "Tradução",
  langBoth: (source: string, translation: string) => `${source} + ${translation}`,
  showBoth: "Mostrar original ao lado",
  showBothNeedsTranslation: "Escolha tradução primeiro",
  showBothHint: "Lado a lado",
  noTranslation: "Ainda sem tradução",
  noTranslationHint: "Traduza em Legendas com “+ Traduzir para…”",
  translationNote: "Traduções seguem reprodução por parágrafo; só o original tem tempos por palavra, destaque por palavra seria inventado.",
  translationOnly: "Não edite ou corte só com tradução; volte ao original ou lado a lado.",
  noParagraphTranslation: "Este parágrafo não tem tradução",

  paraMenu: "Este parágrafo…",
  moveUp: "Mover ao capítulo anterior",
  moveDown: "Mover ao próximo capítulo",
  play: "Reproduzir parágrafo",
  moveHead: "Mover ao capítulo",
  moveTo: (title: string) => `Mover para “${title}”`,
  moveWith: (count: number) => (count > 1 ? `Move com os vizinhos desse lado, ${count} parágrafos no total` : "Move só este parágrafo"),

  noPrev: "Sem capítulo antes deste parágrafo",
  noNext: "Sem capítulo após este parágrafo",
  moveBlocked: "Mover deixaria capítulo vazio ou cruzaria o início do vizinho",
  moveLabel: "Mover parágrafo ao capítulo vizinho",
  moved: (title: string, count: number) => (count > 1 ? `Movidos ${count} parágrafos para “${title}”` : `Movido para “${title}”`),
  cutPara: "Cortar este parágrafo",
  cutParaHint: "Corta vídeo, áudio e legendas juntos; restaurável",

  chapterMenu: "Este capítulo…",
  renameChapter: "Renomear…",
  cutChapter: "Cortar este capítulo",
  cutChapterHint: "Corta vídeo, áudio e legendas juntos; capítulos seguintes avançam",
  cutChapterLabel: "Cortar capítulo",
  cutChapterRefused: {
    empty: "Este capítulo não tem duração",
    whole: "Este capítulo é o vídeo inteiro; cortar não deixaria nada",
    'no-tracks': "Nenhuma faixa usa mídias transcritas; nada para cortar",
  } satisfies Record<'empty' | 'whole' | 'no-tracks', string>,
  cutChapterDone: (title: string, seconds: number) => `Cortar “${title}” · ${secondsLabel(seconds)}`,
  removeMarker: "Excluir marcador de capítulo",
  removeMarkerHint: "Exclui só o marcador; conteúdo mantido",
  find: "Encontrar",
  badRegex: "Padrão inválido",
  noResults: "Sem resultados",
  previous: "Anterior",
  next: "Próximos passos",
  closeFind: "Fechar busca",
  replaceWith: "Substitua por",
  matchCase: "Diferenciar maiúsculas",
  wholeWordShort: "Palavra",
  wholeWord: "Palavra inteira",
  regex: "Expressão regular · substituição inserida literalmente",
  replace: "Substituir",
  replaceAll: "Substituir tudo",
  regexError: (error: string) => `Erro na expressão regular: ${error}`,
};
