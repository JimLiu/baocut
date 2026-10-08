import { pluralForm } from '@baocut/protocol';
import { intlLocale } from '@baocut/protocol';
import type { FontSettingsMessages } from './font-settings-copy.ts';

export const pl: FontSettingsMessages = {
  lead: (total: number | null) => `Czcionki pochodzą z trzech źródeł: dołączone do aplikacji, zainstalowane na tym komputerze i katalog Google Fonts (liczba rodzin: ${total === null ? 'około dwóch tysięcy' : `około ${total.toLocaleString(intlLocale())}`}, licencje otwarte, pobierane na żądanie). Pobieranie wysyła tylko nazwę rodziny i grubość, bez konta; czcionki są zapisywane w danych aplikacji, poza folderem wideo.`,
  download: "Pobierz",
  autoDownload: "Pobieraj czcionki automatycznie",
  autoDownloadDesc:
    "Pobiera z Google Fonts, gdy podgląd, otwieranie wideo lub eksport wymagają czcionki nieobecnej na komputerze. Po wyłączeniu najpierw używane są czcionki zastępcze do wyświetlania i eksportu; nadal można pobierać ręcznie przy wyborze czcionki. W ścisłym trybie offline nic nie jest pobierane.",
  cssEndpoint: "URL arkusza stylów",
  cssEndpointDesc: "Bazowy URL serwera lustrzanego. Pozostaw puste dla https://fonts.googleapis.com.",
  fileEndpoint: "URL plików czcionek",
  fileEndpointDesc: "Pliki czcionek są pobierane tylko spod tego URL. Pozostaw puste dla https://fonts.gstatic.com.",
  downloaded: "Pobrane czcionki",
  summary: (families: number, size: string) => `${pluralForm('pl', families, { one: `${families} rodzina`, few: `${families} rodziny`, many: `${families} rodzin`, other: `${families} rodziny` })} · ${size}`,
  none: "Jeszcze brak",
  clearAll: "Wyczyść wszystko",
  empty: "Tutaj są czcionki pobrane przy wyborze lub automatycznie przy otwieraniu wideo i eksporcie.",
  clearTitle: "Wyczyścić pobrane czcionki?",
  clear: "Wyczyść",
  cancel: "Anuluj",
  removed: (family: string, size: string) => `Usunięto czcionkę „${family}” · Zwolniono ${size}`,
  inUseTip: "Używany przez nieukończony eksport; usuń po ukończeniu",
  removeTip: "Usuń pobrane pliki tej czcionki",
  removeLabel: (tip: string, family: string) => `${tip}: ${family}`,
  facts: (weights: string, size: string, licence: string, ago: string | null) => `Grubości ${weights} · ${size} · ${licence}${ago ? ` · Pobrano ${ago}` : ""}`,
  inUse: "Używana przez eksport",
};
