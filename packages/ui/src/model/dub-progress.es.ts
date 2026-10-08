import type { DubProgressMessages } from './dub-progress.ts';
export const es: DubProgressMessages = {
  unit: {
    fit: 'Colocado tal cual', tempo: 'Colocado tras acelerar', extended: 'Acelerado hasta el límite, usando el silencio posterior',
    overlong: 'Demasiado largo para caber, sin colocar', stale: 'Traducción desactualizada, sin sintetizar',
    offTimeline: 'La frase original ya no está en la línea de tiempo, sin colocar', voiceUnavailable: 'Voz del hablante no disponible, sin sintetizar',
  },
  reasonStale: 'El clon ha caducado; vuelve a clonarlo en la biblioteca de voces',
  reasonMissing: 'Aún no se ha clonado con este proveedor',
  reasonNoConsent: 'No hay declaración de consentimiento del hablante, por lo que no se subirá al proveedor',
  reasonRemoved: 'Esta voz ya no está en la biblioteca',
  reasonServiceClient: 'Los clientes de servicios externos no pueden usar voces de la biblioteca',
  codeCloneRequired: 'No hay un clon válido con este proveedor', codeNotFound: 'Voz no encontrada',
  warning: {
    DUB_SEPARATION_NOT_CONFIGURED: 'Fondo sin separar', DUB_UNITS_STALE: 'Traducciones desactualizadas sin sintetizar',
    DUB_UNITS_OVERLONG: 'Algunas frases son demasiado largas para caber',
    DUB_UNITS_OFF_TIMELINE: 'Algunas frases originales ya no están en la línea de tiempo',
    DUB_MUTED_UNVOICED: 'También se silenció el audio original de las frases sin sintetizar',
    DUB_BACKGROUND_MUTED: 'También se silenció el audio de fondo', DUB_VOICE_UNAVAILABLE: 'Las voces de algunos hablantes no están disponibles',
  },
  separated: 'Fondo separado',
  separationNotConfigured: 'Se solicitó separación, pero no hay una capacidad de separación configurada: se omitió y el audio original se conservó tal cual',
  notSeparated: 'Fondo sin separar', originalMuted: 'Audio original silenciado', originalKept: 'Audio original sin cambios',
  originalDucked: (db) => db ? `Audio original reducido ${db} dB mientras se reproduce el doblaje` : 'Audio original reducido mientras se reproduce el doblaje',
};
