import type { JobRecord } from '@baocut/protocol';
import type { ExternalToolStatus } from '@baocut/protocol';
import type { LinkImportMessages } from './link-import-copy.ts';

import type { LinkIssueText } from './link-import-copy.ts';
const endSentence = (text: string): string => /[.!?。！？]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
const joinSentences = (parts: readonly (string | null | undefined)[]): string => parts.filter((p): p is string => !!p?.trim()).map(endSentence).join(' ');

export const ptBR: LinkImportMessages = {
  title: (name: string | null) => (name ? `Importar link · ${name}` : "Importar de link"),

  phase: {
    starting: "Preparando",
    probing: "Lendo link",
    downloading: "Baixar vídeos",
    validating: "Verificando reprodução",
    publishing: "Movendo a Downloads",
    applying: "Importando vídeo",
    transcribing: "Iniciando transcrição",
  } as Partial<Record<JobRecord['phase'], string>>,
  phaseFallback: "Trabalhando",
  downloaded: (bytes: string) => `${bytes} baixados`,

  stageDownload: "Baixar vídeos",
  stageVideo: "Verificar mídia e criar vídeo",
  stageSubs: "Gerar legendas",

  issue: {
    TOOL_NOT_INSTALLED: {
      title: "Configurar uma vez e colar",
      body: "BaoCut exige yt-dlp para este site. Instale e repita a importação.",
    },
    TOOL_CONSENT_REQUIRED: {
      title: "Consentimento necessário para a ferramenta",
      body: "Ferramenta já instalada. BaoCut só usa para baixar após consentimento.",
    },
    TOOL_UNAVAILABLE: {
      title: "Ferramenta não executável",
      body: "Ferramenta encontrada, mas não executa. Reinstale ou escolha outra cópia.",
    },
    TOOL_OUTDATED: {
      title: "Ferramenta precisa atualizar",
      body: "Versão antiga demais, pode não ler este site. Atualize e tente.",
    },
    OFFLINE_STRICT: {
      title: "Links indisponíveis no off-line estrito",
      body: "BaoCut não usa rede neste modo. Baixe no navegador, depois escolha arquivo local.",
    },
    LINK_UNSUPPORTED: {
      title: "Origem ainda não aceita",
      body: "Site ou página desconhecidos. Use página do vídeo, não playlist, ao vivo ou busca; ou arquivo local.",
    },
    LINK_LOGIN_REQUIRED: {
      title: "Este vídeo exige login",
      body: "Entre no site pelo navegador, volte a Baixar vídeo, marque em “Login no site” e repita.",
    },
    LINK_COOKIES_UNAVAILABLE: {
      title: "Cookies ilegíveis",
      body: "Confira login. Banco bloqueado: feche navegador inteiro, segundo plano também. Verifique Chaves e Acesso total ao disco para Safari. No Windows, Chrome, Edge, Brave com criptografia vinculada ao aplicativo não são lidos; marque Firefox. Ou outro navegador.",
    },
    LINK_TOOL_UPDATE_REQUIRED: {
      title: "yt-dlp precisa atualizar",
      body: "Site mudou como serve vídeos. Atualize yt-dlp do mesmo modo, verifique e tente.",
    },
    LINK_UNAVAILABLE: {
      title: "Vídeo indisponível",
      body: "Pode ter sido removido, restrito por região ou sem formato baixável. Tente outro link ou arquivo local.",
    },
    LINK_NETWORK_ERROR: {
      title: "Conexão caiu",
      body: "Verifique rede e tente; downloads recebidos retomam.",
    },
    LINK_DISK_FULL: {
      title: "Espaço insuficiente",
      body: "Disco de Downloads cheio. Libere espaço e tente.",
    },
    LINK_DOWNLOAD_FAILED: {
      title: "A ferramenta relatou erro",
      body: "Site mudou ou limita downloads. Tente; se persistir, veja atualização da ferramenta ou arquivo local.",
    },
    LINK_DOWNLOAD_UNREADABLE: {
      title: "Arquivo baixado inutilizável",
      body: "Incompleto, sem áudio ou não decodificável; site pode ter servido conteúdo provisório. Baixe de novo ou tente outro link/arquivo.",
    },
    LINK_DESTINATION_UNAVAILABLE: {
      title: "Não pode gravar em Downloads",
      body: "Confira pasta e permissão; escolha outra e recomece.",
    },
    MEDIA_TOOL_UNAVAILABLE: {
      title: "Não pode verificar arquivo baixado",
      body: "Exige ffprobe, fornecido com ffmpeg, ausente. Instale ffmpeg e tente.",
    },
    LINK_SOURCE_EXPIRED: {
      title: "Link original perdido",
      body: "Após reiniciar, Runtime mantém só link mascarado. Cole novamente para importar.",
    },
    INTERRUPTED: {
      title: "Importação interrompida",
      body: "Runtime parou/reiniciou; repetir retoma a etapa.",
    },
  } as Readonly<Record<string, LinkIssueText>>,
  issueUnknownTitle: "Importação não terminou",
  issueUnknownBody: (message: string | null, remedy: string | null) => joinSentences([message, remedy]) || "Ocorreu um problema.",

  headingStopped: "Importação parada",
  headingFailed: "Importação não terminou",
  headingRunning: "Transformando link em vídeo editável",
  headingDownloaded: "Vídeo baixado",
  headingVideoFailed: "Arquivo baixado, vídeo não criado",
  headingCreatingVideo: "Arquivo baixado, criando vídeo",
  headingTranscribing: "Vídeo pronto, gerando legendas",
  headingTranscribeFailed: "Vídeo pronto, transcrição precisa de atenção",
  headingReady: "Vídeo pronto",
  headingSubsReady: "Legendas prontas",

  toolSource: {
    system: "Instalado no sistema",
    user: "Escolhido por você",
    managed: "Baixado pelo BaoCut",
    env: "Definido por variável de ambiente",
  } as Record<NonNullable<ExternalToolStatus['source']>, string>,
  factVersion: (version: string, size: string | null) => (size ? `Versão ${version} · cerca de ${size}` : `Versão ${version}`),
  factFrom: (host: string) => `Baixado de ${host}`,
  factLicense: (license: string) => `${license}: licença`,
  factIsolated: "Mantido na pasta do BaoCut, só executa após checksum; sistema inalterado",
  factInstalledWith: (method: string) => `Instalado com ${method}`,

  cardChecking: "Verificando ferramenta…",
  cardCheckingBody: "Só verifica versão local, sem rede.",
  cardUnknown: "Ferramenta não registrada",
  cardUnknownBody: "Este Runtime não conhece yt-dlp; importação por link indisponível.",
  cardInstalling: "Preparando ferramenta…",
  cardInstallingBody: "Baixar → verificar → testar. Mostra “Pronto” ao concluir.",
  cardUpdating: "Atualizando ferramenta…",
  cardUpdatingBody: "Saída sob o comando; versão reverificada ao concluir.",
  cardBlockedWhy: "BaoCut não pode baixar por você neste computador.",
  cardMissing: "Ferramenta não instalada",
  cardMissingBody: (why: string) => `${endSentence(why)} Instale yt-dlp e clique “Verificar novamente” ou escolha local.`,
  cardInstall: "Configurar uma vez e colar",
  cardInstallBody: "BaoCut precisa de yt-dlp. Após consentir, baixa e lembra, sem perguntar novamente.",
  cardInstallAction: "Concordar e instalar",
  cardOutdatedReason: (reason: string | null, version: string | null, minVersion: string | null) =>
    endSentence(reason ?? `Versão ${version ?? "desconhecida"} é inferior à exigida ${minVersion ?? ""}`),
  cardOutdated: "Ferramenta precisa atualizar",
  cardOutdatedBlocked: (reason: string, why: string) => `${reason} ${why}`,
  cardOutdatedRunnable: "Não baixado pelo BaoCut; atualize pelo método original com o comando abaixo.",
  cardOutdatedManual: "Não baixado pelo BaoCut. Atualize no Terminal conforme abaixo, depois “Verificar novamente”.",
  cardOutdatedUpdate: (reason: string) => `${reason} Atualize antes de iniciar.`,
  cardUpdateAction: "Concordar e atualizar",
  cardBroken: "Ferramenta não executável",
  cardBrokenBody: (reason: string | null, remedy: string | null) => joinSentences([reason, remedy]) || "Encontrado, mas não executa.",
  cardReinstallAction: "Concordar e reinstalar",
  cardConsentRevoked: "Você retirou consentimento à ferramenta",
  cardConsent: "Consentimento necessário para a ferramenta",
  cardConsentBody: "BaoCut só baixa após concordar. Consentimento no Runtime; links não perguntam de novo.",
  cardConsentAction: "Concordar e usar",
  cardReady: "Ferramenta pronta",
  cardReadyBody: "Ao iniciar, verifica link e informações antes de baixar.",
};
