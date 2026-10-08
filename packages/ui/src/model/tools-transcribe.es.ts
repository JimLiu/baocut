import type { ToolsTranscribeMessages } from './tools-transcribe.ts';
export const es: ToolsTranscribeMessages = {
  mediaFormats: 'MP4, MOV, MP3, WAV, M4A', notInstalled: 'Sin instalar', notConnected: 'Sin conexión',
  noCloud: 'Aún no hay un servicio de reconocimiento de voz en línea',
  cloudLine: (connected: boolean, provider: string) => `${connected ? 'Conectado' : 'Sin conexión'} · ${provider} · transcribe en línea`,
  noLocal: 'Aún no hay un modelo de reconocimiento de voz en este ordenador',
  localReady: 'Instalado · reconoce en este ordenador', localMissing: 'Modelo aún sin instalar',
};
