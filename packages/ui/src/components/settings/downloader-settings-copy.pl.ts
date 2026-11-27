import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const pl: DownloaderSettingsMessages = {
  lead: 'Filmy z linków są pobierane przez yt-dlp. Pobieranie wideo, transkrypcja z linku i agent pobierają zgodnie z tymi ustawieniami.',
  toolGroup: 'Narzędzie do pobierania',
  cookiesLead: 'Pobieranie korzysta z logowania w przeglądarce, więc można pobrać także filmy wymagające zalogowania. Domyślnie używane są wszystkie wykryte przeglądarki.',
  autoUpdate: "Aktualizuj yt-dlp automatycznie",
  autoUpdateDesc:
    "Raz dziennie sprawdza, czy jest nowa stabilna wersja. Jeśli jest, kopia pobrana przez BaoCut zostaje podmieniona po sprawdzeniu sumy kontrolnej; do tego czasu możesz pobierać z obecną kopią. yt-dlp zainstalowany samodzielnie nie jest zmieniany.",
  autoUpdateChecked: (when: string, version: string) => `Ostatnie sprawdzenie: ${when} · najnowsza wersja ${version}`,
};
