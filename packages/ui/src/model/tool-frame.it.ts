import type { ToolFrameMessages } from './tool-frame.ts';

export const it: ToolFrameMessages = {
  noneAvailable: (noun) => `Nessun ${noun} ancora disponibile; configuralo nelle Impostazioni`,
  pickOne: (noun) => `Scegli prima: ${noun}`,
  notInstalled: (name) => `Manca ancora l’installazione di ${name}`,
  notConnected: (provider) => `Non c’è ancora una connessione con ${provider}`,
  unavailable: (name, why) => `${name} · ${why ?? 'Non disponibile'}`,
  notInstalledWarning: (name) => `Manca ancora l’installazione di ${name}. Scegline uno installato o scaricalo nelle Impostazioni`,
  notConnectedWarning: (provider) => `Non c’è ancora una connessione con ${provider}. Scegline uno funzionante o connettilo nelle Impostazioni`,
  noModel: (noun, local) => local ? `Nessun ${noun} ancora disponibile. Installa un modello locale o connetti un servizio cloud nelle Impostazioni.` : `Nessun ${noun} ancora disponibile. Connetti un servizio cloud nelle Impostazioni.`,
};
