import type { ModelsLocalMessages } from './models-local-copy.ts';

export const ptBR: ModelsLocalMessages = {
  reason: {
    unsupported: "Não suportado neste computador",
    resource: "Desativado",
    'worker-missing': "Model Worker ausente",
    'missing-manifest': "Manifesto ausente",
    'missing-file': "Arquivos ausentes",
    'size-mismatch': "Tamanho do arquivo incompatível",
    'hash-mismatch': "Checksum incompatível",
    incomplete: "Componentes ausentes",
    'load-failed': "Não foi possível carregar",
    relocating: "Movendo",
  },
  chipDefault: "Padrão",
  chipLoading: "Carregando",
  chipReady: "Carregado",
  chipBusy: "Em execução",
  chipUnloading: "Descarregando",
  chipUnavailable: "Indisponível",
  capability: {
    transcribe: "Transcrever",
    align: "Alinhar",
    synthesize: "Sintetizar",
    image: "Imagem",
    separate: "Separar",
    diarize: "Diarização de falantes",
  },
  auto: "Automático",
  notInstalled: (name) => `${name} (não instalado)`,
  componentName: { aligner: "Alinhador forçado", speaker: "Embedding de falante", vad: "VAD (detecção de atividade de voz)" },
  weights: "Pesos do modelo",
};
