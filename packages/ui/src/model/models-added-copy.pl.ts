import { pluralForm } from '@baocut/protocol';
import type { ModelsAddedMessages } from './models-added-copy.ts';

const languages = (n: number) => pluralForm('pl', n, { one: `${n} język`, few: `${n} języki`, many: `${n} języków`, other: `${n} języka` });

export const pl: ModelsAddedMessages = {
  entryLabel: 'Dodaj więcej modeli',
  entryDesc: (n: number, group: 'tts' | 'music' | 'sep') => {
    if (group === 'sep') return `Oprócz wbudowanego audio.cpp ma jeszcze ${pluralForm('pl', n, { one: `${n} model`, few: `${n} modele`, many: `${n} modeli`, other: `${n} modelu` })} do oddzielania głosu od tła. Możesz też dodać własny plik GGUF.`;
    const music = group === 'music';
    const kind = music ? 'muzyki' : 'mowy';
    const models = pluralForm('pl', n, { one: `${n} model`, few: `${n} modele`, many: `${n} modeli`, other: `${n} modelu` });
    return `Oprócz wbudowanych audio.cpp obsługuje jeszcze ${models} ${kind} oraz inne precyzje modeli wbudowanych. Możesz też dodać własny plik GGUF.`;
  },
  entryButton: 'Dodaj model…',

  title: 'Dodaj modele audio.cpp',
  lede: (engine: string) =>
    `Można dodać każdy model obsługiwany przez wbudowany w BaoCut silnik audio.cpp (${engine}). Dodane modele pobiera się, odsłuchuje i usuwa tak samo jak wbudowane. BaoCut nie przetestował każdego z nich, więc wypróbuj model i sprawdź go, aby zobaczyć, jak dobrze działa.`,
  loading: 'Wczytywanie listy modeli audio.cpp…',
  loadFailed: (text: string) => `Nie udało się wczytać listy modeli: ${text}`,
  groupsLabel: 'Grupy modeli',
  groups: { tts: 'Mowa', music: 'Muzyka', sep: 'Separacja', idle: 'Jeszcze nieużywane', custom: 'Własny plik' },
  searchLabel: 'Szukaj modeli audio.cpp',
  searchPlaceholder: 'Szukaj po nazwie, języku lub funkcji',
  countFound: (n: number) => `Znaleziono: ${n}`,
  countIdle: (n: number) => `${n} · jeszcze nie można dodać`,
  countFamilies: (n: number) =>
    pluralForm('pl', n, { one: `${n} rodzina modeli`, few: `${n} rodziny modeli`, many: `${n} rodzin modeli`, other: `${n} rodziny modeli` }),
  listLabel: 'Modele audio.cpp',
  empty: (q: string) => `W tej grupie nic nie pasuje do „${q}”. Jeśli potrzebnego pliku nie ma na liście, możesz dodać go samodzielnie.`,
  emptyAction: 'Dodaj własny plik…',
  done: 'Gotowe',
  cancel: 'Anuluj',

  status: { experimental: 'Eksperymentalny', community: 'Społeczność', testing: 'W testach' },
  chipNonCommercial: 'Tylko niekomercyjnie',
  chipCheckLicense: 'Użytek komercyjny niezweryfikowany',
  options: (n: number) => pluralForm('pl', n, { one: `${n} opcja`, few: `${n} opcje`, many: `${n} opcji`, other: `${n} opcji` }),
  withParts: (names: readonly string[]) => `Pobierany razem z: ${names.join(', ')}`,
  noPackages: 'W źródle nie ma jeszcze GGUF do pobrania',
  versionLabel: (name: string) => `Wersja ${name}`,
  builtin: 'Wbudowany',
  added: 'Dodany',
  add: 'Dodaj',

  traits: {
    clone: 'Klonowanie głosu',
    design: 'Głos z opisu',
    voices: (n: number) =>
      pluralForm('pl', n, { one: `${n} wbudowany głos`, few: `${n} wbudowane głosy`, many: `${n} wbudowanych głosów`, other: `${n} wbudowanego głosu` }),
    style: 'Polecenie stylu',
    emotion: 'Sterowanie emocjami',
    lyrics: 'Tekst piosenki',
    instrumental: 'Instrumentalny',
  },
  languages: {
    auto: 'Wykrywa język',
    count: languages,
    atLeast: (n: number) => `${n}+ języków`,
    multilingual: 'Wielojęzyczny',
    any: 'Dowolny język',
    modelDependent: 'Zależy od modelu',
    more: (shown: readonly string[], total: number) => `${shown.join(' / ')} i inne (${languages(total)})`,
  },
  tasks: {
    asr: 'Rozpoznawanie mowy',
    vad: 'Wykrywanie głosu',
    wake_word: 'Słowo aktywujące',
    classify: 'Klasyfikacja dźwięków',
    align: 'Wyrównanie tekstu',
    diar: 'Etykiety mówców',
    vc: 'Konwersja głosu',
    s2s: 'Dialog mówiony',
    midi: 'Do MIDI',
    sfx: 'Efekty dźwiękowe',
    sep: 'Separacja źródeł',
    svc: 'Konwersja głosu śpiewu',
    edit: 'Edycja audio',
    turn: 'Wykrywanie końca wypowiedzi',
    tts: 'Mowa',
    clone: 'Klonowanie głosu',
    design: 'Projektowanie głosu',
    music: 'Muzyka',
  },
  idle: {
    recognize: 'Transkrypcja nadal korzysta z własnych modeli rozpoznawania BaoCut: rozpoznawanie w audio.cpp jest wolniejsze i nie rozróżnia mówców',
    'separate-slow': 'Rozdziela najczyściej, ale jest znacznie wolniejszy, a licencja jest niejasna; na razie użyj Mel-Band RoFormer',
    'separate-stems': 'Dzieli dźwięk na 6 ścieżek; lektor potrzebuje tylko głosu i tła, więc użyj HTDemucs',
    'separate-speakers': 'Rozdziela głosy kilku osób, a nie głos od tła; BaoCut jeszcze tego nie używa',
    other: (tasks: string) => (tasks ? `${tasks} · BaoCut jeszcze z tego nie korzysta` : 'BaoCut jeszcze z tego nie korzysta'),
    'music-request': 'Ten model muzyczny przyjmuje inne żądania niż YuE2, a BaoCut jeszcze ich nie obsługuje',
    'engine-route': 'Silnik udostępnia ten model tylko do zadań, z których BaoCut jeszcze nie korzysta',
  },
  sepTraits: {
    htdemucs: 'Głos i tło · jeden model, mniejszy niż wbudowany HTDemucs-FT',
    mel_band_roformer: 'Głos i tło · rozdziela czyściej niż model wbudowany',
  },

  sourceLabel: 'Gdzie jest plik?',
  sourceRepo: 'Na Hugging Face',
  sourceLocal: 'Na tym komputerze',
  urlLabel: 'Adres pliku',
  urlPlaceholder: 'https://huggingface.co/user/repo/blob/main/model.gguf',
  urlParsed: (repo: string, revision: string, path: string) =>
    `Repozytorium ${repo} · rewizja ${revision} · plik ${path}. Rozmiar i suma kontrolna są odczytywane przy dodawaniu i służą do weryfikacji pobierania.`,
  urlHelp: 'Wklej adres internetowy pliku lub zapisz go jako user/repo/file.gguf. Modele złożone z kilku plików dodaje się z listy.',
  urlErrors: {
    empty: 'Wpisz adres pliku',
    'not-hf': 'Nie rozpoznano tego adresu. Wklej adres internetowy pliku na Hugging Face lub zapisz go jako user/repo/file.gguf',
    'not-gguf': 'Można dodawać tylko pliki .gguf. Modele złożone z kilku plików dodaj z listy',
  },
  fileLabel: 'Plik',
  filePlaceholder: 'Nie wybrano',
  fileHelp: 'Używany na miejscu: BaoCut odczytuje ten plik bezpośrednio, bez kopiowania i zmieniania, więc jest gotowy od razu po dodaniu. Jeśli przeniesiesz lub usuniesz plik, dodaj go ponownie.',
  fileRequired: 'Najpierw wybierz plik .gguf',
  chooseFile: 'Wybierz plik…',
  pickTitle: 'Wybierz plik modelu GGUF',
  pickFilter: 'Model GGUF',
  familyLabel: 'Uruchamiaj jako',
  familyHelp: (about: string) => `${about}. audio.cpp odczytuje plik zgodnie z wybraną rodziną; zły wybór objawi się błędem podczas sprawdzania.`,
  familyHelpNone: 'audio.cpp decyduje, jak odczytać plik, na podstawie jego rodziny.',
  familyRequired: 'Wybierz rodzinę',
  nameLabel: 'Nazwa (opcjonalnie)',
  namePlaceholder: 'Używa nazwy pliku',
  addLocal: 'Dodaj',
  addRepo: 'Dodaj i pobierz…',

  addedToast: (name: string) => `Dodano „${name}”`,
  addedInPlaceToast: (name: string) => `Dodano „${name}” · plik jest używany tam, gdzie jest, bez kopiowania`,
  addFailed: (text: string) => `Nie udało się dodać: ${text}`,

  chipAdded: 'Dodany',
  inPlace: (path: string) => `Używa ${path} na miejscu · poza folderem modeli`,
  sourceKey: 'Dodano z',
  sourceCatalog: (family: string) => `Lista modeli audio.cpp · uruchamiany jako ${family}`,
  sourceRepoFile: (address: string, family: string) => `${address} · uruchamiany jako ${family}`,
  sourceLocalFile: (family: string) => `Plik na tym komputerze · uruchamiany jako ${family}`,
  unlist: 'Usuń z listy',
  unlistTitle: (name: string) => `Usunąć „${name}” z listy?`,
  unlistInPlaceBody: (path: string) => `Plik zostaje w ${path}. BaoCut przestaje go używać i go nie usunie. Aby znów go używać, dodaj go ponownie.`,
  unlistConfirm: 'Usuń',
  unlistedToast: (name: string) => `Usunięto „${name}” z listy`,
  unlistedInPlaceToast: (name: string) => `Usunięto „${name}” z listy · plik pozostał nietknięty`,
  unlistFailed: (text: string) => `Nie udało się usunąć z listy: ${text}`,
  removeAddedNote: 'Ten model został dodany przez ciebie, więc usunięcie go usuwa go też z listy. Aby znów go używać, dodaj go ponownie.',
  licenseCheckUse: 'Nie jest jasne, czy wolno go używać komercyjnie. Przeczytaj licencję, zanim użyjesz go w treściach, które planujesz wykorzystać komercyjnie.',
};
