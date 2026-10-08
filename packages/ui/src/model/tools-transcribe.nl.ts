import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const nl: ToolsTranscribeMessages = {
  mediaFormats: "MP4, MOV, MP3, WAV, M4A",
  notInstalled: "Niet geïnstalleerd",
  notConnected: "Niet verbonden",
  noCloud: "Nog geen online spraakherkenningsdienst",
  cloudLine: (connected: boolean, provider: string) => `${connected ? "Verbonden" : "Niet verbonden"} · ${provider} · transcribeert online`,
  noLocal: "Nog geen spraakherkenningsmodel op deze computer",
  localReady: "Geïnstalleerd · herkent op deze computer",
  localMissing: "Model nog niet geïnstalleerd",
};
