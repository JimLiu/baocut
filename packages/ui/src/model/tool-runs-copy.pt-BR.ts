import type { ToolRunsMessages } from './tool-runs-copy.ts';

import { pluralForm } from '@baocut/protocol';
const plural = (n: number, one: string, many: string) => pluralForm('pt-BR', n, { one, other: many });

export const ptBR: ToolRunsMessages = {
  diarizeStep: "Identificar falantes",

  phaseDone: "Concluído",
  phaseQueued: "Na fila",
  phaseCancelled: "Cancelado",
  phaseUnfinished: "Não terminou",
  phasePreparing: "Preparando",
  stepAt: (cur: number, total: number) => `Etapa ${cur} de ${total}`,
  cancelledAt: (step: string, at: string) => `Cancelado em “${step}” · ${at}`,
  stoppedAt: (step: string, at: string) => `Parado em “${step}” · ${at}`,
  runningAt: (step: string, at: string) => `${step} · ${at}`,
  stepDone: "Concluído",
  stepStopped: "Parou aqui",
  stepRunning: "Em andamento",
  stepWaiting: "Aguardando",

  costEstimate: (amount: number | string, currency: string) => `Cerca de ${amount} ${currency}`,
  costSubscription: (recipient: string) => `Incluído na sua ${recipient} assinatura`,
  costFree: "Grátis",
  costMetered: (recipient: string) => `Cobrado pelas tarifas de ${recipient}; sem estimativa aqui`,
  grantWhat: (kinds: readonly string[], purpose: string) => `${kinds.join(", ")} (${purpose})`,
  grantLoop: "Você já aprovou, mas Runtime recusa. Veja autorizações em Configurações › Privacidade e permissões ou use outro modelo.",

  noStructuredOutput: "Modelo sem saída estruturada; não pode traduzir",

  captionsCreated: (p: { language: string | null; bilingual: boolean; disabled: boolean }) =>
    `Criado ${p.language ? `uma ${p.language} camada de legendas` : "uma camada editável de legendas"}${p.bilingual ? ", exibida bilíngue" : ""}${
      p.disabled ? " (esta mídia já tem legendas; nova camada começa desativada)" : ""
    }`,
  captionsExistingTranslation: "Tradução já tem camada; nenhuma nova criada",
  captionsExistingTranscript: "Transcrição já tem camada; nenhuma nova criada",
  captionsNotOnTimeline: "Nenhum clipe usa a mídia; nenhuma camada criada",
  captionsEmpty: "Sem legendas para exibir; nenhuma camada criada",
  originalAudio: { duck: "Áudio original reduzido", mute: "Áudio original silenciado", keep: "Áudio original mantido" },

  thisVideo: "este vídeo",
  newVideo: "Criar vídeo",
  fallbackVideo: "Vídeo",
  media: "Mídia",
  savedFiles: (names: readonly string[]) => `Transcrição e legendas salvas: ${names.join(", ")}`,
  transcriptLanguage: (language: string, model: string | null) => `Idioma da transcrição: ${language}${model ? ` (${model})` : ""}`,
  createdVideoLinked: (video: string, project: string | null) =>
    `Vídeo criado “${video}”${project ? ` em “${project}”` : ""}; mídia fica no local, só vinculada`,
  wroteTranscript: (video: string) => `Transcrição adicionada a “${video}”`,
  speakersFound: (n: number) => `Encontrados ${n} ${plural(n, "falante", "falantes")}; legendas e transcrição nomeiam falantes`,
  wroteTranslation: (video: string, language: string, source: string | null) =>
    `Adicionada tradução ${language} a “${video}”${source ? ` (da transcrição ${source})` : ""}; original intacto`,
  unitCount: (n: number) => `${n} ${plural(n, "frase", "frases")}`,
  subtitleFileWritten: (file: string, dir: string) => `Arquivo traduzido ${file} salvo em ${dir}; blocos e tempos intactos`,
  bilingualLayout: "Bilíngue: original acima, tradução abaixo",
  markupStripped: (n: number) => `Marcação inline removida de ${n} originais ${plural(n, "bloco", "blocos")}`,
  dubTranslated: (language: string) => `Traduzido primeiro para ${language}: nova tradução adicionada`,
  dubReusedTranslation: (language: string) => `Usada a tradução existente ${language} tradução`,
  dubWritten: (video: string, language: string, engine: string) =>
    `Adicionada nova dublagem ${language} a “${video}”${engine ? ` (${engine})` : ""}; dublagens anteriores mantidas`,
  dubPlaced: (placed: number, total: number) => `${placed} de ${total} frases na linha do tempo`,
  linkCreatedVideo: (video: string, project: string | null) =>
    `Vídeo criado “${video}”${project ? ` em “${project}”` : ""}; mídia baixada na linha do tempo`,
  linkAddedTo: (file: string, video: string) => `Adicionado ${file} a “${video}”; arquivo fica em Downloads`,
  linkDownloaded: (file: string, dir: string | null) => `Baixados ${file}${dir ? ` a ${dir}` : ""}`,
  linkTranscribedFiles: "Transcrição concluída; TXT e SRT salvos",
  linkTranscribed: "Transcrição concluída; adicionada sem camada de legendas. Gere no editor em Legendas",
  replacedTranscript: (video: string) => `Transcrição de “${video}” substituída: uma única alteração, que você pode desfazer`,
  newVideoFrom: (video: string, project: string | null, original: string | null) =>
    `Vídeo “${video}” criado${project ? ` em “${project}”` : ''}, vinculado à mesma mídia; ${original ? `“${original}”` : 'o vídeo original'} e suas traduções não mudam`,
  carryTranslation: (language: string, kept: number, reviewed: number, stale: number) =>
    `Tradução em ${language} · mantidas: ${kept} (revisadas: ${reviewed}) · defasadas: ${stale}`,
  carryPins: (reanchored: number, orphaned: number) => `Pins de legenda · reancorados: ${reanchored} · orphaned: ${orphaned}`,
  carryDub: (language: string, kept: number, stale: number) => `Dublagem em ${language} · mantidas: ${kept} · defasadas: ${stale}`,
  nothingToCarry: 'Este vídeo não tinha traduções, pins de legenda nem dublagens para transferir',
  refreshHint: 'Retraduza as frases defasadas com “Atualizar traduções defasadas”',
};
