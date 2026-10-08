import { pluralForm } from '@baocut/protocol';
import type { StageMediaMessages } from './stage-media-copy.ts';

export const pl: StageMediaMessages = {
  titles: {
    missing: "Nie znaleziono pliku źródłowego",
    changed: "Plik źródłowy zmieniony",
    'outside-project': "Plik źródłowy jest poza folderem projektu",
    unplayable: "Nie można odtworzyć pliku źródłowego",
  },
  causes: {
    missing: "Plik mógł zostać przeniesiony, przemianowany lub usunięty albo być na odłączonym dysku.",
    changed: "Plik w tej lokalizacji nie jest już tym zaimportowanym (rozmiar nie odpowiada). Mógł zostać nadpisany lub ponownie wyeksportowany.",
    'outside-project': "Zapisana lokalizacja jest poza folderem projektu zawierającym to wideo i BaoCut nie odczytuje tam plików.",
  },
  unplayable: (error: string) => `Odtwarzacz nie może otworzyć tego pliku: ${error}.`,
  tail: { video: "Napisy nadal się odtwarzają; brakuje tylko obrazu i oryginalnego dźwięku.", audio: "Napisy nadal się odtwarzają; nie słychać tylko tego audio." },
  body: (cause: string, tail: string) => `${cause} ${tail}`,
  volume: (volume: string) => `Plik jest na dysku „${volume}”. Podłącz ten dysk, aby przywrócić automatycznie.`,
  more: (count: number) => pluralForm('pl', count, { one: `Jeszcze ${count} materiał wideo lub audio nie może być odtworzony.`, few: `Jeszcze ${count} materiały wideo lub audio nie mogą być odtworzone.`, many: `Jeszcze ${count} materiałów wideo lub audio nie może być odtworzonych.`, other: `Jeszcze ${count} materiału wideo lub audio nie może być odtworzone.` }),
  relinkHint: "Wybierz plik oryginalny, aby przywrócić. BaoCut sprawdza zawartość; nie można ponownie powiązać pliku z inną zawartością.",
  desktopOnly: "Aby przywrócić, otwórz wideo w aplikacji komputerowej BaoCut i użyj „Powiąż ponownie…” na płótnie, aby wybrać plik oryginalny.",
  managed: "Ten plik był w folderze wideo, więc nie można powiązać go z inną lokalizacją.",
  oldRevision: "Oś czasu używa starszej wersji materiału; ponownie powiązać można tylko obecną.",
  relink: "Połącz ponownie…",
  relinking: "Sprawdzanie…",
  pickTitle: (name: string) => `Znajdź „${name}”`,
  pickButton: "Połącz ponownie",
  label: (name: string) => `Powiąż ponownie „${name}”`,
  relinkFailed: (message: string) => `Nie udało się powiązać ponownie: ${message}`,
  decodeFailed: "Dekodowanie nie powiodło się",
  unsupported: "Format nieobsługiwany",
};
