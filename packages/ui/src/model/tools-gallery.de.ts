import { pluralForm } from '@baocut/protocol';
import type { ToolsGalleryMessages } from './tools-gallery.ts';

export const de: ToolsGalleryMessages = {
  transcode: "Auf diesem Computer mit ffmpeg codiert · nichts hochgeladen",
  linkReady: "Downloadwerkzeug bereit",
  pipelineMissing: "Diese Runtime-Version hat noch keine Pipeline für dieses Werkzeug; es kann derzeit nicht verwendet werden",

  withRemedy: (message: string, remedy: string) => `${message}. ${remedy}`,
  localModels: (n: number) => pluralForm('de', n, { one: `${n} lokales Modell`, other: `${n} lokale Modelle` }),
  cloudConnected: (n: number) => `${n} Online-${pluralForm('de', n, { one: "Anbieter", other: "Anbieter" })} verbunden`,
  noSpeech: "Noch kein Sprachsynthesemodell verfügbar",
  noImage: "Noch kein Bilderzeugungsmodell verfügbar",
  noText: "Noch kein Textmodell verfügbar",
};
