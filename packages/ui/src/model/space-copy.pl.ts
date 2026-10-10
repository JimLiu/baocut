import { pluralForm } from '@baocut/protocol';
import type { SpaceMessages } from './space-copy.ts';

export const pl: SpaceMessages = {
  kind: {
    video: "Wideo",
    export: "Eksportuj",
    'video-file': "Materiał wideo",
    image: "Obraz",
    audio: "Dźwięk",
    subtitle: "Napisy",
    document: "Dokument",
    package: "Pakiet wideo",
    template: "Szablon",
  },
  categoryAll: "Wszystko",
  favorite: "Ulubione",
  trash: "Kosz",
  sort: { created: 'Data utworzenia', updated: 'Data aktualizacji', recent: "Ostatnia aktywność", name: "Nazwa", kind: "Typ" },
  status: {
    generating: "Generowanie",
    candidate: "Propozycja",
    applied: "Zastosowano",
    published: "Opublikowano",
    'source-changed': "Źródło zmienione",
    missing: "Brak",
    failed: "Niepowodzenie",
  },
  statusAny: "Wszystkie stany",
  statusNone: "Brak stanu",
  noProject: "Poza projektem",
  removedProject: "Usunięty projekt",
  conversation: (title: string) => `Sesja „${title}”`,
  kindCount: (kind: string, n: number) => `${kind} ${n}`,
  foundFiles: (name: string, n: number) => (n === 1 ? `Znaleziono: ${name}` : `Znaleziono: ${name} i ${n - 1} więcej`),
  fileStatus: (kind: string, status: string) => `${kind}: ${status}`,
  filesStatus: (n: number, status: string) =>
    `${pluralForm('pl', n, { one: `${n} plik`, few: `${n} pliki`, many: `${n} plików`, other: `${n} pliku` })}: ${status}`,
};
