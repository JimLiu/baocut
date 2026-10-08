import type { ModelsLocalSpeechMessages } from './local-speech.ts';

export const ptBR: ModelsLocalSpeechMessages = {
  paceQwen06: 'cerca de 55 vezes mais lento que o tempo real; uma frase de 3 segundos leva dois a três minutos',
  paceQwen17: 'espera-se que seja mais lento que o 0.6B (cerca de 55 vezes mais lento que o tempo real); este não foi medido',
  paceIndexTts2: 'espera-se que seja semelhante ao IndexTTS 2.5 (120–145 vezes mais lento que o tempo real); este não foi medido',
  paceIndexTts25: '120–145 vezes mais lento que o tempo real; uma frase de quatro ou cinco segundos leva sete a dez minutos',
  paceGptSovits: 'cerca de 6 vezes mais lento que o tempo real; uma frase de 4 segundos leva cerca de meio minuto',
  paceVoxcpm2: 'o maior modelo; espera-se que cada frase leve vários minutos; este não foi medido',
  paceOmnivoice: 'cerca de 30 vezes mais lento que o tempo real; uma frase de 4 segundos leva cerca de dois minutos',
  paceDefault: 'cada frase leva alguns minutos',
  cpuNote: (p) => `Sintetiza na CPU deste computador usando somente um ou dois núcleos: ${p.pace}. Deve ser muito mais rápido com uma GPU NVIDIA (CUDA) (não medido)`,
  oneVoiceSource: 'Forneça somente um de voice, reference e voiceDescription',
  modeUnsupported: (p) => `O modelo ${p.modelId} não oferece suporte a ${p.what} (${p.mode})`,
  modeClone: 'clonagem de uma gravação de referência', modeDescribe: 'criação de uma voz por descrição',
  noReferenceTranscript: (p) => `O modelo ${p.modelId} não lê a transcrição da gravação de referência (reference.transcript)`,
  descriptionEmpty: 'A descrição não pode ficar vazia',
  noPresetVoice: (p) => `O modelo ${p.modelId} não tem vozes predefinidas; forneça ${p.need}`,
  noSuchVoice: (p) => `O modelo ${p.modelId} não tem a voz ${p.voice}`, noDefaultVoice: (p) => `O modelo ${p.modelId} não tem voz padrão; especifique voice`,
  termNotInVocabulary: (p) => `Descrições de voz do modelo ${p.modelId} só aceitam palavras do vocabulário: “${p.term}” não está nele`,
  onePerCategory: (p) => `Descrições de voz do modelo ${p.modelId} aceitam no máximo um termo por categoria (${p.category})`,
  builtinReferenceLabel: 'gravação de voz integrada',
  referenceUnreadable: (p) => `Não é possível ler a gravação de referência “${p.name}”: está ausente, não é um arquivo ou não permite leitura. Tente outra gravação`,
};
