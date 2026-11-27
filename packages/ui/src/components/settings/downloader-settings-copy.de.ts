import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const de: DownloaderSettingsMessages = {
  lead: 'Videos aus Links werden mit yt-dlp heruntergeladen. Video herunterladen, Transkribieren aus einem Link und der Agent laden alle mit diesen Einstellungen herunter.',
  toolGroup: 'Download-Tool',
  cookiesLead: 'Downloads nutzen deine Anmeldung aus dem Browser, sodass auch Videos heruntergeladen werden können, für die du angemeldet sein musst. Standardmäßig werden alle erkannten Browser verwendet.',
  autoUpdate: "yt-dlp automatisch aktualisieren",
  autoUpdateDesc:
    "Sucht einmal täglich nach einer neuen stabilen Version. Gibt es eine, wird die von BaoCut heruntergeladene Kopie nach Prüfung der Prüfsumme ersetzt; bis dahin kannst du mit der aktuellen Kopie weiter herunterladen. Ein selbst installiertes yt-dlp wird nicht verändert.",
  autoUpdateChecked: (when: string, version: string) => `Zuletzt geprüft: ${when} · neueste Version ${version}`,
};
