import type { ToolsTranscribeMessages } from './tools-transcribe.ts';

export const fr: ToolsTranscribeMessages = {
  mediaFormats: 'MP4, MOV, MP3, WAV, M4A', notInstalled: 'Non installé', notConnected: 'Non connecté', noCloud: 'Aucun service de reconnaissance vocale en ligne',
  cloudLine: (connected, provider) => `${connected ? 'Connecté' : 'Non connecté'} · ${provider} · transcription en ligne`,
  noLocal: 'Aucun modèle de reconnaissance vocale sur cet ordinateur', localReady: 'Installé · reconnaissance sur cet ordinateur', localMissing: 'Modèle non installé',
};
