import type { DataGrantsMessages } from './data-grants-copy.ts';

export const pl: DataGrantsMessages = {
  title: "Uprawnienia do udostępniania danych",
  showEnded: (count: number) => `Pokaż zakończone (${count})`,
  lead: "Wysyłanie danych dostawcom w chmurze wymaga uprawnienia: jest przyznawane domyślnie po włączeniu dostawcy oraz po wybraniu „Zawsze zezwalaj” podczas zatwierdzania. Po jego cofnięciu nowe wywołania nie wysyłają danych; wysłanych już danych i naliczonych opłat nie można cofnąć. Modele lokalne nie wymagają uprawnień.",
  loading: "Wczytywanie uprawnień…",
  disconnected: "Brak połączenia z Runtime",
  revoke: "Odwołaj",
  noActive: "Brak aktywnych uprawnień",
  none: "Nie ma jeszcze uprawnień",
  emptyDesc: "Uprawnienia pojawią się tutaj po włączeniu dostawcy w chmurze lub wybraniu „Zawsze zezwalaj” podczas zatwierdzania.",
  revokeTitle: (name: string) => `Cofnąć uprawnienie „${name}”?`,
  revokeFailed: (message: string) => `Nie udało się cofnąć: ${message}`,
  cancel: "Anuluj",
};
