import type { DriversCommonMessages } from './drivers-common.ts';

export const pl: DriversCommonMessages = {
  executableMissing: (p) => `Wskazane polecenie ${p.command} (${p.path}) nie istnieje lub nie można go uruchomić.`,
  commandMissing: (p) => `Nie udało się znaleźć polecenia ${p.command}. ${p.hint} lub ustaw jego lokalizację w ustawieniach.`,
  commandNotFound: (p) => `Nie udało się znaleźć polecenia ${p.command} – polecenie`,
  installItFirst: "Najpierw zainstaluj",
  versionFailed: (p) => `${p.command} --version nie zakończyło się poprawnie.`,
  outdated: (p) => `${p.name} ${p.version} jest zbyt stary. BaoCut wymaga ${p.min} lub nowszego.`,
  startFailed: (p) => `${p.name} nie udało się uruchomić: ${p.error}`,
  openSessionFailed: (p) => `${p.name} nie udało się otworzyć sesji: ${p.error}`,
  confinedUnsupported: (p) => `${p.name} nie obsługuje ograniczonych jednorazowych wywołań`,
  resumeFailed: (p) => `Nie udało się wznowić natywnej sesji ${p.name}${p.error ? ` (${p.error})` : ""}. Rozpoczęto nową sesję; agent nie widzi wcześniejszej rozmowy.`,
  sessionClosed: (p) => `Element ${p.name} – sesja jest zamknięta`,
  sessionNotReady: (p) => `Element ${p.name} – sesja nie jest jeszcze gotowa`,
  turnInProgress: "Poprzednia tura nie została jeszcze ukończona",
  modelSwitchFailed: (p) => `${p.name} nie udało się przełączyć na model ${p.model}: ${p.error}`,
  timedOut: (p) => `${p.label} – upłynął limit czasu (${p.seconds} s)`,
  unknownError: "Nieznany błąd",
  unknownReason: "nieznana przyczyna",
  imagePlaceholder: "[Obraz]",
  officialScript: "Oficjalny skrypt",
};
