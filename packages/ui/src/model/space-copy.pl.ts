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
  sort: { recent: "Ostatnia aktywność", name: "Nazwa", kind: "Typ" },
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
};
