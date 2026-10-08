import { pluralForm } from '@baocut/protocol';
import type { ToolsGalleryMessages } from './tools-gallery.ts';

export const pl: ToolsGalleryMessages = {
  transcode: "Kodowanie na tym komputerze przez ffmpeg · nic nie jest przesyłane",
  linkReady: "Narzędzie pobierania gotowe",
  pipelineMissing: "Ta wersja Runtime nie ma jeszcze potoku dla tego narzędzia, więc jest ono na razie niedostępne",
  withRemedy: (message, remedy) => `${message}. ${remedy}`,
  localModels: (n: number) => pluralForm('pl', n, { one: `${n} model lokalny`, few: `${n} modele lokalne`, many: `${n} modeli lokalnych`, other: `${n} modelu lokalnego` }),
  cloudConnected: (n: number) => pluralForm('pl', n, { one: `Połączono ${n} dostawcę online`, few: `Połączono ${n} dostawców online`, many: `Połączono ${n} dostawców online`, other: `Połączono ${n} dostawcy online` }),
  noSpeech: "Nie ma jeszcze dostępnego modelu syntezy mowy",
  noImage: "Nie ma jeszcze dostępnego modelu generowania obrazów",
  noText: "Nie ma jeszcze dostępnego modelu tekstowego",
};
