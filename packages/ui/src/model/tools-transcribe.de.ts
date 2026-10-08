import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const de: ToolsTranscribeMessages = {
  mediaFormats: "MP4, MOV, MP3, WAV, M4A",
  notInstalled: "Nicht installiert",
  notConnected: "Nicht verbunden",
  noCloud: "Noch kein Online-Spracherkennungsdienst",
  cloudLine: (connected: boolean, provider: string) => `${connected ? "Verbunden" : "Nicht verbunden"} · ${provider} · transkribiert online`,
  noLocal: "Noch kein Spracherkennungsmodell auf diesem Computer",
  localReady: "Installiert · erkennt auf diesem Computer",
  localMissing: "Modell noch nicht installiert",
};
