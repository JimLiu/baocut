import type { TtsLocalMessages } from './models-tts-local-copy.ts';

import { pluralForm } from '@baocut/protocol';
const voices = (n: number) => `${n} ${pluralForm('pt-BR', n, { one: 'voz integrada', other: 'vozes integradas' })}`;
function languageName(code: string): string { try { return new Intl.DisplayNames(['pt-BR'], { type: 'language' }).of(code) ?? code; } catch { return code; } }

export const ptBR: TtsLocalMessages = {

  languageShort: languageName,
  languagesAny: "Qualquer idioma",

  languagesMore: (shown: readonly string[], total: number) => `${shown.join(" / ")} e mais (${total} idiomas)`,

  summaryCloneDescribe: (builtins: number, byDuration: boolean) =>
    `${voices(builtins)}, clonar referência ou criar voz por gênero, idade e tom${
      byDuration ? "; pode ler em duração alvo" : ""
    }`,

  summaryClone: (builtins: number, style: boolean) =>
    `${voices(builtins)} ou clonar referência${style ? "; prompt de uma linha define estilo" : ""}`,

  summaryDescribe: (builtins: number) =>
    builtins
      ? `Descreva a voz em uma frase para criar; também pode usar diretamente as ${voices(builtins)}`
      : "Descreva a voz em uma frase para criar",

  summaryPreset: (speakers: number, style: boolean) =>
    `${speakers} predefinidas ${pluralForm('pt-BR', speakers, { one: "voz", other: "vozes" })}; escolha e lê${style ? "; prompt de uma linha define tom" : ""}`,
  modeCloneDescribe: "Vozes integradas / Clonar / Descrever",
  modeClone: "Vozes integradas / Clonar",
  modeDescribe: "Voz por descrição",
  modePreset: "Vozes predefinidas",
  factStyle: "Instrução de estilo",
  factSlow: "Mais lento",

  nonCommercialChip: "Só não comercial",
  licenseCommercial: (name: string) => `${name} · Uso comercial permitido`,
  licenseNonCommercial: (name: string, owner: string) =>
    `${name} · Só não comercial · Para uso comercial, solicite a ${owner} separadamente`,

  familyDesc: {
    'qwen3-tts':
      "Qwen3-TTS: CustomVoice tem 9 falantes e prompt para tom; Base clona referência; 1.7B VoiceDesign cria por descrição. 1.7B soa melhor, mais lento.",
    indextts2:
      "IndexTTS: oito vozes ou clonagem; usa só timbre, não transcrição. 2.5 também ajusta velocidade.",
    'gpt-sovits':
      "GPT-SoVITS: oito vozes ou clonagem; transcrição da referência melhora semelhança, exigindo 3–10 segundos.",
    voxcpm2:
      "VoxCPM2: oito vozes ou clonagem; melhor com transcrição, prompt ajusta estilo; saída 48 kHz.",
    omnivoice:
      "OmniVoice: oito vozes, clonagem ou criação por gênero/idade/tom da lista. Mais idiomas; só não comercial.",
  } as Record<string, string>,
  quickDescribe: "A descrição decide toda a voz; mudar cria outra pessoa",
  quickVoxcpm: "Tempo quase real: gera em tempo de leitura; primeiro carregamento cerca de 5 segundos",
  quickNonCommercial: (license: string) => `Só não comercial (${license}): escolha outro modelo para conteúdo comercial`,
  quickSlow: "Modelo grande: síntese mais lenta e primeiro carregamento mais longo",
};
