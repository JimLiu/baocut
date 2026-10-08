import { pluralForm } from '@baocut/protocol';
const forms = {"files": ["plik", "pliki", "plików", "pliku"], "models": ["model", "modele", "modeli", "modelu"], "images": ["obraz", "obrazy", "obrazów", "obrazu"], "calls": ["wywołanie", "wywołania", "wywołań", "wywołania"], "callsGen": ["wywołania", "wywołań", "wywołań", "wywołania"], "voices": ["głos", "głosy", "głosów", "głosu"], "sizes": ["rozmiar", "rozmiary", "rozmiarów", "rozmiaru"]} as const;
const amount = (n: number, kind: keyof typeof forms) => { const f = forms[kind]; return pluralForm('pl', n, { one: `${n} ${f[0]}`, few: `${n} ${f[1]}`, many: `${n} ${f[2]}`, other: `${n} ${f[3]}` }); };
import { MODEL_SERVICE_CAPABILITIES, USAGE_PERIODS } from '@baocut/protocol';
import type { ModelsMessages } from './models-copy.ts';

export const pl: ModelsMessages = {
  help: `Użycie:
  baocut models cancel <bundleId> [--discard]
                                   Zatrzymaj instalację (pobrane dane zostają; ponów install, aby wznowić);
                                   --discard także usuwa pobrane dane
  baocut models repair <bundleId> [--yes]
                                   Sprawdź sha256 każdego pliku i pobierz ponownie tylko brakujące lub uszkodzone
                                   (potwierdzenie jak dla install)
  baocut models dir                Folder lokalnych modeli: lokalizacja, źródło, zajęte i wolne miejsce, liczba rozpoznanych modeli
  baocut models dir --set <path> [--move|--switch]
                                   Zmień folder modeli: --move przenosi istniejące modele (zadanie w tle, wycofywane
                                   przy błędzie); --switch zmienia tylko lokalizację (stare pliki zostają; dostępne są tylko modele
                                   w nowym folderze). Jeśli bieżący folder zawiera modele, wymagana jest jedna z tych opcji.
                                   Niedozwolone, gdy zadanie używa lokalnego modelu; tylko odczyt, jeśli folder ustawia
                                   zmienna środowiskowa BAOCUT_MODELS_DIR
  baocut models dir --reset [--move|--switch]
                                   Przywróć domyślną lokalizację (<BAOCUT_HOME>/models), reguły jak dla --set
  baocut models configure <providerId> [options]
                                   Skonfiguruj dostawcę online: z katalogu (openai, google, elevenlabs, anthropic, deepseek,
                                   qwen i inni; zobacz baocut models capabilities) lub własny endpoint zgodny z OpenAI custom:<name>.
                                   Dostawca agent:codex ma tylko przełącznik (używa logowania Codex na tym komputerze, bez klucza)
    --enable | --disable           Włącz (stałe uprawnienia pozwalają wysyłać audio materiałów, tekst lub prompty) lub wyłącz
    --key-stdin                    Odczytaj klucz API z stdin (klucze w argumentach nie są przyjmowane): zastępuje klucz
                                   pierwszego konta lub tworzy konto, jeśli go nie ma (dla wielu kont użyj
                                   baocut models accounts)
    --endpoint <url>               Base URL własnego endpointu (wymagany za pierwszym razem); dostawca katalogowy może używać
                                   proxy lub bramy
    --model <id> ...               Modele transkrypcji własnego endpointu (powtarzalne; pierwszy jest domyślny)
    --speech-model <id> ...        Modele syntezy mowy własnego endpointu (/audio/speech; powtarzalne)
    --image-model <id> ...         Modele obrazów własnego endpointu (/images/generations; powtarzalne)
    --text-model <id> ...          Modele tekstowe własnego endpointu (/chat/completions; powtarzalne)
                                   Podanie modeli dowolnego typu zastępuje wszystkie zadeklarowane modele
    --verify                       Przed zapisaniem raz sprawdź nowy klucz i endpoint u dostawcy
  baocut models accounts <providerId>
                                   Lista kont: kolejność, nazwa, zamaskowany klucz, przełącznik i stan (wywołania używają
                                   pierwszego włączonego konta z kluczem; błędy nie przełączają na kolejne)
  baocut models accounts add <providerId> [--label <name>] [--region <region>] [--endpoint <url>] [--verify]
                                   Dodaj konto; klucz z stdin; --region przyjmuje region z katalogu (np.
                                   global lub cn); --verify najpierw sprawdza u dostawcy i nie zapisuje przy błędzie.
                                   Dodanie konta nie włącza dostawcy
  baocut models accounts remove <providerId> <accountId|name>
                                   Usuń konto i jego klucz (po usunięciu ostatniego konta dostawca zostaje,
                                   ale bez użytecznego klucza)
  baocut models accounts use <providerId> <accountId|name>
                                   Ustaw jako preferowane: przenieś to konto na początek
  baocut models usage [--period <${USAGE_PERIODS.join("|")}>] [--provider <id>]
                                   Wywołania, użycie i wydatki dostawców online i agentów (domyślnie ostatnie 30 dni):
                                   szacunki według cennika, kwoty zgłoszone przez dostawcę i nieznane koszty
                                   są osobne, bez przeliczania walut; według dostawcy, funkcji, modelu
                                   i konta
  baocut models default <capability> <providerId|none> [modelId]
                                   Ustaw lub usuń domyślnego dostawcę i model dla funkcji (${MODEL_SERVICE_CAPABILITIES.join(", ")})
  baocut models remove <bundleId|providerId>
                                   Usuń lokalny pakiet modeli (wspólne składniki innych pakietów zostają; odmowa,
                                   gdy zadanie go używa); lub usuń dostawcę online: własny endpoint custom:<name>
                                   w całości; dostawca katalogowy zostaje wyłączony, a wszystkie konta i klucze usunięte
  baocut models refresh <providerId>
                                   Pobierz i buforuj listę modeli i głosów dostawcy online: modele wbudowane,
                                   których nie ma na liście, stają się niedostępne; gdy pobranie się nie uda,
                                   nadal używana jest lista wbudowana
  baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]
                                   Pokaż lub ustaw domyślny poziom rozumowania i limit równoczesnych żądań
                                   każdego dostawcy (domyślnie 4); default przywraca wartości fabryczne`,
  byteProgressUnknown: (done) => `${done} odebrano (łączny rozmiar nieznany)`,
  byteProgress: (done, total, percent) => `${done} / ${total} (${percent}%)`,
  bundleStates: {
    'not-installed': "Nie zainstalowano",
    downloading: "Pobieranie",
    installed: "Zainstalowany",
    loading: "Wczytywanie",
    ready: "Gotowe",
    busy: "Zajęty",
    unloading: "Zwalnianie",
    error: "Niedostępne",
  },
  installStates: {
    queued: "W kolejce",
    downloading: "Pobieranie",
    verifying: "Weryfikacja i publikowanie",
    paused: "Wstrzymano",
  },
  bundleState: (label, state, reason) => `${label} (${state}${reason ? ` / ${reason}` : ""})`,
  componentInstalled: "zainstalowane",
  componentMissing: "brak",
  sharedWith: (bundles) => `  współdzielone z ${bundles.join(", ")}`,
  installTask: (jobId) => `  zadanie ${jobId}`,
  resumeHint: (bundleId) => `; wznów przez baocut models install ${bundleId}`,
  installLine: (state, progress, task, hint) => `  Instalacja: ${state}  ${progress}${task}${hint}`,
  checkPassed: "zaliczono",
  checkFailed: (code) => `niepowodzenie${code ? ` (${code})` : ""}`,
  checkLine: (result, at, detail) => `  Kontrola: ${result}  ${at}${detail ? `  ${detail}` : ""}`,
  remedyAppFileMissing: "Rozwiązanie: zainstaluj ponownie BaoCut; naprawa modelu nie pomoże",
  remedyRepair: (bundleId) => `Rozwiązanie: baocut models repair ${bundleId} ponownie pobiera tylko uszkodzone pliki; potem sprawdź ponownie`,
  remedyMaybeRepair: (bundleId) => `Rozwiązanie: najpierw spróbuj baocut models repair ${bundleId} (pobiera ponownie tylko uszkodzone pliki), potem sprawdź ponownie`,
  remedyOutOfMemory: "Rozwiązanie: zamknij aplikacje zużywające dużo pamięci lub wybierz mniejszy model, potem sprawdź ponownie",
  remedy: (text) => `Jak naprawić: ${text}`,
  upToDate: (repair, bundleId) => repair ? `${bundleId} plików jest poprawnych; nie ma czego naprawiać` : `${bundleId} już zainstalowano; nie ma czego pobierać`,
  planHeader: (repair, bundleId, source) => `${repair ? "Napraw" : "Zainstaluj"} ${bundleId} z ${source}`,
  planKeep: (component, repo) => `  ${component}  ${repo}  zainstalowano, zachowano`,
  planDownload: (component, repo, files, size) => `  ${component}  ${repo}  pobierz ${amount(files, "files")}, ${size}`,
  sizeUnknown: "rozmiar nieznany",
  toDownloadEstimate: (estimate) => `Do pobrania: rozmiar nieznany, około ${estimate}`,
  toDownload: (size) => `Do pobrania: ${size}`,
  resumed: (size) => `Wznowienie: ${size} jest już w katalogu tymczasowym i nie zostanie pobrane ponownie`,
  freeSpace: (size, short) => `Wolne miejsce: ${size}${short ? " (za mało)" : ""}`,
  sizeAbout: (size) => `około ${size}`,
  installPrompt: (repair, size) => `${repair ? "Napraw" : "Zainstaluj"} i pobierz ${size}? [y/N] `,
  noSpace: (need, have) => `Miejsce na dysku: wymaga ${need}, tylko ${have}`,
  removed: (files) => `Usunięto: ${files.join(", ")}`,
  nothingRemoved: "Nie usunięto plików",
  keptInUse: (repo, users) => `Zachowano: ${repo}: nadal używane przez ${users.join(", ")}`,
  keptOtherVersion: (repo) => `Zachowano: ${repo}: folder zawiera inną wersję, która nie należy do tego pakietu modeli`,
  dirSources: {
    default: "lokalizacja domyślna",
    setting: "folder wybrany w Ustawieniach",
    env: "zmienna środowiskowa BAOCUT_MODELS_DIR (tylko odczyt: zmień zmienną i uruchom BaoCut ponownie)",
  },
  dirSource: (label) => `  Źródło: ${label}`,
  dirMissing: "  Folder nie istnieje (może też być odłączony dysk zewnętrzny)",
  dirNotWritable: "  BaoCut nie może zapisywać w tym folderze",
  dirUsage: (used, free, models) => `  Zajęto ${used}${free ? ` · wolne na dysku ${free}` : ""} · znaleziono ${amount(models, "models")}`,
  dirDefault: (path) => `  Lokalizacja domyślna: ${path}`,
  dirMoving: (to, jobId) => `  Przenoszenie${to ? ` do ${to}` : ""} (zadanie ${jobId})`,
  dirEnvLocked: "Folder modeli ustawia zmienna BAOCUT_MODELS_DIR: zmień ją i uruchom BaoCut ponownie",
  dirProblemMissing: "Folder nie istnieje: dysk zewnętrzny może być odłączony; podłącz go i spróbuj ponownie",
  dirProblemNotWritable: "BaoCut nie może zapisywać w tym folderze: wybierz zapisywalną lokalizację lub zmień jej uprawnienia",
  dirProblemNested: "Nowa lokalizacja i bieżący folder modeli zawierają się wzajemnie: wybierz folder, który nie jest wewnątrz bieżącego ani go nie zawiera",
  dirProblemSame: "To już bieżący folder modeli",
  dirFound: (count, size) => `Znaleziono ${amount(count, "models")} (${size}), gotowe do użycia`,
  dirEmpty: "W tym folderze nie ma jeszcze modeli; nowe pobrania trafią tutaj",
  dirFree: (size) => `${size} wolnego na tym dysku`,
  moveSameVolume: "Ten sam dysk: przeniesienie tylko zmienia nazwy, bez dodatkowego miejsca",
  moveSize: (size, fits) => `przenoszenie ${size}${fits ? "" : ", co się nie zmieści"}`,
  dirCurrentHas: (size, move) => `Bieżący folder zawiera ${size} modeli: ${move}`,
  moveOrSwitch: "Użyj tylko jednej opcji: --move lub --switch",
  accountStates: {
    unknown: "Nie zweryfikowano",
    ok: "OK",
    'invalid-key': "Nieprawidłowy klucz",
    'rate-limited': "Limit częstotliwości",
    'quota-exhausted': "Wyczerpano limit",
  },
  rateLimitedUntil: (label, until) => `${label} (do ${until})`,
  noAccounts: "Brak kont: baocut models accounts add <providerId> odczytuje klucz ze standardowego wejścia",
  accountEnabled: "włączone",
  accountDisabled: "wyłączone",
  accountKeyUnreadable: "nie można odczytać klucza",
  accountRegion: (region) => `region ${region}`,
  accountEndpoint: (endpoint) => `endpoint ${endpoint}`,
  accountLastUsed: (at) => `ostatnio użyto: ${at}`,
  accountCurrent: "w użyciu",
  accountChoice: (accountId, label) => `${accountId} (${label})`,
  noAccountChoices: "brak kont",
  listSep: ", ",
  accountAmbiguous: (count, ref, choices) => `${count} kont ma nazwę „${ref}”; użyj accountId: ${choices}`,
  accountNotFound: (ref, choices) => `Brak takiego konta: ${ref} (opcje: ${choices})`,
  usagePeriods: { today: "Dzisiaj", '7d': "Ostatnie 7 dni", '30d': "Ostatnie 30 dni", all: "Cały okres" },
  unitTokens: (input, output) => `wejście ${input} / wyjście ${output} tokenów`,
  unitCached: (cached) => `${cached} w pamięci podręcznej`,
  unitAudio: (minutes) => `${minutes} min audio`,
  unitChars: (chars) => `${chars} znaków`,
  unitImages: (images) => amount(images, "images"),
  clauseSep: ", ",
  costKinds: {
    reported: "zgłoszone przez dostawcę",
    estimated: "szacunek według cennika",
    mixed: "zgłoszone i oszacowane",
    unknown: "koszt nieznany",
  },
  rowCalls: (calls, failed) => `${amount(calls, "calls")}${failed > 0 ? ` (nieudanych: ${failed})` : ""}`,
  costApprox: (money, kind) => `≈ ${money} (${kind})`,
  usageHeader: (scope, period, from, to) => `Użycie (${scope ? `${scope}, ` : ""}${period}: ${from} do ${to})`,
  noCalls: "  Brak wywołań",
  totalCalls: (calls, failed) => `  ${amount(calls, "calls")}${failed > 0 ? ` (nieudanych: ${failed})` : ""}`,
  usageUnits: (units) => `  Użycie: ${units}`,
  spentEstimated: (money) => `  Wydano ≈ ${money} (szacunek według cennika)`,
  spentReported: (money) => `  Wydano ${money} (zgłoszone przez dostawcę)`,
  unknownCostCalls: (calls) => `  Nieznany koszt dla kolejnych ${amount(calls, "callsGen")}`,
  noBilledCalls: "  Brak płatnych wywołań",
  byProvider: "Według dostawcy",
  byCapability: "Według funkcji",
  byModel: "Według modelu",
  byAccount: "Według konta",
  usageRepair: "Użycie: baocut models repair <bundleId> [--yes]",
  usageCancel: "Użycie: baocut models cancel <bundleId> [--discard]",
  usageConfigure: "Użycie: baocut models configure <providerId> [--enable|--disable] [--key-stdin] [--endpoint <url>] …",
  usageDefault: "Użycie: baocut models default <capability> <providerId|none> [modelId]",
  usageRemove: "Użycie: baocut models remove <bundleId|providerId>",
  usageRefresh: "Użycie: baocut models refresh <providerId>",
  usageParameters: "Użycie: baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]",
  usageAccounts:
    "Użycie: baocut models accounts <providerId> | add <providerId> [--label <name>] [--region <region>] [--verify] | remove <providerId> <account> | use <providerId> <account>",
  usageDir: "Użycie: baocut models dir [--set <path> [--move|--switch] | --reset [--move|--switch]]",
  cancelledDiscarded: "Zatrzymano i usunięto pobraną część",
  cancelledKept: "Zatrzymano (pobrana część została zachowana; uruchom install ponownie, aby wznowić)",
  unknownCapability: (capability, choices) => `Nieznana możliwość: ${capability} (jedna z ${choices.join(", ")})`,
  clearDefaultNoModel: "Nie podawaj modelu przy czyszczeniu domyślnego",
  defaultSet: (label, provider, model) => `${label} domyślnie: ${provider} / ${model}`,
  defaultCleared: (label) => `${label} ustawienie domyślne usunięto`,
  customProviderDeleted: (id) => `Usunięto: ${id} (wskazujące na niego ustawienia domyślne zachowano i pokazano jako niedostępne)`,
  providerRemoved: (id) => `Usunięto ${id}: wyłączono i usunięto wszystkie konta i klucze (wskazujące na niego ustawienia domyślne zachowano i pokazano jako niedostępne)`,
  providerRefreshFailed: (id, error) => `Nie udało się odświeżyć ${id}: ${error ?? 'unknown reason'}; nadal używana jest wbudowana lista modeli`,
  providerRefreshed: (id, models, voices, at) => `Odświeżono ${id}: ${amount(models, "models")}${voices !== undefined ? `, ${amount(voices, "voices")}` : ""} (${at})`,
  periodChoices: (periods) => `--period musi być jedną z ${periods.join(", ")}`,
  enableDisableConflict: "Użyj tylko jednej opcji: --enable lub --disable",
  saved: (description) => `Zapisano: ${description}`,
  verifiedAndSaved: "Zweryfikowano i zapisano",
  savedPlain: "Zapisano",
  providerNotEnabled: (id) => `${id} nie jest jeszcze włączony: baocut models configure ${id} --enable`,
  accountRemoved: (name) => `Usunięto konto ${name}`,
  accountPreferred: (name) => `Ustawiono jako preferowane: ${name}`,
  providerHasNoAccounts: (id) => `${id} nie ma kont`,
  noSuchProvider: (id) => `Brak takiego dostawcy: ${id}`,
  alreadyRepairing: (jobId) => `Naprawa już trwa (zadanie ${jobId}); pokazano postęp`,
  nothingToRepair: "Brak plików do naprawy",
  notTtyConfirmDownload: "Nie uruchomiono w terminalu: dodaj --yes po potwierdzeniu pobierania przez użytkownika",
  notDownloaded: "Nie pobrano",
  nothingToDownload: "Nie ma czego pobierać",
  repairDone: "Naprawa zakończona",
  repairPartialKept: (bundleId) => `Pobraną część zachowano: uruchom baocut models repair ${bundleId}, aby wznowić`,
  setResetConflict: (usage) => `Użyj tylko jednej opcji: --set lub --reset. ${usage}`,
  dirHasModels: "Bieżący folder zawiera modele: dodaj --move, aby je przenieść, lub --switch, aby zmienić tylko lokalizację (stare pliki zostają)",
  dirChanged: (dir, oldFilesKept) => `Folder modeli zmieniono na ${dir}${oldFilesKept ? " (pliki w starej lokalizacji zachowano)" : ""}`,
  modelsMoved: (dir) => `Przeniesiono modele do ${dir}`,
  dirRolledBack: "Wycofano: oryginalny folder modeli nie został zmieniony",
  pasteKeyHint: "Wklej klucz API, naciśnij Return, a potem Ctrl-D, aby zakończyć:",
  noKeyOnStdin: "Brak klucza API na standardowym wejściu",
  keyHasWhitespace: "Klucz API nie powinien zawierać spacji ani nowych wierszy: wpisz sam klucz na standardowe wejście",
  positiveInteger: (option) => `${option} musi być dodatnią liczbą całkowitą`,
  effortChoices: (efforts) => `--effort musi być jedną z wartości ${efforts.join(", ")}`,
  capabilityLabels: {
    transcribe: "Transkrypcja",
    synthesizeSpeech: "Synteza mowy",
    generateImage: "Generowanie obrazów",
    generateText: "Generowanie tekstu",
    separateAudio: "Separacja głosu",
  },
  unavailableLabels: {
    'not-configured': "niewłączone",
    'missing-credential': "brak klucza API",
    'not-installed': "niezainstalowane",
    'signed-out': "wylogowano",
    outdated: "wersja zbyt stara",
    'not-paired': "niesparowane",
    'not-connected': "nie można się połączyć",
    unsupported: "nieobsługiwane",
    resource: "wyłączone po wielokrotnych błędach",
  },
  unavailable: "niedostępne",
  capabilityState: (label, available, reason) => `${label} ${available ? "dostępne" : `niedostępne (${reason})`}`,
  capabilitySep: ", ",
  configEnabled: "włączone",
  configDisabled: "wyłączone",
  keyState: (set) => `klucz ${set ? "ustawiony" : "nieustawiony"}`,
  configEndpoint: (url) => `endpoint ${url}`,
  modelListRefreshed: (at) => `listę modeli odświeżono ${at}`,
  lastRefreshFailed: (at) => `ostatnie odświeżenie nie powiodło się (${at}); używana jest lista wbudowana`,
  textParameters: (effort, concurrency) => `Domyślny poziom rozumowania: ${effort ?? "the model's own"} · równoczesne żądania na dostawcę ${concurrency}`,
  markDefault: "domyślne",
  markDeclared: "zadeklarowane przez użytkownika",
  wordTimestampsNative: "znaczniki czasu słów",
  wordTimestampsEstimated: "czasy słów oszacowane według długości",
  maxInputMegabytes: (mb) => `≤ ${mb} MB na wywołanie`,
  maxDurationMinutes: (minutes) => `≤ ${minutes} min na wywołanie`,
  voiceCount: (count, defaultVoice) => `${amount(count, "voices")} (domyślnie ${defaultVoice ?? "brak"})`,
  noPresetVoices: "brak gotowych głosów; trzeba podać głos",
  acceptsCustomVoices: "obsługuje własne głosy",
  maxInputChars: (count) => `≤ ${count} znaków na wywołanie`,
  acceptsInstructions: "obsługuje wskazówki stylu",
  sizeCount: (count, defaultSize) => `${amount(count, "sizes")}${defaultSize ? ` (domyślnie ${defaultSize})` : ""}`,
  aspectRatios: (ratios) => `proporcje ${ratios}`,
  maxImageCount: (count) => `≤ ${count} obrazów na wywołanie`,
  sizeAndSeedFixed: "nie można ustawić rozmiaru ani ziarna",
  contextTokens: (count) => `kontekst ${count} tokenów`,
  maxOutputTokens: (count) => `wyjście ≤ ${count} tokenów`,
  efforts: (efforts, defaultEffort) => `poziom rozumowania ${efforts}${defaultEffort ? ` (domyślnie ${defaultEffort})` : ""}`,
  structuredOutput: "ustrukturyzowane wyjście",
  subscription: "w abonamencie, limit nieznany",
  modelName: (id, label) => `${id} (${label})`,
};
