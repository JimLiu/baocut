import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const pl: ModelsModelDownloaderMessages = {
  remedyNoSpace: "Na dysku z folderem modeli zabrakło miejsca. Zwolnij wystarczająco dużo miejsca (lub przenieś folder modeli na inny dysk w ustawieniach), a następnie zainstaluj ponownie",
  remedyNetwork: "Brak dostępu do sieci lub przerwano pobieranie. Sprawdź sieć i zainstaluj ponownie; pobieranie zostanie wznowione. Możesz też zmienić serwer lustrzany w „Źródło pobierania modeli” w „Ustawienia › Ogólne”",
  remedyIntegrity: "Rozmiar lub sha256 pobranego pliku nie odpowiada manifestowi (źródło lub serwer lustrzany ma błędną zawartość). Nieprawidłowy plik usunięto; zmień źródło pobierania i zainstaluj ponownie",
  remedySource: "Źródło pobierania nie ma tego pliku lub odmówiło dostępu. Sprawdź, czy serwer lustrzany w „Źródło pobierania modeli” w „Ustawienia › Ogólne” (lub zmiennej środowiskowej BAOCUT_MODELS_ENDPOINT) jest kompletny",
  remedyManifestIncomplete: "Wbudowany manifest tego pakietu modelu nie ma zaufanego sha256, więc instalacja jest niemożliwa. Poczekaj na aktualizację BaoCut",
  downloadFailed: (p: { file: string; reason: string }) => `Nie udało się pobrać ${p.file}: ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `Rozmiar lub sha256 pliku ${p.file} nie odpowiada manifestowi`,
  sourceHttp: (p: { file: string; status: number }) => `Źródło pobierania zwróciło HTTP ${p.status} dla ${p.file}`,
  diskFull: "Podczas zapisu plików modelu zabrakło miejsca na dysku",
};
