import type { VoicePickerMessages } from './voice-picker.ts';
export const es: VoicePickerMessages = {
  clonedOn: (provider) => `Clonado en ${provider} · sintetizado con este clon`,
  defaultVoice: 'Voz predeterminada', providerPreset: (provider, name) => `${name} de ${provider}`,
  loadingMine: 'Cargando Mis voces…', cloneNew: 'Clonar una voz nueva…',
  cloneNewHint: 'Graba una o importa un archivo en Ajustes › Modelos › Síntesis de voz › Mis voces',
  myVoices: 'Mis voces', providerVoices: (provider) => `Voces de ${provider}`,
  customVoice: 'Introducir un ID de voz…', customVoiceHint: 'Un ID de voz de tu cuenta del proveedor',
  tempReference: 'Usar una grabación una vez…',
  tempReferenceHint: 'La API de síntesis de esta versión aún no admite una grabación de referencia de un solo uso · guárdala en Mis voces y clónala primero',
  other: 'Otros', voiceDeleted: 'Esta voz se eliminó · elige otra o vuelve a la predeterminada',
  customLine: 'Se envía al proveedor tal cual para que la compruebe; también puedes crear una voz clonada en Mis voces y elegirla',
  presetLine: (provider, voiceId) => voiceId === null ? `Voz de ${provider}` : `Voz de ${provider} · ${voiceId}`,
  defaultLine: (provider, name) => `Si no eliges, se usa la voz predeterminada de ${provider} (${name})`,
  noDefault: 'Este modelo no tiene una voz predeterminada; primero elige una',
};
