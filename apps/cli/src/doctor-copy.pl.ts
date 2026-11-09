import type { DoctorMessages } from './doctor-copy.ts';

export const pl: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'Dlaczego BaoCut się nie uruchamia lub nie może czegoś odczytać: które baocut znajdują terminale, który',
    'Runtime uruchomiłby CLI i z jakim katalogiem, czy magazyn poświadczeń odpowiada oraz pełny dostęp do dysku w',
    'macOS. Każde sprawdzenie daje ok, warn, fail lub skip, z poleceniem naprawy, jeśli istnieje; next to naprawa',
    'pierwszego problemu. Tylko odczyt: nigdy nie uruchamia Runtime i nie odczytuje kluczy (sprawdzenie pęku',
    'kluczy pyta tylko, czy istnieje zmyślony klucz). Zapytaj użytkownika przed uruchomieniem napraw.',
    'Przy uruchomieniu z repozytorium wykonuje też autotest Runtime, który raz uruchamia każdy natywny program i porównuje kompilacje z kodem źródłowym.',
    '',
    'Flagi: --json',
  ].join('\n'),
  checkName: {
    entry: 'Wiersz poleceń',
    runtime: 'Runtime',
    credentials: 'Poświadczenia',
    fullDiskAccess: 'Pełny dostęp do dysku',
    build: 'Kompilacja',
  },
  remedyLabel: 'naprawa',

  entryApp: (found, version) => `Terminale uruchamiają ${found}, wiersz poleceń aplikacji BaoCut${version ? ` ${version}` : ''}`,
  entryOtherApp: (found, target, app) =>
    `Terminale uruchamiają ${found} (${target}), a nie wiersz poleceń aplikacji BaoCut w ${app}`,
  entryNoApp: (found, target) => `Terminale uruchamiają ${found} (${target}); nie znaleziono aplikacji BaoCut`,
  entryMissing: 'Terminale nie znajdują baocut. Zainstaluj go z aplikacji BaoCut (bez uprawnień administratora).',
  entryMissingNoApp: 'Terminale nie znajdują baocut, a w typowych miejscach nie ma aplikacji BaoCut',

  runtimeRunning: (version, pid, by) =>
    `Działa: wersja ${version}, proces ${pid}, uruchomiony ${by === 'cli' ? 'z wiersza poleceń' : 'przez aplikację BaoCut'}`,
  runtimeStopped: (entry) => `Nie działa. Następne polecenie uruchomi go w tle za pomocą ${entry}`,
  runtimeUnreachable: (pid, reason) => `Runtime działa (proces ${pid}), ale nie odpowiada: ${reason}`,
  runtimeNoLaunch:
    'Nie działa i nie ma czego uruchomić: zainstaluj aplikację BaoCut, uruchom z repozytorium lub ustaw punkt wejścia Runtime przez BAOCUT_RUNTIME_ENTRY.',

  credentialsFile: (file) => `Ta wersja trzyma klucze w pliku: ${file}`,
  credentialsKeychain: (platform) =>
    platform === 'win32' ? 'Menedżer poświadczeń Windows odpowiada' : 'Pęk kluczy macOS odpowiada',
  credentialsDenied:
    'Pęk kluczy odmówił dostępu. Przez SSH lub bez zalogowania na pulpicie macOS może pozostawić go zablokowanym: uruchom baocut w terminalu na pulpicie albo odblokuj pęk kluczy logowania.',
  credentialsNoHelper: (file) =>
    `Brakuje pomocnika poświadczeń${file ? ` (${file})` : ''}, więc nie można odczytać kluczy. Zainstaluj ponownie aplikację BaoCut.`,
  credentialsUnavailable: (reason) => `Nie udało się połączyć z magazynem poświadczeń: ${reason}`,
  credentialsUnknown: 'O miejscu przechowywania kluczy decyduje BAOCUT_RUNTIME_ENTRY; nie sprawdzono',
  credentialsTimedOut: (seconds) => `pomocnik nie odpowiedział w ciągu ${seconds} s`,

  fdaGranted: 'Pełny dostęp do dysku jest włączony',
  fdaMissingApp:
    'Pełny dostęp do dysku jest wyłączony dla BaoCut.app, więc pliki w chronionych miejscach (Biurko, Dokumenty, Pobrane, inne dyski) mogą być nieczytelne. Włącz BaoCut w Ustawienia systemowe › Prywatność i ochrona › Pełny dostęp do dysku, a potem ponownie uruchom baocut doctor.',
  fdaMissingCli: (app) =>
    `Pełny dostęp do dysku jest wyłączony dla Runtime uruchomionego z wiersza poleceń; macOS bierze pod uwagę uprawnienia tej aplikacji: ${app ?? 'aplikacja, która uruchomiła polecenie (twój terminal lub aplikacja, w której działa agent)'}. Włącz tę aplikację w Ustawienia systemowe › Prywatność i ochrona › Pełny dostęp do dysku i otwórz ją ponownie albo zatrzymaj ten Runtime (baocut runtime stop) i otwórz aplikację BaoCut; potem ponownie uruchom baocut doctor.`,
  fdaNotRunning: 'Sprawdzane tylko, gdy działa Runtime',
  buildOk: (count) => `Natywne programy się uruchamiają, a kompilacje (${count}) zgadzają się z kodem źródłowym`,
  buildNotSource: 'Sprawdzane, gdy Runtime działa z repozytorium',
  buildFailed: (reason) => `Autotest Runtime nie dobiegł końca: ${reason}`,
  buildTimedOut: (seconds) => `brak odpowiedzi w ciągu ${seconds} s`,
  buildProblems: (count, first) =>
    count === 1 ? `Autotest Runtime znalazł problem: ${first}` : `Autotest Runtime znalazł problemy (${count}), pierwszy: ${first}`,
  buildMore: (first, more) => `${first} (i jeszcze ${more})`,
};
