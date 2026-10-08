import type { ToolSpaceInputMessages } from './tool-space-input.ts';

export const ptBR: ToolSpaceInputMessages = {
  reasons: {
    trashed: "Na Lixeira",
    generating: "Ainda gerando; você pode escolher quando terminar",
    missing: "O arquivo está ausente; reconecte antes de escolher",
    failed: "A última geração falhou",
    textOnly: "Só é possível ler texto de documentos .txt e .md",
    subtitleOnly: "Só são aceitas legendas .srt e .vtt",
    noPath: "Este item não tem arquivo neste computador; um novo vídeo precisa começar com um arquivo local",
  },
  joinKinds: (labels) => labels.join(", "),
};
