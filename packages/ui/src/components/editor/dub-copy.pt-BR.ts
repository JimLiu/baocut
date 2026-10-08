import type { DubOriginalAudio } from '@baocut/protocol';
import type { DubMessages, DubRegenMessages, TimelineDubMessages } from './dub-copy.ts';

import { pluralForm } from '@baocut/protocol';
const sentences = (n: number) => `${n} ${pluralForm('pt-BR', n, { one: 'frase', other: 'frases' })}`;
const these = (n: number) => n === 1 ? 'esta frase' : `${n} frases`;

export const ptBRDub: DubMessages = {

  title: "Dublagem traduzida",
  back: "Voltar",
  web: "Dublagem traduzida exige o aplicativo desktop",
  webBody: "O navegador não oferece fluxos fixos (pipelines.*), então não inicia dublagem traduzida. Abra o vídeo no aplicativo desktop.",
  summary: (language: string, count: number | null, translate: boolean) =>
    `${translate ? `Traduz primeiro para ${language}, depois sintetiza` : `Usa a tradução existente em ${language} e sintetiza`} fala ${count === null ? "frase por frase" : `para ${sentences(count)} uma por vez`}, alinha cada frase ao tempo original e grava na linha do tempo como grupo de dublagem`,
  language: "Idioma da dublagem",
  languagePicker: "Idioma da dublagem",
  languageLine: (translate: boolean, count: number | null) =>
    `${translate ? "Sem tradução neste idioma · traduz primeiro" : "Usa tradução existente · não traduz novamente"}${count === null ? "" : ` · ${sentences(count)}`}`,
  allTaken: "Nenhum idioma disponível para dublagem.",
  staleNote: (n) => `${sentences(n)} nesta tradução ${pluralForm('pt-BR', n, { one: 'está desatualizada', other: 'estão desatualizadas' })} (original mudou ou foi marcado). ${pluralForm('pt-BR', n, { one: 'Não será sintetizada e aparecerá', other: 'Não serão sintetizadas e aparecerão' })} no resumo. Retraduza no painel Legendas para dublagem completa.`,
  source: "Original",
  sourcePicker: "Transcrição para dublar",
  sourceLine: (language: string, count: number | null) => (count === null ? language : `${language} · ${sentences(count)}`),
  voiceModel: "Modelo de voz",
  voiceModelPicker: "Modelo de fala para síntese",
  voiceModelsLoading: "Carregando modelos de fala…",
  manageVoiceModels: "Gerenciar modelos de voz…",
  ttsMissingTitle: "Nenhum modelo de fala disponível",
  goTts: "Abrir Modelos › Síntese de fala",
  voice: "Voz padrão",
  voicePicker: "Usada por falantes sem voz própria",
  voiceDefault: "Padrão do modelo",
  voiceCustom: "ID da voz",
  voiceCustomPlaceholder: "ID de voz da sua conta no provedor",
  voiceHint: "Falantes com voz atribuída abaixo usam essa voz; os demais usam a escolhida aqui.",
  voiceCustomEmpty: "Informe ID de voz ou escolha outra voz",
  speakers: "Falante",
  speakersAside: (n: number) => `${n}`,
  speakersNone: "Sem informações de falantes; todas as frases usam a voz padrão acima.",
  speakersNote: "Vozes atribuídas são salvas no vídeo (edição desfazível) e reutilizadas. Prioridade: atribuída → voz padrão → padrão do modelo.",
  speakerLine: (count: number) => sentences(count),
  speakerBinding: (name: string) => `Voz atribuída a ${name}`,
  bindingNone: "Nenhum",
  bindingOther: (label: string) => `${label} (atribuída em outro lugar)`,
  bindingIgnored: (provider: string) => `A voz atribuída é de outro provedor e não é usada com ${provider}`,
  bindingReadOnly: "Vídeo em leitura apenas; vozes dos falantes não podem mudar.",
  bindingFailed: (message: string) => `Não foi possível mudar a voz do falante: ${message}`,
  bindingLoading: "Carregando vozes dos falantes…",
  bindingReadFailed: (message: string) => `Não foi possível ler as vozes atribuídas no vídeo: ${message}`,
  bindingSaved: (name: string) => `Voz atribuída a ${name}`,
  bindingCleared: (name: string) => `Removida ${name}: atribuição de voz`,
  sourceVideo: "Atribuída",
  sourceParams: "Voz padrão",
  sourceDefault: "Padrão do modelo",

  effective: (label: string, source: string | null) => (source ? `Usando: ${label} (${source})` : `Usando: ${label}`),
  speakerWarning: (reason: string) => `As frases deste falante não serão sintetizadas: ${reason}`,
  manageVoices: "Gerenciar Minhas vozes…",
  mix: "Mixagem",
  separate: "Separar áudio de fundo",
  separateHint: "A dublagem substitui só a fala; música e ambiente permanecem",
  separateMissing: "Sem modelo de separação neste computador; mesmo ativada, separação ignorada e áudio original tratado inteiro.",
  installSeparate: "Instalar modelo de separação…",
  separateDownload: (name: string) => `É preciso baixar ${name}`,
  separateDownloadBody: 'O botão abaixo baixa primeiro e começa a dublagem assim que estiver instalado. O download não usa a fila de tarefas.',
  separateWaiting: (name: string, pct: number | null) => `Baixando ${name}${pct === null ? '' : ` · ${pct}%`} · a dublagem começa após instalar`,
  ctaDownload: (language: string) => `Baixar modelo e dublar em ${language}`,
  separateDownloadStopped: 'O modelo de separação não terminou de baixar, então a dublagem não começou.',
  original: "Áudio original",
  originalPicker: "Tratamento do áudio original durante a dublagem",
  originalLabel: { duck: "Abaixar em", mute: "Silenciar", keep: "Manter" } satisfies Record<DubOriginalAudio, string>,

  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) =>
    o.original === 'keep'
      ? `O áudio original permanece e toca sob a dublagem${o.separated ? "; nada é separado quando mantido" : ""}.`
      : `${o.separated ? "O fundo vai a uma faixa própria; o original fica só com a fala, que é" : "Sem separação, o áudio original inteiro é"} ${o.original === 'mute' ? "sem som" : `reduzido em −${o.duckDb} dB`}. Você pode voltar ao áudio original pelo cabeçalho da faixa a qualquer momento.`,
  duckDb: "Quanto reduzir (dB)",
  duckLabel: "Abaixar em",
  duckUnit: "dB",
  translate: "Traduzir",
  textModel: "Modelo de texto",
  textModelPicker: "Modelo de texto para tradução",
  textModelsLoading: "Carregando modelos de texto…",
  manageTextModels: "Gerenciar modelos de texto…",
  textMissingTitle: "Nenhum modelo de texto disponível",
  goLlm: "Abrir Modelos › Geração de texto",
  noStructured: "Sem saída estruturada · não pode traduzir",
  style: "Dica de estilo",
  stylePlaceholder: "Ex.: coloquial, conciso; manter nomes no original",
  styleHint: "Opcional; até 500 caracteres.",
  cta: (language: string) => `Dublar em ${language}`,

  ctaHint: (language, stems) => {
 const tracks = [`“Dublagem · ${language}”`];
 if (stems.separated && stems.original !== 'keep') tracks.push('“Fundo”');
 if (stems.separated && stems.original === 'duck') tracks.push('“Voz”');
 const list = new Intl.ListFormat('pt-BR', { type: 'conjunction' }).format(tracks);
 return `Ao terminar, grava ${pluralForm('pt-BR', tracks.length, { one: 'na faixa', other: 'nas faixas' })} ${list} da linha do tempo; desfaça com um clique. Modelos on-line cobram por chamada.`;
},
  noSpeechTitle: "Ainda não há transcrição para dublar",
  noSpeech: "A dublagem segue as frases da transcrição. Primeiro transcreva com “Gerar legendas” no painel Legendas.",
  busy: "Já existe dublagem em andamento neste vídeo; espere terminar antes de outra.",
  readOnly: "Vídeo em leitura apenas; não pode receber dublagem.",

  submitting: "Enviando dublagem",
  queued: "Na fila",
  running: (language: string) => `Dublando · ${language}`,
  stepUnits: (step, done, total) => `${step === 'translate' ? 'Traduzidas' : 'Sintetizadas'} ${done}${total ? ` / ${total}` : ''} ${pluralForm('pt-BR', total ?? done, { one: 'frase', other: 'frases' })}`,
  sentences: (running: number, failed: number) =>
    [running ? `${sentences(running)} em síntese` : "", failed ? `${sentences(failed)} falhou` : ""].filter(Boolean).join(" · "),
  cancel: "Cancelar dublagem",
  cancelled: "Dublagem cancelada",
  cancelFailed: (message: string) => `Não foi possível cancelar a dublagem: ${message}`,
  liveNote: "O Runtime grava direto na linha do tempo ao terminar, desfazível a qualquer momento. Você pode sair desta página.",
  foreign: "Esta dublagem não começou aqui. Confira a linha do tempo ao terminar; use Desfazer no editor.",

  grantTitle: (recipient: string) => `Sem permissão para enviar a transcrição a ${recipient}`,
  grantBody:
    "A dublagem envia a tradução para síntese e o original sem tradução ao provedor. Autorize apenas este vídeo para continuar; nada é enviado sem permissão.",
  grantAction: "Autorizar e iniciar",
  grantRetryAction: "Autorizar e tentar novamente",
  grantDialogTitle: "Autorizar compartilhamento de dados",
  grantDialogIntro: "Após confirmar, o BaoCut registra a autorização e continua a dublagem:",
  grantConfirm: "Autorizar e continuar",
  grantCancel: "Agora não",
  granting: "Autorizando…",
  grantFailed: (message: string) => `Não foi possível autorizar: ${message}`,
  grantStillRefused: "Ainda negado após autorização",
  grantNext: "Se tradução e síntese usam provedores diferentes, cada um precisa de autorização.",
  commands: "Linha de comando",

  notConfigured: "Dublagem ainda indisponível",
  submitFailed: "Não foi possível iniciar a dublagem",
  failed: "A dublagem falhou",
  interrupted: "A dublagem foi interrompida",
  retry: "Tentar novamente",
  retryFailed: (message: string) => `Não foi possível tentar novamente: ${message}`,
  retryCharges:
    "Retoma a etapa em que parou. Se foi “Traduzir”, executa a etapa inteira; lotes já traduzidos chamam o modelo e podem cobrar novamente.",
  retryPartial: "Retoma “Sintetizar frases”: frases sintetizadas reutilizadas, só falhas e restantes são sintetizadas.",
  retryFree: "Retoma a etapa em que parou; etapas concluídas reutilizadas sem nova chamada.",
  retryFrozen:
    "Vozes atribuídas foram fixadas no início: corrigir a voz (novo clone, declaração do dono) ajuda a repetir; mudar atribuição exige nova dublagem.",
  failedUnits: (n: number) => `${sentences(n)} falharam na síntese`,
  stoppedAt: (synthesized: number, remaining: number) => `Parou após sintetizar ${sentences(synthesized)}; ${remaining} restantes`,
  dismiss: "Entendi",

  doneTitle: (language: string) => `Dublado em ${language}`,
  doneToast: (language: string, placed: number) => `Dublado em ${language} · ${sentences(placed)} colocadas na linha do tempo`,
  placed: (placed: number, total: number) => `${placed} / ${total} frases na linha do tempo`,
  fitHead: "Destino de cada frase",
  speakersHead: "Vozes dos falantes",
  speakerUnits: (n: number) => sentences(n),
  speakerNone: "Sem falante",
  voiceFailedHead: "As frases destes falantes não foram sintetizadas",
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · ${sentences(n)} · ${reason}`,
  voiceFailedFix:
    "Dublagem concluída, não pode repetir: desfaça o grupo → corrija a voz (clone novamente ou declaração do dono) ou a atribuição → duble novamente.",
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) =>
    [
      `${calls} chamada${pluralForm('pt-BR', calls, { one: "", other: "s" })}`,
      retries ? `${retries} reenviadas` : "",
      failures ? `${failures} falhou` : "",
      reused ? `${sentences(reused)} reutilizadas` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  translationCreated: "A nova tradução fica salva no vídeo (desfazer dublagem não a exclui)",
  translationUsed: "Tradução existente usada",
  glossaryUsed: (n: number) => `Usados ${n} ${pluralForm('pt-BR', n, { one: "glossário", other: "glossários" })}`,
  warnings: "Avisos",
  undo: "Desfazer esta dublagem",
  undoing: "Desfazendo…",
  undone: "Dublagem desfeita",
  undonePartial:
    "Clipes, silêncios e reduções de volume desfeitos. Faixa vazia e plano ficam no vídeo (o protocolo não exclui faixas ou documentos).",
  undoLabel: (language: string) => `Desfazer dublagem (${language})`,
  undoFailed: "Não foi possível desfazer esta dublagem",
  undoNotOpen: "Abra o vídeo primeiro para desfazer.",
  close: "Fechar",
  again: "Dublar novamente",
  providerFallback: "este provedor",
  unknownLanguage: "Idioma desconhecido",
};

export const ptBRTimelineDub: TimelineDubMessages = {
  trackLabel: (language: string) => `Dublagem · ${language}`,

  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? "Voz" : "Fundo"} · ${language}`,

  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? " · rápida demais" : ""}`,

  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)} s`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) =>
    [
      parts.text,
      parts.speaker,
      parts.rate,
      parts.muted ? "Sem som" : "",
      parts.manual ? "Velocidade alterada manualmente" : "",
      parts.editable ? "Arraste a borda direita para mudar duração · clique direito para mais" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  menuLabel: (title: string) => `Menu de dublagem de “${title}”`,
  selection: (n: number) => `${sentences(n)} selecionadas`,
  count: (n: number) => (n > 1 ? `Estas ${n} frases` : "Esta frase"),
  listen: "Reproduzir esta frase",
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ""}`,
  mute: (allMuted: boolean, n: number) => `${allMuted ? "Reativar som" : "Silenciar"} ${these(n)}`,
  muteHint: (allMuted: boolean): string => (allMuted ? "Restaurar a dublagem destas frases" : "Estas frases ficam sem som · também nas exportações"),
  remove: (n: number) => `Excluir ${these(n)}`,
  removeHint: "Remove da faixa de dublagem · desfazível",
  removeGroup: "Remover este grupo de dublagem",
  removeGroupHint: (bed: boolean) =>
    `${bed ? "Remove também o áudio de fundo" : "Remove toda a dublagem deste idioma"} · áudio original silenciado volta`,
  labelMute: "Silenciar dublagem",
  labelUnmute: "Ativar som da dublagem",
  labelRemove: "Excluir dublagem",
  labelRemoveGroup: (language: string) => `Remover dublagem (${language})`,
  labelStretch: "Mudar velocidade da dublagem",
  muted: (n: number) => `Silenciadas ${sentences(n)} de dublagem`,
  unmuted: (n: number) => `Som ativado em ${sentences(n)} de dublagem`,
  removed: (n: number) => `Excluídas ${sentences(n)} de dublagem`,
  groupRemoved: (language: string) =>
    `Removido “Dublagem · ${language}” · faixa vazia e plano ficam no vídeo`,
  planUnread: "Não foi possível ler o plano; áudio original não foi restaurado. Ative o som nos clipes originais.",
};

export const ptBRDubRegen: DubRegenMessages = {

  headMenu: (label: string) => `“${label}”: faixa`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) =>
    [
      sentences(c.total),
      c.failed ? `${c.failed} não sintetizadas` : "",
      c.fast ? `${c.fast} rápidas demais` : "",
      c.muted ? `${c.muted} silenciadas` : "",
      c.queued ? `${c.queued} regenerando` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  listenDub: "Ouvir a dublagem",
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) =>
    `Dublagem deste grupo${o.bed ? " + fundo" : ""} · ${o.duck ? "original reduzido" : "original silenciado"}${o.others ? " · outros idiomas desativados" : ""}`,
  listenDubKeep: "Este grupo manteve o original sem registrar quais partes; use “Ouvir ambos”",
  listenOriginal: "Ouvir o áudio original",
  listenOriginalHint: (others: boolean) => `Restaura o áudio original · ${others ? "todos os grupos de dublagem" : "este grupo de dublagem"} silenciadas`,
  listenBoth: "Ouvir os dois",
  listenBothHint: (bed: boolean) => `Para comparar${bed ? " · fundo deste grupo desativado" : ""}`,
  sourceLabel: { dub: "Ouvir a dublagem", original: "Ouvir o áudio original", both: "Ouvir os dois" },
  sourceDone: {
    dub: (language: string) => `Ouvindo “Dublagem · ${language}”`,
    original: "Ouvindo original · dublagem silenciada",
    both: "Reproduzindo original e dublagem juntos",
  },
  regenSome: (n: number) => (n ? `Regenerar ${sentences(n)}…` : "Regenerar…"),
  regenSomeHint: (failed: number, fast: number) =>
    failed || fast
      ? `${[failed ? `${failed} não sintetizadas` : "", fast ? `${fast} rápidas demais` : ""].filter(Boolean).join(" · ")} · você pode editar a tradução primeiro`
      : "Sem frases falhas ou rápidas demais",
  redub: "Dublar novamente…",
  redubHint: "Abre Dublagem traduzida: mude idioma ou voz e refaça o grupo inteiro",
  readOnly: "Vídeo em leitura apenas",

  regenBlocks: (n: number) => `Regenerar ${these(n)}`,
  regenBlocksHint: "Sintetiza novamente com a mesma tradução e voz · nova seed · tomada anterior mantida",
  retext: "Editar tradução e dublar novamente…",
  retextHint: "Verifique durações e edite a tradução, depois refaça só estas frases",
  inQueue: "Algumas frases estão regenerando",

  queued: "Regenerando…",
  queuedTip: (text: string) => `${text} · regenerando`,
  version: (k: number, seed: number | null) => (seed === null ? `Tomada ${k}` : `Tomada ${k} · seed ${seed}`),

  submitted: (n: number) => `Regeneração iniciada para ${sentences(n)} de dublagem`,
  submitFailed: (message: string) => `Não foi possível iniciar regeneração: ${message}`,
  grantRefused: (recipient: string) =>
    `Regenerar envia a tradução a ${recipient}, ainda sem autorização. Autorize nas Configurações ou recomece em Dublagem traduzida`,
  busy: "Grupo sendo enviado; um momento",
  done: (replaced: number, total: number) =>
    replaced === total ? `Regeneradas ${sentences(replaced)} de dublagem` : `Regeneradas ${replaced}/${total} frases de dublagem`,
  doneNone: "Nenhuma frase recebeu nova tomada",
  notPlaced: (status: string, n: number) =>
    status === 'overlong'
      ? `${sentences(n)} não couberam; tomada anterior mantida`
      : status === 'stale'
        ? `${sentences(n)} tinham tradução desatualizada e não foram sintetizadas`
        : status === 'voice-unavailable'
          ? `${sentences(n)} tinham voz indisponível e não foram sintetizadas`
          : `${sentences(n)} não estão na linha do tempo`,
  failed: (message: string) => `Regeneração incompleta: ${message}`,
  cancelled: "Regeneração cancelada",
  undo: "Desfazer",
  undoMissing: "Não foi possível encontrar a edição da regeneração; use Desfazer no editor",
  labelRetext: "Editar tradução (dublar novamente)",

  fitTitle: (n: number) => `Editar tradução e dublar novamente ${sentences(n)}`,
  fitIntro:
    "Você edita a frase traduzida falada (marcada revisada); legendas não são redivididas. Cada frase ganha nova seed e mantém a tomada anterior.",
  fitDub: (seconds: number, rate: string) => `Dublagem ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ""}`,
  fitVoice: "Não sintetizada: voz indisponível",
  fitOverlong: (seconds: number | null) => (seconds === null ? "Não colocada: longa demais" : `Não colocada: ${seconds.toFixed(1)} s longa demais`),
  fitLoading: "Carregando tradução…",
  fitUnreadable: (message: string) => `Não foi possível ler a tradução desta dublagem (${message}); usando só a tradução original para redublar`,
  fitMissing: "Esta frase não está na tradução; usa o roteiro do plano para redublar",
  fitText: (index: number) => `Tradução da frase ${index}`,
  fitCancel: "Cancelar",
  fitSubmit: (n: number, changed: number) => (changed ? `Editar ${changed} e dublar novamente ${sentences(n)}` : `Dublar novamente ${sentences(n)}`),
  fitBusy: "Enviando…",

  takesTitle: "Tomadas",
  takesAside: (n: number) => `${n} tomada${pluralForm('pt-BR', n, { one: "", other: "s" })}`,
  takeCurrent: "Agora",
  takeUse: "Usar esta tomada",
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) =>
    [
      seed !== null ? `seed ${seed}` : "",
      seconds !== null ? `${seconds.toFixed(1)} s` : "não colocada",
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  takeUnavailable: "Tomada fora da linha do tempo ou mídia não encontrada",
  takesNote: "Cada regeneração registra uma tomada; voltar a uma antiga é desfazível e não sintetiza novamente.",
  takeName: (k: number) => `Tomada ${k}`,
  labelSwitchTake: (k: number) => `Trocar para tomada de dublagem ${k}`,
  switched: (k: number) => `Trocado para tomada ${k}`,
  regenThis: "Regenerar esta frase",
  unreadableFormat: "Formato não reconhecido",
  unreadableNoTranslation: "O plano não tem tradução",
};
