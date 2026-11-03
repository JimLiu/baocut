import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

type Artifact = 'audio' | 'image' | 'doc' | 'final' | 'subtitle';
const ARTIFACT_NOUN: Record<Artifact, string> = { audio: 'áudio', image: 'imagem', doc: 'documento', final: 'arquivo de vídeo', subtitle: 'legenda' };

export const ptBR: ToolCatalogMessages = {
  inputLabels: {
    file: "Arquivo local",
    space: "Space",
    link: "Link",
    text: "Texto",
    video: "Vídeo no Space",
    document: "Documento",
  },
  outputLabels: { video: "Vídeo", artifact: "Item no Space" },
  artifactLabels: { audio: "Áudio", image: "Imagem", doc: "Documento", final: "Arquivo de vídeo", subtitle: "Legendas" },
  tools: {
    transcribe: {
      name: "Transcrever",
      desc: "Transcreve vídeo/áudio; em vídeo editável, grava e adiciona camada de legendas",
    },
    'translate-subtitles': {
      name: "Traduzir legendas",
      desc: "Traduz para outro idioma; em vídeo transcrito, adiciona tradução e camada bilíngue, original intacto",
    },
    dub: {
      name: "Dublagem traduzida",
      desc: "Nova dublagem da tradução; áudio original reduzido, silenciado ou mantido",
    },
    'synthesize-speech': {
      name: "Gerar fala",
      desc: "Lê texto, documentos ou legendas; voz predefinida, clonada ou descrita",
    },
    'generate-text': {
      name: "Geração de texto",
      desc: "Chama texto direto para roteiro, resumo ou conteúdo; documentos e legendas Space como material",
    },
    'generate-image': {
      name: "Gerar imagem",
      desc: "Descreva imagem para nuvem ou local; referências, proporção e quantidade opcionais",
    },
    'upscale-image': { name: 'Ampliar imagem', desc: 'Amplie imagens de 2 a 4× neste computador com o Real-ESRGAN, o waifu2x ou pesos do Upscayl, ou peça a um modelo de imagem que as redesenhe maiores' },
    'remove-object': { name: 'Remover objeto', desc: 'Pinte sobre pessoas ou coisas que você não quer, e a área é preenchida a partir do entorno' },
    'remove-watermark': { name: 'Remover marca d’água', desc: 'Marque com uma caixa uma marca d’água, logotipo ou faixa de legenda; imagens com ela no mesmo lugar podem ser feitas de uma vez' },
    'repaint-image': { name: 'Redesenhar área', desc: 'Pinte uma área e diga o que ela deve virar; só essa área muda' },
    'expand-image': { name: 'Expandir imagem', desc: 'Estenda a imagem para uma nova proporção; as bordas adicionadas continuam o original' },
    'generate-music': { name: 'Gerar música', desc: 'Escreva um estilo e uma letra opcional e componha uma música ou faixa instrumental com um modelo de música local; duração e seed são opcionais' },
    'link-import': {
      name: "Baixar vídeos",
      desc: "Cole link para baixar; cookies e transcrição com legendas opcionais",
    },
    'compress-video': {
      name: "Compactar vídeo",
      desc: "Recodifique para um tamanho ou qualidade antes de enviar ou fazer upload",
    },
    'merge-video': {
      name: "Juntar vídeos",
      desc: "Une vídeos em um arquivo, na ordem",
    },
    'extract-audio': {
      name: "Extrair áudio",
      desc: "Retira imagem e mantém áudio; codecs comuns copiados sem reencodificar",
    },
    'stabilize-video': {
      name: "Estabilizar vídeo",
      desc: "Estabilize gravações tremidas com a câmera na mão usando o ffmpeg neste computador, sem baixar nada",
    },
    'upscale-video': {
      name: "Ampliar vídeo",
      desc: "Amplie um vídeo de 2 a 4× com o Real-ESRGAN neste computador, acrescentando detalhes estimados",
    },
    'interpolate-video': {
      name: "Interpolar quadros",
      desc: "Crie câmera lenta suave ou uma taxa de quadros maior com o RIFE neste computador",
    },
    'match-color': {
      name: "Igualar cor",
      desc: "Ajuste a cor de vários clipes ou imagens a uma única referência",
    },
    'remove-background': {
      name: "Remover fundo",
      desc: "Recorte o assunto sem tela verde; vídeos saem em MOV com transparência e imagens em PNG",
    },
    'separate-audio': {
      name: "Separar áudio em faixas",
      desc: "Divida a primeira faixa de um arquivo de áudio ou vídeo em voz e acompanhamento e, se quiser, em bateria, baixo e outros",
    },
  },
  targetNone: "Só criar transcrição e legendas",
  targetCreate: "Criar vídeo em projeto",
  subtitleFile: "Arquivo local de legendas",
  groups: {
    speech: {
      label: "Fala e legendas",
      desc: "Transcreve, traduz, dubla e lê texto. Resultados em documentos, legendas e áudio; vídeo editável selecionado recebe gravação.",
    },
    'text-image': { label: "Texto e imagens", desc: "Chama texto/imagens direto; resultados em documentos/imagens." },
    music: { label: 'Música', desc: 'Gere músicas e trilhas de fundo com um modelo de música local. Os resultados são itens de áudio.' },
    'video-file': {
      label: "Arquivos de vídeo",
      desc: "Baixa, comprime, mescla e extrai áudio com yt-dlp/ffmpeg local. Resultados são vídeo e áudio.",
    },
    footage: {
      label: "Tratamento de filmagens",
      desc: "Estabilize, amplie, interpole, iguale a cor, remova fundos ou separe o áudio neste computador. Cada entrada vira um novo arquivo; os originais não são alterados.",
    },
  },

  artifactItems: (artifacts) => artifacts.length ? `itens de ${new Intl.ListFormat('pt-BR', { type: 'conjunction' }).format(artifacts.map((a) => ARTIFACT_NOUN[a]))}` : 'itens de resultado',
  resultWritesVideo: "Resultado: gravado no vídeo escolhido",
  resultInSpace: (items: string) => `Resultado: ${items} no Space`,
  resultAlsoCreate: "também pode criar vídeo",
  resultWritesEditable: "grava em vídeo editável quando escolhido",
  joinResult: (parts: readonly string[]) => parts.join("; "),
};
