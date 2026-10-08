import { pluralForm } from '@baocut/protocol';
import type { SpeakersMessages } from './speakers-copy.ts';

const plural = (n: number, one: string, many: string) => `${n} ${pluralForm('pt-BR', n, { one, other: many })}`;

export const ptBR: SpeakersMessages = {
  title: "Identificar falantes",
  back: "Voltar",
  background: "Executando em segundo plano",

  cardTitle: "Identificar quem fala",
  cardBody: "Reidentifica por impressão vocal e nomeia legendas e transcrição. Você revisa primeiro; nada muda até aplicar.",
  who: "Usar",
  local: "Modelo local de impressão vocal",
  localSub: "Permanece neste computador",
  agent: "Passar para o agente",
  agentSub: "Executa na sessão deste vídeo",
  scope: "Escopo",
  scopeAll: "Vídeo inteiro",
  scopeLocal: (scope: string) => `Identificação local cobre o vídeo inteiro; para só “${scope}”, entregue ao agente.`,
  packHint: (size: string | null) =>
    `O modelo local de impressão vocal${size ? ` (cerca de ${size})` : ""} é baixado na primeira execução e depois funciona off-line.`,
  packDownloading: (pct: number | null) =>
    `Baixando modelo local de impressão vocal${pct === null ? "…" : ` · ${pct}%`}; identificação começa ao concluir.`,
  packUnlisted: "Sem modelo local neste computador; só o agente pode fazer.",
  noSpeech: "Vídeo ainda não transcrito. Transcreva em Legendas, depois identifique os falantes.",
  manySpeech: "Várias transcrições; usa a primeira",
  start: "Início",
  startHint: "Ao concluir, abre revisão; só esta ferramenta exige confirmação antes de aplicar.",
  agentHint: "Envia à sessão do vídeo e inicia o agente imediatamente.",
  readOnly: "Vídeo em leitura apenas; identificação indisponível.",
  web: "Não é possível identificar falantes no navegador",
  webBody: "Identificação usa o modelo local deste computador. Use o aplicativo desktop BaoCut.",

  submitting: "Enviando…",
  queued: "Na fila…",
  running: "Identificando falantes…",
  activity: (stage: string) => `Modelo local de impressão vocal · ${stage}`,
  runNote: "Pode continuar editando · identificação em segundo plano e revisão ao concluir; não muda a transcrição diretamente.",
  cancel: "Cancelar",
  cancelled: "Identificação cancelada",
  cancelFailed: (message: string) => `Não foi possível cancelar: ${message}`,

  found: (n: number) =>
    `Encontrados ${plural(n, "falante", "falantes")}. Ouça amostras para confirmar identidades, clique no nome para renomear e aplique.`,
  same: "Limites dos falantes iguais aos atuais; só nomes mudam.",
  newSpeaker: "Novo",
  rename: "Renomear",
  renameLabel: (name: string) => `Renomear “${name}”`,
  sentences: (n: number) => plural(n, "frase", "frases"),
  clipOff: "Esta frase foi cortada e não está na linha do tempo",
  splitTitle: (n: number) => `${plural(n, "tradução", "traduções")} serão redivididas; sem retradução`,
  splitBody: "Mudanças no limite entre falantes afetam apenas o corte das linhas de legenda — o texto traduzido permanece igual.",
  skipped: (n: number) =>
    `${plural(n, "tradução", "traduções")} em formato antigo não serão redivididas; frases deixarão de alinhar e serão marcadas desatualizadas.`,
  apply: "Aplicativo",
  applyHint: "Depois de aplicar, é possível desfazer com um clique.",
  discard: "Descartar este resultado",

  engine: "Modelo local de impressão vocal",
  undoneReceipt: "Desfeito · rótulos dos falantes restaurados",
  undo: "Desfazer",
  redo: "Refazer",
  again: "Executar de novo",
  done: "Concluído",
  splitDone: (n: number) => `${plural(n, "tradução foi", "traduções foram")} redivididas nos novos limites, sem retradução.`,
  undoneTitle: "Desfeito",
  undoneBody: "“Executar novamente” recomeça mantendo as configurações.",
  captionsStale: (n: number) =>
    pluralForm('pt-BR', n, { one: `${n} faixa de legendas veio de transcrição antiga e não foi atualizada.`, other: `${n} faixas de legendas vieram de transcrição antiga e não foram atualizadas.` }),
  gotoCaptions: "Abrir Legendas",
  noUndo: "Nada para desfazer; resultado corresponde aos rótulos atuais.",
  undoFailed: "Não foi possível desfazer",
  redoFailed: "Não foi possível refazer",

  failed: "A identificação falhou",
  interrupted: "Identificação interrompida",
  submitFailed: "Não foi possível iniciar identificação",
  applyFailed: "Não foi possível aplicar o resultado",
  applyStale: "Transcrição ou traduções mudaram. Execute novamente e aplique.",
  badResult: "Resultado ilegível. Execute novamente.",
  retry: "Tentar novamente",
  decide: "Resolver em Tarefas em segundo plano",
  dismiss: "Entendi",
  chapterScope: (n: number, label: string) => `Capítulo ${n} · ${label}`,
  manySpeechNamed: (name: string) => `Várias transcrições; usando a primeira, “${name}”`,
};
