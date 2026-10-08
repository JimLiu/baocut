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
    'video-file': {
      label: "Arquivos de vídeo",
      desc: "Baixa, comprime, mescla e extrai áudio com yt-dlp/ffmpeg local. Resultados são vídeo e áudio.",
    },
  },

  artifactItems: (artifacts) => artifacts.length ? `itens de ${new Intl.ListFormat('pt-BR', { type: 'conjunction' }).format(artifacts.map((a) => ARTIFACT_NOUN[a]))}` : 'itens de resultado',
  resultWritesVideo: "Resultado: gravado no vídeo escolhido",
  resultInSpace: (items: string) => `Resultado: ${items} no Space`,
  resultAlsoCreate: "também pode criar vídeo",
  resultWritesEditable: "grava em vídeo editável quando escolhido",
  joinResult: (parts: readonly string[]) => parts.join("; "),
};
