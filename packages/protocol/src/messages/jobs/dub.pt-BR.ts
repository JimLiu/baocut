import type { JobsDubMessages } from './dub.ts';

export const ptBR: JobsDubMessages = {
  label: "Dublagem traduzida",
  description:
    "Dubla a transcrição de um vídeo em outro idioma: traduz primeiro se necessário, sintetiza frase por frase, alinha ao tempo das frases originais e aplica como um grupo de dublagem (uma faixa). Nenhum agente é iniciado.",
  stepFreezeSource: "Ler origem",
  stepTranslate: "Traduzir",
  stepAssemble: "Montar tradução",
  stepWrite: "Gravar tradução",
  stepCheck: "Verificar tradução",
  stepSeparate: "Separar voz e fundo",
  stepSynthesize: "Sintetizar frases",
  stepAlign: "Alinhar tempos",
  stepApply: "Aplicar dublagem",

  regroupConflict: (p: { params: string }) =>
    `A nova síntese de frases (regroup) usa tradução, idioma, voz e tratamento do áudio original do plano do grupo; não pode ser combinada com ${p.params}`,
  orTranslationId: "ou translationId deve ser informado",
  translationIdNoTranslate: "Com translationId não há tradução; style, glossary, glossaries, textProvider e textModel não se aplicam",
  mustBeBooleanValue: "deve ser um booleano",
  mustBeObject: "deve ser um objeto",
  unitsCount: (p: { max: number }) => `deve ter de 1 a ${p.max} IDs de unidades de tradução`,
  mustBeUnique: "não pode conter duplicatas",
  seedInvalid: (p: { max: number }) => `deve ser “new” ou um inteiro de 0 a ${p.max}`,

  videoNotOpen: "O vídeo não está aberto",
  translationFromOther: (p: { translationId: string; from: string; expected: string }) =>
    `A tradução ${p.translationId} foi traduzida de ${p.from}, não de ${p.expected}`,
  translationLanguage: (p: { translationId: string; language: string; expected: string }) =>
    `A tradução ${p.translationId} está em ${p.language}, não de ${p.expected}`,
  noDocument: (p: { documentId: string }) => `O vídeo não tem o documento ${p.documentId}`,
  notTranslation: (p: { documentId: string; kind: string }) => `O documento ${p.documentId} é ${p.kind}, não uma tradução`,
  translationNotUsable: (p: { translationId: string; schema: string }) =>
    `A tradução ${p.translationId} não está em ${p.schema}, então não pode ser usada para dublagem`,
  noPlan: (p: { groupId: string }) => `O vídeo não tem plano para este grupo de dublagem (${p.groupId})`,
  groupGone: (p: { groupId: string }) => `Este grupo de dublagem (${p.groupId}) não tem mais itens na linha do tempo`,
  planNoTranslation: "O plano de dublagem não registra uma tradução",
  unitsNotInPlan: (p: { count: number; units: string }) =>
    `${p.count} frases não estão no plano ou na tradução deste grupo: ${p.units}`,
  planNoVoice: "O plano não registra provedor, modelo e voz usados na síntese",
  seedNotAccepted: (p: { model: string }) => `Modelo ${p.model} não aceita seed`,

  videoClosed: "O vídeo foi fechado",
  translationGone: "O documento de tradução não está mais no vídeo",
  translationNotSchema: (p: { schema: string }) => `A tradução não está em ${p.schema}`,
  translationNotFromTranscript: "A tradução não foi feita desta transcrição",
  unitMissingIds: "A tradução tem unidades sem id ou sourceSentenceId",
  separationNotConfigured:
    "A separação de voz e fundo foi solicitada, mas separateAudio não está configurada. Esta etapa é ignorada e o áudio original é tratado como está",
  unitsStale: (p: { count: number }) =>
    `${p.count} frases traduzidas estão desatualizadas (origem ou glossário mudou, ou foram marcadas) e não foram sintetizadas`,
  nothingToDub: "A tradução não tem frases para dublar: todas estão desatualizadas ou vazias",

  separationUnavailable: "A separação de voz e fundo não está mais disponível",
  noSourceAsset: "A transcrição não tem mídia de origem e não pode ser separada",
  sourceAssetMissing: "A mídia de origem da transcrição não está disponível",
  separationInvalid: "O resultado da separação não atende ao contrato",
  inputNoAudio: "A entrada não tem áudio",
  stemNoAudio: (p: { name: string }) => `${p.name} não tem áudio`,
  stemSampleRate: (p: { name: string; rate: number; input: number }) =>
    `A taxa de amostragem de ${p.name} (${p.rate}) difere da entrada (${p.input})`,
  stemDuration: (p: { name: string; duration: number; input: number }) =>
    `${p.name} é ${p.duration} segundos; a entrada tem ${p.input} segundos`,

  sentenceJob: (p: { n: number }) => `Frase ${p.n}`,
  audioUndecodable: "O áudio sintetizado não pode ser decodificado",
  outputNoAudio: "O resultado sintetizado não tem áudio",
  synthesisStopped: (p: { cause: string; synthesized: number; remaining: number }) =>
    `${p.cause}. ${p.synthesized} frases foram sintetizadas e restam ${p.remaining}; tentar novamente sintetiza apenas as restantes`,
  synthesisFailed: (p: { failed: number; synthesized: number }) =>
    `${p.failed} frases falharam na síntese. As ${p.synthesized} que deram certo são mantidas; tentar novamente sintetiza apenas as que falharam`,
  voicesUnavailableAll: (p: { speakers: string }) =>
    `As vozes atribuídas aos falantes (${p.speakers}) não estão disponíveis; nenhuma frase pôde ser sintetizada. Corrija as vozes (clone novamente ou adicione a declaração de consentimento) e tente novamente`,
  voicesUnavailable: (p: { count: number; speakers: string }) =>
    `${p.count} frases não foram sintetizadas porque as vozes dos falantes (${p.speakers}) não estão disponíveis; nenhuma outra voz foi usada`,

  mutedUnvoiced: (p: { count: number }) =>
    `${p.count} itens silenciados também contêm frases não sintetizadas por voz indisponível; o áudio original dessas frases também foi silenciado`,
  unitsOverlong: (p: { count: number; tempo: number }) =>
    `${p.count} frases ainda não cabem após acelerar para ${p.tempo}× e usar o silêncio seguinte; não foram colocadas na linha do tempo (o roteiro precisa ser reescrito)`,
  unitsOffTimeline: (p: { count: number }) =>
    `As frases originais de ${p.count} frases traduzidas não estão mais na linha do tempo; não foram colocadas`,
  nothingPlaced: "Nenhuma frase dublada cabe na linha do tempo",
  artifactGone: (p: { artifactId: string }) => `Resultado ${p.artifactId} não existe mais`,
  stretchNoAudio: "Não há áudio após mudar a velocidade",

  videoClosedKept: "O vídeo foi fechado; o áudio sintetizado está nos resultados",
  videoChanged:
    "O vídeo mudou após o alinhamento; nada foi aplicado. Tentar novamente alinha à linha do tempo atual (reutiliza o áudio sintetizado)",
  sequenceGone: "A sequência não existe mais",
  backgroundMuted:
    "O áudio original foi silenciado. Se misturava voz, música e ambiente, o fundo também desaparece (não foi separado)",
  noTrackOrPlanId: "O ID da faixa ou do plano de dublagem não foi recebido após aplicar",
  applyRejected: "A transação de dublagem foi rejeitada; o áudio sintetizado está nos resultados",
  planGone: "O plano deste grupo não está mais no vídeo",
  regroupRejected: "A transação de regeneração foi rejeitada; o áudio sintetizado está nos resultados",
  planNotSchema: (p: { schema: string }) => `O plano de dublagem não é ${p.schema}`,

  transactionLabel: (p: { language: string }) => `Dublagem (${p.language})`,
  regroupLabel: (p: { language: string }) => `Regenerar dublagem (${p.language})`,
  trackName: (p: { language: string }) => `Dublagem (${p.language})`,
  assetName: (p: { language: string; n: number }) => `Dublagem (${p.language}) frase ${p.n}`,
  takeAssetName: (p: { language: string; n: number; k: number }) => `Dublagem (${p.language}) frase ${p.n} · tomada ${p.k}`,
  itemName: (p: { n: number }) => `Dublagem ${p.n}`,
  backgroundName: (p: { language: string }) => `Fundo (${p.language})`,
  vocalsName: (p: { language: string }) => `Voz (${p.language})`,
  planName: (p: { language: string }) => `Plano de dublagem (${p.language})`,
  duckingName: (p: { language: string }) => `Dublagem (${p.language}) reduz o áudio original`,
};
