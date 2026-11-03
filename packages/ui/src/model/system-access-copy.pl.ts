import type { SystemAccessMessages } from './system-access-copy.ts';

export const pl: SystemAccessMessages = {
  cardTitle: (names) => `Zezwól BaoCut na odczyt ciasteczek ${names}`,
  cardBody: "macOS wymaga najpierw nadania BaoCut „Pełnego dostępu do dysku”. Kliknij „Otwórz Ustawienia systemowe”, a BaoCut przeniesie Cię bezpośrednio na tę stronę. BaoCut czyta tylko zaznaczone przeglądarki, nic więcej.",
  openedTitle: "Włącz BaoCut w Ustawieniach systemowych i wróć tutaj",
  openedBody: "Włącz przełącznik obok BaoCut. Gdy macOS zapyta, czy zakończyć i ponownie otworzyć BaoCut, wybierz „Zakończ i otwórz ponownie”. Jeśli BaoCut nie ma na liście, kliknij „+” pod listą, aby go dodać. Jeśli macOS nie proponuje ponownego otwarcia, kliknij poniżej „Uruchom BaoCut ponownie”.",
  open: "Otwórz Ustawienia systemowe",
  openAgain: "Otwórz Ustawienia systemowe ponownie",
  restart: "Uruchom BaoCut ponownie",
  askTitle: (names) => `Najpierw zezwolić na dostęp do ciasteczek ${names}?`,
  askBody: (names) => `To pobieranie używa Twojego logowania w ${names}, a macOS wymaga najpierw nadania BaoCut „Pełnego dostępu do dysku”. Włącz go w Ustawieniach systemowych i pobierz ponownie albo pomiń tym razem i kontynuuj z innymi przeglądarkami.`,
  skip: "Pomiń tym razem",
  settingLabel: "Pełny dostęp do dysku",
  settingAllowed: "Dozwolone. BaoCut może czytać pliki na dyskach zewnętrznych, pulpicie, w Dokumentach i Pobranych oraz ciasteczka Safari, ale tylko wybrane przez Ciebie multimedia, miejsca zapisu i przeglądarki.",
  settingMissing: "Niedozwolone. macOS nie pozwala aplikacjom czytać dysków zewnętrznych, pulpitu, Dokumentów, Pobranych ani ciasteczek Safari. Po zezwoleniu BaoCut nie będzie zawodzić w tych miejscach z powodu uprawnień. Czyta tylko wybrane przez Ciebie multimedia, miejsca zapisu i przeglądarki.",
  openFailed: "Nie udało się otworzyć Ustawień systemowych. Otwórz samodzielnie: Ustawienia systemowe › Prywatność i ochrona › Pełny dostęp do dysku.",
};
