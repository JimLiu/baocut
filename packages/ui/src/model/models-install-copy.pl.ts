import { pluralForm } from '@baocut/protocol';
const SOURCE = "„Źródło pobierania modeli” w Ustawienia › Ogólne";
const and = (items: readonly string[]) => new Intl.ListFormat('pl', { type: 'conjunction' }).format(items);
const files = (n: number) => pluralForm('pl', n, { one: `${n} plik`, few: `${n} pliki`, many: `${n} plików`, other: `${n} pliku` });
import type { ModelsInstallMessages } from './models-install-copy.ts';

const KEEP = 'Pobrana część zostaje zachowana; kolejne pobieranie zacznie się od miejsca zatrzymania.';

export const pl: ModelsInstallMessages = {
  planSize: (size) => `Pobiera ${size}`,
  planSizeEstimate: (size) => `O wideo ${size} (rozmiary części plików nieznane, użyto zarejestrowanego szacunku)`,
  amountEstimate: (size) => `O wideo ${size}`,
  noSpace: (need, have) => `Za mało miejsca na dysku: wymaga ${need}, a dysk z folderem modeli ma tylko ${have}. Zwolnij miejsce przed pobieraniem.`,
  resumed: (size) => `Element ${size} pobrane poprzednio jest używane ponownie, bez pobierania.`,
  space: (size) => `${size} wolne na dysku`,
  lineKeep: "Już zainstalowane, bez zmian",
  lineSize: (size, count) => `${size} · ${files(count)}`,
  lineUnknown: (count) => `Rozmiar nieznany · ${files(count)}`,
  queued: "W kolejce do pobierania",
  downloading: (amount) => `Pobieranie ${amount}`,
  downloadingUnknown: (amount) => `Pobieranie · ${amount} odebrano`,
  verifying: "Weryfikacja i publikowanie",
  pausedKept: (amount) => `Wstrzymano · ${amount} zachowane; wznowienie od miejsca zatrzymania`,
  paused: "Wstrzymano",
  remedyNoSpace: (need, have) => `${need !== null && have !== null ? `Wymaga ${need}, dostępne tylko ${have}. ` : ""}Zwolnij miejsce na dysku i pobierz ponownie. ${KEEP}`,
  remedyNetwork: `Sprawdź sieć i pobierz ponownie. ${KEEP} Jeśli źródło domyślne niedostępne, zmień serwer lustrzany w ${SOURCE}.`,
  remedyIntegrity: `Pliki źródła pobierania nie odpowiadały rozmiarowi lub sha256 manifestu i zostały usunięte. Zmień źródło pobierania (${SOURCE}), a potem pobierz ponownie.`,
  remedySource: `Źródło pobierania nie ma pliku lub odmówiło dostępu. Sprawdź kompletność serwera lustrzanego w ${SOURCE} (lub zmiennej środowiskowej BAOCUT_MODELS_ENDPOINT).`,
  remedyManifest: "Wbudowany manifest pakietu modelu nie ma zaufanego sha256, instalacja niemożliwa do aktualizacji BaoCut.",
  remedyOffline: "Włączony ścisły tryb offline, nic nie jest pobierane. Aby pobrać, najpierw wyłącz tryb w ustawieniach.",
  remedySizeChanged: "Rozmiar pobierania zmieniony. Potwierdź ponownie nowy plan.",
  remedyInUse: "Zadanie używa pakietu modelu (transkrypcja, synteza, kontrola lub instalacja). Poczekaj na ukończenie lub anuluj w „Zadania w tle”, a potem usuń ponownie.",
  remedyUnavailable: "Pakiet modelu jest teraz niedostępny (niepełna instalacja, wyłączony lub nieobsługiwany na komputerze). Najpierw napraw lub włącz.",
  remedyInstallFailed: `Spróbuj pobrać ponownie. ${KEEP}`,
  problemText: (message, remedy) => (/[.!?。！？]$/.test(message) ? `${message} ${remedy}` : `${message}. ${remedy}`),
  removalBody: (unknown, frees, kept) => [
      unknown ? "Usuwa pliki używane tylko przez ten pakiet modelu." : frees !== null ? `Zwalnia około ${frees}.` : null,
      ...kept.map((k) => `${k.repo} zostaje zachowane, ponieważ ${and(k.usedBy)} nadal ${k.usedBy.length === 1 ? "używa" : "używają"} go.`),
      "Aby użyć ponownie, trzeba pobrać ponownie.",
    ]
      .filter(Boolean)
      .join(" "),
  removed: (bundleId) => `Usunięto: ${bundleId}`,
  removedKept: (bundleId, repos) => `Usunięto: ${bundleId} · ${and(repos)} zachowano, bo inne pakiety modeli nadal używają ${repos.length === 1 ? "go" : "ich"}`,
};
