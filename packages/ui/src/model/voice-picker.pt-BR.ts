import type { VoicePickerMessages } from './voice-picker.ts';

export const ptBR: VoicePickerMessages = {
  clonedOn: (provider) => `Clonada em ${provider} · sintetizada com este clone`,
  defaultVoice: 'Voz padrão',
  providerPreset: (provider, name) => `${name} de ${provider}`,
  loadingMine: 'Carregando Minhas vozes…',
  cloneNew: 'Clonar uma nova voz…',
  cloneNewHint: 'Grave ou importe de um arquivo em Configurações › Modelos › Síntese de fala › Minhas vozes',
  myVoices: 'Minhas vozes',
  providerVoices: (provider) => `Vozes de ${provider}`,
  customVoice: 'Inserir ID de voz…',
  customVoiceHint: 'Um ID de voz da sua conta do provedor',
  tempReference: 'Usar uma gravação uma vez…',
  tempReferenceHint: 'A API de síntese desta versão ainda não aceita uma gravação de referência temporária · salve em Minhas vozes e clone primeiro',
  other: 'Outros',
  voiceDeleted: 'Esta voz foi excluída · escolha outra ou volte ao padrão',
  customLine: 'Enviado ao provedor sem alteração para verificação; você também pode criar uma voz clonada em Minhas vozes e escolhê-la',
  presetLine: (provider, voiceId) => voiceId === null ? `Voz de ${provider}` : `Voz de ${provider} · ${voiceId}`,
  defaultLine: (provider, name) => `Se você não escolher, será usada a voz padrão de ${provider} (${name})`,
  noDefault: 'Este modelo não tem voz padrão; escolha uma primeiro',
};
