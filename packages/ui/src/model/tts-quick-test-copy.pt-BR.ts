import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';
import { pluralForm } from '@baocut/protocol';

const characters = (n: number) => pluralForm('pt-BR', n, { one: `${n} caractere`, other: `${n} caracteres` });

export const ptBR: TtsQuickTestMessages = {
  kindIntro: 'Introdução', kindNumbers: 'Números', kindMood: 'Tom',
  presetSub: { Vivian: 'Feminina · Brilhante', Serena: 'Feminina · Calma', Uncle_Fu: 'Masculina · Grave', Dylan: 'Masculina · Jovem', Eric: 'Masculina · Locução', Ryan: 'Masculina · Animada', Aiden: 'Masculina · Narrativa', Ono_Anna: 'Feminina · Japonês', Sohee: 'Feminina · Coreano' },
  builtinVoice: { 'zh-female': 'Feminina chinesa', 'zh-male': 'Masculina chinesa', 'en-female': 'Feminina inglesa', 'en-male': 'Masculina inglesa', 'ja-female': 'Feminina japonesa', 'ja-male': 'Masculina japonesa', 'es-female': 'Feminina espanhola', 'es-male': 'Masculina espanhola' },
  builtinCredit: 'Corpus FLEURS (CC BY 4.0) e CMU ARCTIC · aparado e com volume normalizado · avisos originais mantidos',
  describeWarm: 'Feminina calorosa', describeWarmText: 'Uma voz feminina adulta, calorosa e amigável, em ritmo moderado, como conversar com um amigo',
  describeAnchor: 'Masculina estável', describeAnchorText: 'Uma voz masculina adulta estável e clara, com tom de locução e ritmo uniforme',
  describeBright: 'Jovem brilhante', describeBrightText: 'Uma voz jovem brilhante e viva, com tom descontraído',
  toneUpbeat: 'Animado', toneUpbeatText: 'Fale com energia brilhante e animada, um pouco mais rápido que o normal', toneNatural: 'Natural', toneAnchor: 'Estável', toneAnchorText: 'Fale em uma voz de locução estável e clara, em ritmo uniforme', toneSoft: 'Suave', toneSoftText: 'Fale suavemente e mais devagar, como em uma conversa de perto',
  customDescribe: 'Descrever minha voz', defaultVoice: 'Voz padrão', myVoices: 'Minhas vozes', fileVoice: 'Usar um trecho uma vez', seconds: (n: string) => `${n} s`,
  textRequired: 'Insira o texto para sintetizar primeiro', textTooLong: (max: number) => `Até ${characters(max)} por vez; use uma frase mais curta para a prévia`, describeRequired: 'Descreva a voz desejada em uma frase primeiro', myVoiceGone: 'Esta voz não está mais em Minhas vozes; escolha outra', referenceRequired: 'Escolha uma gravação de referência primeiro ou volte a uma voz integrada',
  phaseSubmitting: 'Enviando', phaseQueued: 'Na fila', phaseLoading: 'Carregando modelo', phaseGeneratingStep: (step: number, total: number) => `Gerando áudio · etapa ${step}/${total}`, phaseGenerating: 'Gerando áudio', phaseWriting: 'Gravando áudio', phasePreparing: 'Preparando',
  sampleVoice: (name: string) => `Amostra · ${name}`, customText: 'Texto personalizado', elapsed: (seconds: string) => `Levou ${seconds} s`, audioLength: (seconds: string) => `Áudio ${seconds} s`,
};
