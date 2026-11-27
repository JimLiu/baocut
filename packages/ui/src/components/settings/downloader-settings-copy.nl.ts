import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const nl: DownloaderSettingsMessages = {
  lead: 'Video’s downloaden via een link gebeurt met yt-dlp. Video downloaden, transcriberen via een link en de agent downloaden allemaal met deze instellingen.',
  toolGroup: 'Downloadtool',
  cookiesLead: 'Downloads gebruiken je inlog uit de browser, zodat ook video’s waarvoor je moet inloggen kunnen worden gedownload. Standaard worden alle gevonden browsers gebruikt.',
  autoUpdate: "yt-dlp automatisch bijwerken",
  autoUpdateDesc:
    "Controleert één keer per dag op een nieuwe stabiele versie. Is die er, dan wordt de kopie die BaoCut heeft gedownload vervangen nadat de controlesom is gecontroleerd; tot dan kun je met de huidige kopie blijven downloaden. Een yt-dlp die je zelf hebt geïnstalleerd, blijft ongewijzigd.",
  autoUpdateChecked: (when: string, version: string) => `Laatst gecontroleerd: ${when} · nieuwste versie ${version}`,
};
