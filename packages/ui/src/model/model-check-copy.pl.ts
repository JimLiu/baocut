import type { ModelCheckCode } from '@baocut/protocol';
import type { CheckSentence, CheckSubject, ModelCheckMessages, TrySubject } from './model-check-copy.ts';

const outputWrong: Record<CheckSubject, string> = {
  transcribe: 'Model działa, ale nie rozpoznaje mowy próbki',
  synthesize: 'Model działa, ale syntetyzowany głos jest nieprawidłowy',
  image: 'Model działa, ale utworzony obraz jest nieprawidłowy',
  separate: 'Model działa, ale głosu i tła nie oddzielono',
};

const checkSentences: Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence> = {
  APP_FILE_MISSING: () => ({
    text: 'Brak pliku BaoCut; to nie problem modelu',
    todo: 'Ponowna instalacja BaoCut rozwiąże problem. Pobrane modele bez zmian.',
  }),
  MODEL_FILES_DAMAGED: () => ({ text: 'Pliki modelu uszkodzone', todo: 'Naprawa pobierze ponownie uszkodzone pliki.' }),
  MODEL_OUTPUT_WRONG: (subject) => ({
    text: outputWrong[subject],
    todo: 'Najpierw napraw. Przy powtórzeniu skopiuj szczegóły techniczne i wyślij do nas.',
  }),
  MODEL_OUT_OF_MEMORY: () => ({ text: 'Za mało pamięci, model niewczytany', todo: 'Zamknij inne duże modele lub aplikacje zużywające pamięć i sprawdź ponownie.' }),
  MODEL_WORKER_FAILED: () => ({
    text: 'Błąd procesu modelu w tle',
    todo: 'Sprawdź ponownie. Przy powtórzeniu uruchom BaoCut ponownie lub skopiuj szczegóły techniczne i wyślij do nas.',
  }),
};


function trySubject(verb: string, noun: string, noMemoryTodo: string): TrySubject {
  return {
    noMemory: { text: `Nie udało się ukończyć ${verb} z braku pamięci`, todo: noMemoryTodo },
    modelError: { text: verb === 'syntezy' ? 'Błąd modelu, nie utworzono audio' : 'Błąd modelu, nie utworzono obrazu', todo: 'Sprawdź model, aby znaleźć przyczynę.' },
    other: (message) => ({ text: `Nie udało się wykonać ${verb}: ${message}`, todo: 'Spróbuj ponownie. Przy powtórzeniu zobacz szczegóły w zadaniach w tle.' }),
    notStarted: (message) => ({ text: `Nie udało się rozpocząć ${verb}: ${message}`, todo: '' }),
    noticeTodo: (todo) => `${todo} Teraz ${noun} też najprawdopodobniej się nie powiedzie.`,
  };
}

export const pl: ModelCheckMessages = {
  label: {
    check: "Sprawdzanie",
    checkFull: "Sprawdź model",
    recheck: "Sprawdź ponownie",
    repair: "Napraw…",
    repairSub: "Pobiera ponownie tylko uszkodzone pliki",
    details: "Szczegóły techniczne",
    hideDetails: "Ukryj szczegóły techniczne",
    copy: "Kopiuj szczegóły techniczne",
    copied: "Szczegóły techniczne skopiowane",
    copyFailed: "Nie udało się skopiować. Zaznacz tekst powyżej i skopiuj.",
    cancel: "Anuluj",
    retry: "Spróbuj ponownie",
    pickRef: "Wybierz inne nagranie…",
    useSample: "Użyj próbki nagrania",
  },
  caption: "Sprawdzenie potwierdza działanie modelu; naprawa pobiera tylko uszkodzone pliki. Przy usuwaniu modelu komponenty współdzielone z innymi zostają zachowane.",
  head: {
    running: "Sprawdzanie…",
    repairing: "Naprawianie…",
    failed: "Sprawdzenie nie powiodło się:",
    notStarted: "Nie można rozpocząć sprawdzania:",
  },
  sentence: (text) => `${text}.`,
  phase: {
    queued: "W kolejce",
    loading: "Wczytywanie modelu",
    running: "Uruchamianie krótkiej próbki",
    verifying: "Weryfikowanie wyniku",
    repairing: "Ponowne pobieranie uszkodzonych plików; automatyczne sprawdzenie po naprawie",
  },
  checkSentences,
  unknown: {
    text: "Model nie działał poprawnie",
    todo: "Sprawdź ponownie. Jeśli powtarza się, skopiuj szczegóły techniczne i wyślij do nas.",
  },
  notStarted: {
    RUNTIME_UNREACHABLE: { text: "Usługa BaoCut w tle nie odpowiada", todo: "Sprawdź później. Jeśli powtarza się, uruchom BaoCut ponownie." },
    MODEL_IN_USE: { text: "Inne zadanie używa modelu", todo: "Poczekaj na ukończenie lub anuluj w zadaniach w tle, potem sprawdź." },
    MODEL_UNAVAILABLE: { text: "Nie można teraz użyć modelu", todo: "Najpierw napraw lub włącz, potem sprawdź." },
    RESOURCE_ADMISSION_UNSATISFIABLE: { text: "Komputer ma za mało pamięci dla modelu", todo: "Wybierz mniejszy model." },
    WEB_METHOD_NOT_ALLOWED: { text: "Nie można sprawdzać modeli lokalnych w przeglądarce", todo: "Sprawdź w aplikacji komputerowej." },
    OFFLINE_STRICT: { text: "Ścisły tryb offline włączony", todo: "Wyłącz ścisły offline w ustawieniach, potem sprawdź." },
  },
  notStartedUnknown: {
    text: "BaoCut nie przyjął sprawdzenia",
    todo: "Sprawdź później. Jeśli powtarza się, skopiuj szczegóły techniczne i wyślij do nas.",
  },
  detail: {
    code: (code) => `Kod ${code}`,
    model: (id, when) => `Model ${id} · ${when}`,
    message: (message) => `Wiadomość ${message}`,
    passed: (when) => `Sprawdzenie zaliczone · ${when}`,
  },
  noticeText: (what) => `Ostatnie sprawdzenie modelu nieudane: ${what}`,
  refUnreadable: (file) => ({
    text: `Nie można odczytać nagrania „${file}”. Plik może być uszkodzony lub nie jest audio`,
    todo: "Spróbuj innego nagrania lub najpierw posłuchaj próbki.",
  }),
  refUnknown: "nagranie",
  trySpeech: trySubject('syntezy', 'podgląd', 'Zamknij inne duże modele lub aplikacje zużywające pamięć i spróbuj ponownie.'),
  tryImage: trySubject('rysowania', 'próbny obraz', 'Zamknij inne duże modele i spróbuj ponownie lub zmniejsz liczbę kroków.'),
};
