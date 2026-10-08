import type { QuickChatMessages } from './quick-chat-copy.ts';

export const it: QuickChatMessages = {
  label: "Sessione di questo video",
  open: "Apri la sessione di questo video",
  fresh: "Nuova sessione",
  expand: "Espandi la sessione a sinistra",
  minimize: "Riduci a icona",
  about: (name: string) => `Informazioni su «${name}»`,
  placeholder: "Cosa vuoi fare con questo video? Digita / per gli strumenti",
  hint: "L’agente ci lavora direttamente qui",
  failed: (message: string) => `Impossibile inviare: ${message}`,
  untitled: "Video",
  send: "Invia",
};
