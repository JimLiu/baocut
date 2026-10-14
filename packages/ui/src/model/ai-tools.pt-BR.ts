import { pluralForm } from '@baocut/protocol';
import { intlLocale } from '@baocut/protocol';
import type { AiToolsMessages } from './ai-tools.ts';

import type { AiToolId, AiToolGroup, CleanupKey, WriteLength, WriteStyle, WriteView, CoverText } from './ai-tools.ts';
type IntentArgs = { p: string; scope: string | null; edited: number | boolean; cut: number | boolean; count: number | null };
type ToolText = { name: string; desc: string; setup?: readonly string[]; why?: string };
const soonTail = 'O Runtime ainda não tem este fluxo nem sobreposição para ajustar o enquadramento; não há formulário aqui.';
const scopeOf = (o: IntentArgs) => o.scope ? `${o.scope} de ${o.p}` : o.p;

export const ptBR: AiToolsMessages = {
  shorts: {
    lengths: { auto: 'Automático', short: '15–30 s', medium: '30–60 s', long: '60–90 s', extended: '1–3 min', custom: 'Personalizado' },
    ratioSource: 'Manter original',
    focus: {
      auto: { label: 'Automático', sub: 'Vê de que lado está quem fala e põe o quadro nessa pessoa; sem ninguém, centralizado' },
      manual: { label: 'Eu defino', sub: 'Depois você posiciona o enquadramento de cada vídeo curto' },
      speaker: { label: 'Seguir quem fala', sub: 'O enquadramento segue quem estiver falando' },
    },
    speakerOff: 'Esta versão ainda não tem um modelo de pessoas e falantes',
    tracks: { both: 'Original + tradução', source: 'Só o original', translation: 'Só a tradução' },
    styles: {
      shorts: { label: 'Legendas para vídeos curtos', sub: 'Predefinição integrada que evita os botões da plataforma' },
      video: { label: 'Manter o estilo deste vídeo', sub: 'Mesmo tamanho e posição; os botões da plataforma podem cobri-las' },
    },
    focusPrompt: { auto: 'automático: pegue quadros espalhados pelo trecho, veja de que lado do quadro está quem fala e coloque o recorte nessa pessoa; se não encontrar ninguém, centralize', manual: 'centralizado por enquanto; eu ajusto cada um depois' },
    countN: (n) => `${n}`,
    autoHint: {
      both: 'Automático: o agente encontra os temas mais fortes que se sustentam sozinhos e decide quantos vídeos curtos fazer e quanto dura cada um, sem enchimento e sem cortar temas pela metade.',
      count: 'Automático: um vídeo curto para cada tema forte o bastante para se sustentar sozinho, sem enchimento.',
      length: 'Automático: cada vídeo curto vai do gancho de abertura até o tema se fechar, sem esticar nem cortar para caber numa duração.',
    },
    lineCount: (count, len) =>
      `${count === null ? 'Decida quantos vídeos curtos fazer pelos temas que encontrar' : `Faça ${count === 1 ? '1 vídeo curto' : `${count} vídeos curtos`}`}, ${len ? `cada um com ${len.min}–${len.max} segundos` : 'cada um do tamanho que o tema pedir, do gancho de abertura até a ideia se fechar'}, começando e terminando em limites de frase`,
    lineFrame: (ratio, focus) => (ratio ? `Proporção ${ratio}, enquadramento ${focus}` : 'Proporção: manter a original, sem recortar'),
    lineSubtitles: (tracks, style) => `Legendas: ${tracks}, ${style}`,
    lineSkipDone: 'Pule as partes que já viraram vídeos curtos',
    lineTopic: (topic) => `Procure só nas partes que falam de “${topic}”: encontre-as primeiro com speech_relevant e escolha entre elas`,
    lineDirect: 'Crie os vídeos assim que encontrá-los; não precisa me perguntar antes',
  },
  groups: {
    frame: "Visual",
    transcript: "Transcrição",
    translate: "Traduzir",
    writing: "Escrever",
    publish: "Publicar",
    sound: "Som",
  } as Record<AiToolGroup, string>,
  tools: {
    crop: {
      name: "Corte inteligente",
      desc: "Mudar proporção mantendo falantes, quadros e assuntos importantes",
      why: `Recorte inteligente segue falantes, quadros e assuntos importantes, depois recorta para nova proporção. ${soonTail}`,
    },
    shortscut: {
      name: "Cortar em vídeos curtos",
      desc: 'Encontrar os melhores temas deste vídeo e transformar cada um em um vídeo curto',
      setup: ['Encontra os temas que mais valem a pena publicar sozinhos e corta cada um em um vídeo curto completo.'],
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
    soundtrack: {
      name: "Gerar trilha sonora",
      desc: "Criar neste computador uma música de fundo do tamanho deste vídeo e colocá-la na faixa de música do vídeo",
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
  extraTopic: (topic: string) => `Escreva só sobre “${topic}”: primeiro encontre com speech_relevant as partes que falam disso e escreva a partir delas`,
  extraLength: (label: string) => `Duração: ${label}`,
  extraStyle: (style: string) => `Estilo: ${style}`,
  extraLanguage: (language: string) => `Escreva em ${language}`,
  extraView: (view: string) => `Ponto de vista: ${view}`,
  extraPlatform: (platform: string) => `Publicando em: ${platform}. Siga suas regras e me lembre de verificar ao terminar`,
  extraFrames: 'Onde for preciso uma imagem, tire quadros-chave do vídeo e coloque-os no artigo, cada um com uma legenda',
  extraIdea: (idea: string) => `Mensagem única da capa: ${idea}`,
  extraRatio: (ratio: string) => `Proporção ${ratio}`,
  extraCoverText: (label: string) => `Texto da capa: ${label}`,

  titled: (title: string) => `“${title}”`,
  thisVideo: "este vídeo",

  sourceEdited: (n: number | null) => (n === null ? "source edited" : pluralForm('pt-BR', n, { one: `${n} frase editada na origem`, other: `${n} frases editadas na origem` })),
  sourceCut: (n: number | null) => (n === null ? "source cut" : pluralForm('pt-BR', n, { one: `${n} frase cortada na origem`, other: `${n} frases cortadas na origem` })),
  sourceJoin: (parts: readonly string[]) => parts.join(", "),
  retranslateOne: (o) => `Traduza novamente a frase ${o.time ? `em ${o.time} ` : ''}de ${o.p} (“${o.text}”) para ${o.language}. Altere só a tradução desta frase; mantenha a temporização, o estilo das legendas e todas as outras frases exatamente como estão.`,
  retranslateStale: (o) => `Na tradução para ${o.language} de ${o.p}, há frases desatualizadas ou ainda não traduzidas (${o.count}). Traduza novamente só essas frases e mantenha todo o resto exatamente como está.`,
  intents: {
    shortscut: (o) => `Encontre em ${o.scope ? `${o.scope} de ${o.p}` : o.p} os temas que mais valem a pena publicar sozinhos e corte cada um em um vídeo curto completo: cada um é um vídeo novo que referencia o mesmo material original, e o vídeo original e sua linha do tempo não mudam.`,
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
  groupSub: { writing: 'Para quem lê: saber do que o vídeo trata sem assistir', publish: 'Para quem publica o vídeo: dar vontade de clicar e cumprir o que promete' },
  laterNote: 'Traduzir legendas ainda fica no painel Legendas e Traduzir dublagem no painel Áudio; eles vêm para cá depois. O recorte inteligente chega em breve.',
  effect: {
    shortscut: 'Cria novos vídeos filhos; o vídeo original e sua linha do tempo não mudam',
    polish: 'Altera a transcrição: aplicado ao terminar, desfeito em uma etapa',
    chapters: 'Altera os capítulos: aplicado ao terminar, desfeito em uma etapa',
    speakers: 'Você confirma o resultado primeiro; ele só é gravado no vídeo quando você aplica',
    retranscribe: 'Substitui a transcrição deste intervalo: aplicado ao terminar, desfeito em uma etapa',
    cleanup: 'Só propõe cortes; nada é cortado até você confirmar',
    stale: 'Retraduz só as frases desatualizadas; o resto não muda',
    summary: 'Não altera o vídeo: o resultado é para ler e copiar',
    blog: 'Não altera o vídeo: o resultado é para ler e copiar',
    title: 'Não altera o vídeo: escolha um para usar',
    desc: 'Não altera o vídeo: o resultado é para ler e copiar',
    cover: 'Não altera o vídeo: escolha uma para usar',
  },
  standMarkdown: (language) => (language ? `Escreva em Markdown, em ${language}.` : 'Escreva em Markdown, no mesmo idioma da transcrição.'),
  standLanguage: (language) => (language ? `Escreva em ${language}.` : 'Escreva no mesmo idioma da transcrição.'),
  standing: {
    summary: ['Comece pela conclusão e depois liste os pontos principais, cada um com código de tempo (mm:ss).', 'Tamanho moderado: de três a cinco parágrafos.'],
    blog: ['Escolha o ponto de vista pela origem do vídeo: como autor se o vídeo for meu, como espectador se for de outra pessoa.', 'Estilo simples, sem tom de propaganda.'],
    title: ['Coloque cada candidato em uma linha.'],
    desc: ['Inclua os códigos de tempo dos capítulos e uma linha de tags.'],
    cover: ['O texto da capa fica no idioma da transcrição.'],
    polish: ['Não reescreva minhas palavras nem remova nada; corrija só o que for claramente um erro.'],
    chapters: ['Agrupe por assunto, com um título curto para cada capítulo.'],
  },
  sessionNew: 'Nova sessão',
  sessionNewSub: 'Usa este vídeo como contexto; uma tarefa por sessão, sem reenviar um histórico longo',
  sessionCurrent: (title) => `Continuar “${title}”`,
  sessionUntitled: 'a sessão deste vídeo',
  sessionCurrentSub: (messages) =>
    messages === null
      ? 'Reenvia o histórico da sessão, o que custa mais quando o cache do prompt expira'
      : `${messages === 1 ? '1 mensagem' : `${messages} mensagens`} até agora · reenvia o histórico, o que custa mais quando o cache do prompt expira`,
  hintNew: 'Inicia uma nova sessão com este vídeo como contexto. Acompanhe por lá; qualquer mudança do agente no vídeo pode ser desfeita.',
  hintCurrent: 'Envia para a sessão atual deste vídeo, com o vídeo como contexto. Acompanhe por lá; qualquer mudança do agente no vídeo pode ser desfeita.',
};
