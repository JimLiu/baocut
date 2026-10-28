import type { TextModelChoiceMessages } from './text-model-choice.ts';

export const es: TextModelChoiceMessages = {
  placeholder: 'Elige un modelo de texto',
  providers: 'Proveedores',
  agentReady: (provider) => `Agente · Usa tu suscripción de ${provider} · Más lento que la API`,
  agentNote: (note) => `Agente · ${note}`,
  connected: (n) => (n === 1 ? 'Conectado · 1 modelo' : `Conectado · ${n} modelos`),
  notConnected: 'Sin conectar · Conéctalo en Ajustes',
  settings: 'Gestionar modelos de texto…',
  settingsSub: 'Conectar proveedores de API · Modelo predeterminado',
};
