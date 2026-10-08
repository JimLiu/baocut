import { pluralForm } from '@baocut/protocol';
import type { ThreadMessages } from './thread-copy.ts';

export const pl: ThreadMessages = {
  videoTools: {
    videos_list: "Wyświetl wideo",
    videos_create: "Nowe wideo",
    videos_inspect: "Odczytaj wideo",
    edits_apply: "Edytuj wideo",
    edits_undo: "Cofnij zmiany",
  },
  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: "Uruchom polecenie", read: "Odczytaj plik", edit: "Edytuj plik", search: "Szukaj", other: "Inne narzędzie" },
  phrase: {
    command: "uruchomiono polecenia",
    read: (count: number) => pluralForm('pl', count, { one: `odczytano ${count} plik`, few: `odczytano ${count} pliki`, many: `odczytano ${count} plików`, other: `odczytano ${count} pliku` }),
    edit: (count: number) => pluralForm('pl', count, { one: `zmieniono ${count} plik`, few: `zmieniono ${count} pliki`, many: `zmieniono ${count} plików`, other: `zmieniono ${count} pliku` }),
    search: "wyszukano",
    video: (count: number) => pluralForm('pl', count, { one: `zapisano ${count} zmianę wideo`, few: `zapisano ${count} zmiany wideo`, many: `zapisano ${count} zmian wideo`, other: `zapisano ${count} zmiany wideo` }),
    tool: "wywołano narzędzia",
  },
  summary: (phrases: readonly string[]) => {
    const text = phrases.join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
  thinking: "Rozumowanie",
  stepsFallback: "Kroki",
};
