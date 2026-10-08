import type { DubSetupMessages } from './dub-setup.ts';
export const es: DubSetupMessages = {
  useExisting: (name) => `Usar traducción existente · ${name}`,
  translateFirst: (language) => `${language} · traducir primero`, sameAsSource: 'Mismo idioma que el original',
  missingLibraryVoice: (id) => `Voz de la biblioteca (${id}, ya no está en la biblioteca)`, voiceRemoved: 'Esta voz ya no está en la biblioteca',
  noConsent: 'No hay declaración de consentimiento del hablante, por lo que no se subirá al proveedor',
  notCloned: (provider) => `Aún no se ha clonado con ${provider}`,
  cloneExpired: (provider) => `El clon de ${provider} ha caducado; vuelve a clonarlo`,
  modelDefaultNamed: (voice) => `Predeterminada del modelo · ${voice}`, modelDefault: 'Predeterminada del modelo',
  noDefaultVoice: 'Este modelo no tiene una voz predeterminada', needsVoice: 'Este modelo necesita que se especifique una voz',
  presetVoice: 'Voz predefinida', myVoiceProblem: (problem) => `Mis voces · ${problem}`, myVoice: 'Mis voces',
  customVoice: 'Introducir ID de voz…', customVoiceDesc: 'Una voz de tu cuenta del proveedor',
  purpose: (language, videoName) => `Doblaje: doblar ${videoName ? `«${videoName}»` : 'este vídeo'} a ${language}`,
  kindList: (kinds) => kinds.join(', '), transcriptNote: ' (la traducción que se sintetizará; si se traduce primero, también el texto original)',
  factWhat: 'Datos enviados', factTo: 'Enviado a', factScope: 'Ámbito', factPurpose: 'Finalidad', factBudget: 'Presupuesto', factRevoke: 'Revocación',
  scopeVideoNamed: (name) => `Solo el vídeo «${name}»`, scopeThisVideo: 'Solo este vídeo',
  budget: 'Contado por llamada, coste desconocido y llamadas ilimitadas; el proveedor cobra por uso como de costumbre',
  revoke: 'Revoca en cualquier momento en Ajustes › Privacidad y permisos › Autorizaciones para compartir datos; los datos ya enviados no se pueden recuperar',
};
