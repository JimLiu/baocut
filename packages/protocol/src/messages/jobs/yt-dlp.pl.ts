import type { JobsYtDlpMessages } from './yt-dlp.ts';

export const pl: JobsYtDlpMessages = {
  toolNotFound: (p: { code: string }) => `Nie można znaleźć wykonywalnego yt-dlp (${p.code})`,
  remedyUnsupported: "Narzędzie pobierania nie obsługuje tego linku: użyj linku do strony samego wideo (nie listy odtwarzania, transmisji ani strony wyszukiwania)",
  remedyLoginRequired: "Zaloguj się na stronie w przeglądarce, wybierz ją w „Logowanie do witryny” i pobierz ponownie",
  remedyCookiesUnavailable: "Nie można odczytać cookie: upewnij się, że jesteś zalogowany; jeśli baza jest używana, zamknij przeglądarkę całkowicie (także procesy w tle); jeśli odmówiono dostępu do Pęku kluczy, zezwól; Safari wymaga Pełnego dostępu do dysku; w Windows yt-dlp nie odczyta cookie Chrome, Edge ani Brave chronionych app-bound encryption, użyj Firefox; lub spróbuj innej przeglądarki",
  remedyToolUpdateRequired: "Nie można przeanalizować strony lub narzędzie jest nieaktualne: zaktualizuj yt-dlp, wykryj ponownie i spróbuj jeszcze raz",
  remedyUnavailable: "Wideo niedostępne (usunięte, ograniczone regionalnie lub brak formatu do pobrania)",
  remedyNetworkError: "Brak połączenia lub pobieranie przerwano: sprawdź sieć i spróbuj ponownie (pobrane części są wznawiane)",
  remedyDiskFull: "Za mało miejsca dla folderu pobierania lub Runtime Home: zwolnij miejsce i spróbuj ponownie",
  remedyDownloadFailed: "Narzędzie pobierania zgłosiło błąd: zobacz details.stderr; być może trzeba zaktualizować yt-dlp (baocut external-tools detect)",
  exited: (p: { code: number | null }) => `yt-dlp zakończył działanie z kodem ${p.code}`,
  cookieLoginRequired: (p: { browser: string }) => `${p.browser}: strona nadal wymaga logowania`,
  cookieUnreadable: (p: { browser: string }) => `${p.browser}: nie można odczytać cookie`,
  reasonSeparator: "; ",
  cookieAttemptsFailed: (p: { count: number; reasons: string }) => `Wypróbowano cookie z ${p.count} przeglądarek, żadne nie zadziałały (${p.reasons})`,
  metadataUnreadable: "Nie można odczytać metadanych narzędzia pobierania",
  metadataNotObject: "Metadane narzędzia pobierania nie są obiektem",
  playlist: "Link to lista odtwarzania; importuj jedno wideo naraz",
  live: "Nie można importować transmisji na żywo",
};
