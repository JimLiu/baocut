import { pluralForm } from '@baocut/protocol';
import { intlLocale } from '@baocut/protocol';
import type { AiToolsMessages } from './ai-tools.ts';

import type { AiToolId, AiToolGroup, CleanupKey, WriteLength, WriteStyle, WriteView, CoverText } from './ai-tools.ts';
type IntentArgs = { p: string; scope: string | null; edited: number | boolean; cut: number | boolean; count: number | null };
type ToolText = { name: string; desc: string; setup?: readonly string[]; why?: string };
const soonTail = 'O Runtime ainda não tem este fluxo nem sobreposição para ajustar o enquadramento; não há formulário aqui.';
const scopeOf = (o: IntentArgs) => o.scope ? `${o.scope} de ${o.p}` : o.p;

export const ptBR: AiToolsMessages = {
  groups: {
    frame: "Visual",
    transcript: "Transcrição",
    translate: "Traduzir",
    writing: "Escrever",
    publish: "Publicar",
  } as Record<AiToolGroup, string>,
  tools: {
    crop: {
      name: "Corte inteligente",
      desc: "Mudar proporção mantendo falantes, quadros e assuntos importantes",
      why: `Recorte inteligente segue falantes, quadros e assuntos importantes, depois recorta para nova proporção. ${soonTail}`,
    },
    shortscut: {
      name: "Cortar em vídeos curtos",
      desc: "Escolher segmentos e criar um curto vertical de cada",
      why: `Criar curtos exige escolher segmentos, recortar verticalmente e ajustar enquadramento por segmento. ${soonTail}`,
    },
    polish: {
      name: "Aprimorar transcrição",
      desc: "Corrige erros, insere pontuação e divide em parágrafos — suas palavras continuam suas",
      setup: [
        "Corrige erros óbvios, pontuação e divide parágrafos por assunto.",
        "Não reescreve nem remove suas palavras, só corrige erros claros.",
      ],
    },
    chapters: {
      name: "Gerar capítulos",
      desc: "Divide um vídeo longo em capítulos com título",
      setup: ["Agrupa parágrafos por assunto em capítulos titulados.", "Exportação e página compartilhada usam os mesmos capítulos."],
    },
    speakers: {
      name: "Identificar falantes",
      desc: "Distingue quem fala; os nomes aparecem nas legendas e na transcrição",
    },
    retranscribe: {
      name: "Retranscrever",
      desc: "Executar áudio com outro modelo, só capítulo ou trecho se quiser",
      setup: [
        "Executa outro modelo de fala e substitui dados por palavra neste intervalo.",
        "Transcrição, legendas e traduções fora do intervalo intactas.",
      ],
    },
    cleanup: {
      name: "Identificar cortes",
      desc: "Acha vícios de linguagem, pausas longas e tomadas ruins — revise as sugestões antes",
      setup: [
        "Busca vícios de linguagem, pausas de 0,8 s ou mais e inícios repetidos.",
        "Lista de cortes propostos para confirmar antes de cortar.",
      ],
    },
    translate: {
      name: "Traduzir legendas",
      desc: "Traduz frase a frase e alinha os timecodes com dados por palavra",
    },
    stale: {
      name: "Atualizar traduções defasadas",
      desc: "Retraduz apenas as frases cujo original foi editado ou cortado",
      setup: [
        "Retraduz só origem alterada: frases editadas ou parcialmente cortadas.",
        "Traduz da origem cortada; traduções de frases inteiramente cortadas removidas. Nada mais muda.",
      ],
    },
    dub: {
      name: "Dublagem traduzida",
      desc: "Escolha um idioma e deixe o vídeo falá-lo; com a sua voz ou como um nativo, o resto começa no padrão",
    },
    summary: {
      name: "Escrever um resumo",
      desc: "Texto e pontos com marcação de tempo — clique no tempo para ir até lá",
    },
    blog: {
      name: "Escrever um post de blog",
      desc: "Reescrever como artigo, do ponto de vista do autor ou de quem assiste",
    },
    title: {
      name: "Sugerir títulos",
      desc: "Várias opções com ângulos diferentes de uma vez — escolha uma",
    },
    desc: {
      name: "Escrever uma descrição",
      desc: "Descrição para publicar, com marcações de capítulos e tags",
    },
    cover: {
      name: "Criar uma capa",
      desc: "A partir de quadros-chave, criar algumas capas candidatas e escolher uma",
    },
  } as Record<AiToolId, ToolText>,
  unknownTool: (id: string) => `Ferramenta IA inexistente: ${id}`,
  cleanup: {
    fillers: {
      label: "Vícios de linguagem",
      sub: "Hum, ahn, tipo, e aí",
      off: "não procurar vícios de linguagem",
    },
    pauses: {
      label: "Pausas longas ≥ 0,8 s",
      sub: "Encontrado pelos tempos por palavra",
      off: "não mexer nas pausas",
    },
    repeats: {
      label: "Frases repetidas",
      sub: "A mesma frase começou duas vezes; fica a última",
      off: "não procurar frases repetidas",
    },
  } as Record<CleanupKey, { label: string; sub: string; off: string }>,

  cleanupOff: (offs: readonly string[]) => `Não buscar ${new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(offs)}`,
  lengths: { short: "Curto", medium: "Médio", long: "Longo" } as Record<WriteLength, string>,
  styles: {
    plain: "Simples",
    pop: "Didático",
    sharp: "Ácido",
    light: "Descontraído",
    pro: "Profissional",
    custom: "Personalizado…",
  } as Record<WriteStyle, string>,
  views: {
    auto: "Automático",
    author: "Sou o autor",
    viewer: "Sou espectador",
  } as Record<WriteView, string>,
  coverText: {
    none: "Sem texto",
    phrase: "Uma frase curta",
    'phrase-sub': "Frase e uma linha pequena",
  } as Record<CoverText, string>,
  viewName: { author: "author", viewer: "viewer" } as Record<'author' | 'viewer', string>,
  extraScope: (scope: string) => `Foque só em ${scope}`,
  extraLength: (label: string) => `Duração: ${label}`,
  extraStyle: (style: string) => `Estilo: ${style}`,
  extraLanguage: (language: string) => `Escreva em ${language}`,
  extraView: (view: string) => `Ponto de vista: ${view}`,
  extraPlatform: (platform: string) => `Publicando em: ${platform}. Siga suas regras e me lembre de verificar ao terminar`,
  extraIdea: (idea: string) => `Mensagem única da capa: ${idea}`,
  extraRatio: (ratio: string) => `Proporção ${ratio}`,
  extraCoverText: (label: string) => `Texto da capa: ${label}`,

  titled: (title: string) => `“${title}”`,
  thisVideo: "este vídeo",

  sourceEdited: (n: number | null) => (n === null ? "source edited" : pluralForm('pt-BR', n, { one: `${n} frase editada na origem`, other: `${n} frases editadas na origem` })),
  sourceCut: (n: number | null) => (n === null ? "source cut" : pluralForm('pt-BR', n, { one: `${n} frase cortada na origem`, other: `${n} frases cortadas na origem` })),
  sourceJoin: (parts: readonly string[]) => parts.join(", "),
  intents: {
    stale: (o: IntentArgs & { why: string }) =>
      `Algumas traduções em ${o.p} estão desatualizadas${o.why ? ` (${o.why})` : " porque a origem foi editada"}. Retraduza só estas frases${o.cut ? "; retraduza da origem cortada e remova traduções de frases totalmente cortadas" : ""}. Deixe todo o restante intacto.`,
    polish: (o: IntentArgs) =>
      `Revise a transcrição de ${scopeOf(o)}: corrija erros e pontuação, divida por assunto, sem reescrever minhas palavras.`,
    chapters: (o: IntentArgs) => `Divida ${o.p} em capítulos por assunto e dê título curto.`,
    speakers: (o: IntentArgs) => `Identifique falantes em ${scopeOf(o)}. Mostre resultados para confirmar antes de gravar.`,
    retranscribe: (o: IntentArgs) => `Retranscreva ${scopeOf(o)} com outro modelo; deixe fora do intervalo intacto.`,
    cleanup: (o: IntentArgs) =>
      `Encontre vícios, longas pausas e inícios repetidos em ${scopeOf(o)}. Liste primeiro; confirmarei antes de cortar.`,
    summary: (o: IntentArgs) => `Escreva resumo de pontos com códigos de tempo da transcrição de ${o.p}.`,
    blog: (o: IntentArgs) => `Reescreva ${o.p} como artigo de blog pronto para publicar.`,
    title: (o: IntentArgs & { count: number }) =>
      `Sugira ${o.count} títulos para ${o.p}, cada por ângulo diferente, com motivo de uma linha e recomende um.`,
    desc: (o: IntentArgs) => `Escreva descrição de ${o.p} para publicar com códigos de capítulos e tags.`,
    cover: (o: IntentArgs & { count: number }) =>
      `Crie ${o.count} capas candidatas para ${o.p}: escolha quadros-chave, uma abordagem diferente por base, e confira em tamanho pequeno antes de mostrar.`,
  },

  endSentence: (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`),
  joinPrompt: (head: string, extra: readonly string[]) => [head, ...extra].join(" "),
};
