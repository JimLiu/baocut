import type { RcFontsMessages } from './rc-fonts.ts';

export const pl: RcFontsMessages = {
  manageOnlyInAppOrCli: "Czcionki można pobierać, usuwać i sprawdzać tylko w aplikacji komputerowej lub CLI",
  catalogueInvalid: "Nieprawidłowy format katalogu czcionek",

  remedyNetwork: "Sieć niedostępna lub pobieranie przerwano. Sprawdź sieć i pobierz ponownie lub zmień serwery lustrzane w „URL arkusza stylów” i „URL plików czcionek” w Ustawienia › Czcionki",
  remedySource: "Usługa czcionek nie dostarczyła pliku. Sprawdź nazwę rodziny i grubość lub adresy serwerów lustrzanych w ustawieniach",
  remedyIntegrity: "Pobrany plik nie jest poprawną czcionką (błędna rodzina, nieczytelny lub zbyt duży). Plik usunięto; zmień serwer lustrzany i pobierz ponownie",
  remedyNoSpace: "Na dysku z Runtime Home zabrakło miejsca. Zwolnij miejsce i pobierz ponownie",

  diskFullWriting: (p) => `Podczas zapisu zabrakło miejsca na dysku: ${p.what}`,
  sourceHttpStatus: (p) => `Usługa czcionek zwróciła HTTP ${p.status} dla ${p.what}`,
  downloadFailed: (p) => `Pobieranie ${p.what} – niepowodzenie: ${p.reason}`,
  overByteLimit: (p) => `${p.what} przekracza limit ${p.limit} bajtów`,

  downloadCancelled: "Pobieranie czcionki anulowano",
  cancelled: "Pobieranie anulowano",
  offlineStrict: "Czcionki nie są pobierane w ścisłym trybie offline",
  autoDownloadOff: "Automatyczne pobieranie czcionek wyłączone („Pobieraj czcionki automatycznie” w Ustawienia › Czcionki)",
  downloadFailedOutcome: (p) => `Pobieranie nie powiodło się: ${p.reason}`,
  notInCatalogue: (p) => `„${p.family}” nie ma w katalogu czcionek`,
  noNeedToDownload: (p) => `"${p.family}" ${p.bundled ? "jest dołączony do aplikacji" : "jest już zainstalowany na tym komputerze"}, więc nie trzeba pobierać`,
  inUseByExport: (p) => `„${p.family}” jest używany przez nieukończony eksport. Usuń po ukończeniu`,

  sampleLabel: (p) => `${p.family} – próbka`,
  sampleCss: (p) => `arkusz stylów dla ${p.label}`,
  noSampleBlock: (p) => `Odpowiedź usługi czcionek nie zawiera ${p.label}`,
  sampleNotOnHost: (p) => `${p.label} nie jest na skonfigurowanym hoście plików czcionek`,
  sampleNotUsable: (p) => `Pobrany ${p.label} nie jest poprawną czcionką`,

  faceLabel: (p) => `${p.family} ${p.weight}${p.italic ? " Kursywa" : ""}`,
  faceCss: (p) => `arkusz stylów czcionki ${p.label}`,
  noFaceBlock: (p) => `Odpowiedź usługi czcionek nie zawiera ${p.label}`,
  faceSplit: (p) => `Usługa czcionek podzieliła ${p.label} na podzbiory znaków, których BaoCut nie łączy jeszcze`,
  faceNotOnHost: (p) => `Plik dla ${p.label} nie jest na skonfigurowanym hoście plików czcionek`,
  faceNotUsable: (p) => `Pobrany ${p.label} nie jest poprawną czcionką`,
  familyMismatch: (p) => `Nazwa rodziny pobranego ${p.label} nie odpowiada`,
};
