import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const ptBR: ToolsTranscribeMessages = {
  mediaFormats: "MP4, MOV, MP3, WAV, M4A",
  notInstalled: "Não instalado",
  notConnected: "Não conectado",
  noCloud: "Ainda não há serviço de reconhecimento de fala online",
  cloudLine: (connected, provider) => `${connected ? "Conectado" : "Não conectado"} · ${provider} · transcreve online`,
  noLocal: "Ainda não há modelo de reconhecimento de fala neste computador",
  localReady: "Instalado · reconhece neste computador",
  localMissing: "Modelo ainda não instalado",
};
