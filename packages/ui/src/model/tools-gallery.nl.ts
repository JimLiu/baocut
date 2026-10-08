import { pluralForm } from '@baocut/protocol';
import type { ToolsGalleryMessages } from './tools-gallery.ts';

export const nl: ToolsGalleryMessages = {
  transcode: "Gecodeerd op deze computer met ffmpeg · niets geüpload",
  linkReady: "Downloadtool gereed",
  pipelineMissing: "Deze Runtime-versie heeft nog geen pipeline voor deze tool, dus hij kan nu niet worden gebruikt",

  withRemedy: (message: string, remedy: string) => `${message}. ${remedy}`,
  localModels: (n: number) => `${n} lokale ${pluralForm('nl', n, { one: "model", other: "modellen" })}`,
  cloudConnected: (n: number) => `${n} online ${pluralForm('nl', n, { one: "aanbieder", other: "aanbieders" })} verbonden`,
  noSpeech: "Nog geen spraaksynthesemodel beschikbaar",
  noImage: "Nog geen afbeeldingsmodel beschikbaar",
  noText: "Nog geen tekstmodel beschikbaar",
};
