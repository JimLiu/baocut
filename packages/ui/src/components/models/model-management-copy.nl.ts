import type { ModelManagementMessages } from './model-management-copy.ts';

export const nl: ModelManagementMessages = {
  removeModel: "Model verwijderen",
  removeModelBody: "Dit toegevoegde model uit BaoCut verwijderen? De aanbieder en accounts blijven behouden. Als dit het standaardmodel is, wordt die keuze gewist. Een ingebouwd model met dezelfde ID blijft na verwijdering in de lijst staan en kan niet worden verwijderd.",
  pickAudio: "Audio of video kiezen",
  asrTitle: "Spraakherkenning testen",
  asrNote: "Kies een kort audio- of videobestand. De audio wordt naar de gekozen aanbieder gestuurd. TXT/SRT worden op de ingestelde locatie opgeslagen en in Space getoond.",
  asrRunning: "Audio verzenden en wachten op transcriptie…",
  desktopOnly: "Kies een lokaal bestand in de desktopapp om spraakherkenning te testen.",
};
