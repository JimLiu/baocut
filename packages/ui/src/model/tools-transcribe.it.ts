import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const it: ToolsTranscribeMessages = {
  mediaFormats: "MP4, MOV, MP3, WAV, M4A",
  notInstalled: "Non installato",
  notConnected: "Non connesso",
  noCloud: "Nessun servizio di riconoscimento vocale online ancora disponibile",
  cloudLine: (connected, provider) => `${connected ? "Connesso" : "Non connesso"} · ${provider} · trascrive online`,
  noLocal: "Nessun modello di riconoscimento vocale su questo computer ancora disponibile",
  localReady: "Installato · riconosce su questo computer",
  localMissing: "Modello non ancora installato",
};
