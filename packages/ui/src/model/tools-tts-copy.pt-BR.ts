import type { ToolsTtsMessages } from './tools-tts-copy.ts';
import { pluralForm } from '@baocut/protocol';

const characters = (n: number) => pluralForm('pt-BR', n, { one: `${n} caractere`, other: `${n} caracteres` });

export const ptBR: ToolsTtsMessages = {
  emptyText: 'Escreva primeiro o texto a ler',
  vibes: {
    radio: { name: 'Rádio noturno', style: 'Como rádio noturno: um pouco mais lento, voz baixa' }, launch: { name: 'Lançamento de produto', style: 'Um lançamento de produto: mais caloroso e enérgico, destacando os pontos principais' }, bedtime: { name: 'História para dormir', style: 'Uma história suave para dormir: ritmo mais lento, tom delicado' }, news: { name: 'Boletim de notícias', style: 'Um boletim de notícias: dicção clara, ritmo estável' }, teach: { name: 'Aula', style: 'Explique como em uma aula: tom de conversa, pausando nos pontos principais' }, vlog: { name: 'Narração animada', style: 'Leve e animada, um pouco mais rápida, com sorriso na voz' },
  },
  statsEmpty: (max: number) => `0 / ${characters(max)}`, stats: (n: number, max: number, segments: number, seconds: string) => `${n} / ${characters(max)} · ${pluralForm('pt-BR', segments, { one: `${segments} segmento`, other: `${segments} segmentos` })} · cerca de ${seconds} s`,
  defaultVoiceOption: (name: string) => `Padrão · ${name}`, customVoiceOption: 'Inserir ID de voz…',
  presetOnly: (model: string) => `${model} só aceita vozes predefinidas, então Minhas vozes não podem ser usadas`, cannotClone: (provider: string) => `${provider} não pode clonar · use as vozes predefinidas`,
  noConsent: 'Não marcada como sua própria voz ou usada com permissão, então não será enviada a terceiros · adicione a declaração em Minhas vozes',
  cloneStale: (provider: string) => `O clone em ${provider} está desatualizado (a gravação de referência mudou) · envie novamente em Minhas vozes`,
  notCloned: (provider: string) => `Ainda não clonada em ${provider} · envie uma vez em Minhas vozes`,
  customVoice: 'Voz personalizada', deletedVoice: 'Voz excluída', myVoices: 'Minhas vozes', defaultVoice: 'Voz padrão',
  cannotSpeak: (model: string, language: string) => `${model} não pode ler ${language}`, voiceDeleted: 'A voz selecionada foi excluída; escolha outra',
  tooLong: (model: string, max: number) => `${model} aceita no máximo ${characters(max)} por vez; encurte o texto primeiro`,
  enterVoiceId: 'Insira um ID de voz primeiro', pickVoice: 'Escolha uma voz primeiro', noVoices: 'Este modelo não tem vozes disponíveis', seedInteger: 'A semente deve ser um número inteiro', noModel: 'Ainda não há modelo de síntese de fala disponível', connectFirst: (provider: string) => `Conecte ${provider} primeiro`,
  readsMaterial: (model: string, voice: string, name: string) => `${model} · ${voice} · lê o texto de “${name}”`, estimate: (seconds: string, chars: number) => ` · cerca de ${seconds} s · cerca de ${characters(chars)}`,
  chars: (n: number) => characters(n), speech: 'Fala', presetVoices: (n: number) => pluralForm('pt-BR', n, { one: `${n} voz predefinida`, other: `${n} vozes predefinidas` }), customVoiceId: 'ID de voz personalizado', takesStyle: 'Aceita notas de estilo',
  speedRange: (min: number, max: number) => `Velocidade ${min}–${max}×`, maxChars: (max: number) => `Até ${characters(max)} por vez`, headerChip: (provider: string) => `Online · ${provider} · cobrado pelo uso`,
};
