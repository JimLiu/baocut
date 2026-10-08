import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const pl: ToolsTranscribeMessages = {
  mediaFormats: "MP4, MOV, MP3, WAV, M4A",
  notInstalled: "Nie zainstalowano",
  notConnected: "Niepołączony",
  noCloud: "Nie ma jeszcze usługi rozpoznawania mowy online",
  cloudLine: (connected, provider) => `${connected ? "Połączono" : "Niepołączony"} · ${provider} · transkrybuje online`,
  noLocal: "Na tym komputerze nie ma jeszcze modelu rozpoznawania mowy",
  localReady: "Zainstalowany · rozpoznaje na tym komputerze",
  localMissing: "Model nie jest jeszcze zainstalowany",
};
