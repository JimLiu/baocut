import { pluralForm } from '@baocut/protocol';
const sentences = (n: number) => pluralForm('pl', n, { one: `${n} zdanie`, few: `${n} zdania`, many: `${n} zdań`, other: `${n} zdania` });
const glossaryCount = (n: number) => pluralForm('pl', n, { one: `${n} glosariusz`, few: `${n} glosariusze`, many: `${n} glosariuszy`, other: `${n} glosariusza` });
const takeCount = (n: number) => pluralForm('pl', n, { one: `${n} wersja`, few: `${n} wersje`, many: `${n} wersji`, other: `${n} wersji` });
const these = (n: number) => n > 1 ? `te ${sentences(n)}` : 'to zdanie';
import type { DubOriginalAudio } from '@baocut/protocol';
import type { DubMessages, DubRegenMessages, TimelineDubMessages } from './dub-copy.ts';

export const plDub: DubMessages = {

  title: "Tłumaczony dubbing",
  back: "Wstecz",
  web: "Tłumaczony lektor wymaga aplikacji desktopowej",
  webBody: "BaoCut w przeglądarce nie udostępnia gotowych procesów (pipelines.*), więc nie można tu uruchomić tłumaczonego lektora. Otwórz wideo w aplikacji desktopowej.",
  summary: (language: string, count: number | null, translate: boolean) => `${translate ? `Najpierw tłumaczy na ${language}, potem syntetyzuje` : `Używa istniejącego tłumaczenia na ${language} i syntetyzuje`} mowę ${count === null ? "zdanie po zdaniu" : `dla ${sentences(count)} pojedynczo`}, dopasowuje do czasu oryginalnego zdania i zapisuje na osi czasu jako jedną grupę lektora`,
  language: "Język lektora",
  languagePicker: "Język lektora",
  languageLine: (translate: boolean, count: number | null) => `${translate ? "Brak tłumaczenia na ten język · najpierw tłumaczenie" : "Używa istniejącego tłumaczenia · bez nowego tłumaczenia"}${count === null ? "" : ` · ${sentences(count)}`}`,
  allTaken: "Brak języków dostępnych dla lektora.",
  staleNote: (n: number) => `Nieaktualne tłumaczenie: ${sentences(n)} (oryginał zmieniono lub oznaczono jako nieaktualny). Te zdania nie będą syntetyzowane i pojawią się w podsumowaniu. Przetłumacz je ponownie w panelu napisów, aby uzyskać pełnego lektora.`,
  source: "Oryginał",
  sourcePicker: "Odczytaj transkrypcję",
  sourceLine: (language: string, count: number | null) => (count === null ? language : `${language} · ${sentences(count)}`),
  voiceModel: "Model głosu",
  voiceModelPicker: "Model syntezy mowy",
  voiceModelsLoading: "Wczytywanie modeli mowy…",
  manageVoiceModels: "Zarządzaj modelami mowy…",
  ttsMissingTitle: "Brak dostępnego modelu mowy",
  goTts: "Otwórz Modele › Synteza mowy",
  voice: "Domyślny głos",
  voicePicker: "Dla mówców bez własnego głosu",
  voiceDefault: "Domyślny modelu",
  voiceCustom: "ID głosu",
  voiceCustomPlaceholder: "ID głosu z konta dostawcy",
  voiceHint: "Mówcy z głosem przypisanym poniżej używają go; pozostali używają wybranego tutaj.",
  voiceCustomEmpty: "Najpierw wpisz ID głosu lub wybierz inny głos",
  speakers: "Mówcy",
  speakersAside: (n: number) => `${n}`,
  speakersNone: "Transkrypcja nie ma danych o mówcach, więc każde zdanie używa powyższego głosu domyślnego.",
  speakersNote: "Przypisania są zapisywane w wideo (zmiana do cofnięcia) i używane ponownie. Priorytet: przypisany → domyślny głos → domyślny modelu.",
  speakerLine: (count: number) => sentences(count),
  speakerBinding: (name: string) => `Głos przypisany do ${name}`,
  bindingNone: "Żadne",
  bindingOther: (label: string) => `${label} (przypisany gdzie indziej)`,
  bindingIgnored: (provider: string) => `Przypisany głos innego dostawcy nie jest używany z ${provider}`,
  bindingReadOnly: "Wideo jest tylko do odczytu; nie można zmieniać głosów mówców.",
  bindingFailed: (message: string) => `Nie udało się zmienić głosu mówcy: ${message}`,
  bindingLoading: "Wczytywanie głosów mówców…",
  bindingReadFailed: (message: string) => `Nie udało się odczytać głosów przypisanych w tym wideo: ${message}`,
  bindingSaved: (name: string) => `Przypisano głos do ${name}`,
  bindingCleared: (name: string) => `Usunięto ${name} – przypisanie głosu`,
  sourceVideo: "Przypisano",
  sourceParams: "Domyślny głos",
  sourceDefault: "Domyślny modelu",

  effective: (label: string, source: string | null) => (source ? `Używany: ${label} (${source})` : `Używany: ${label}`),
  speakerWarning: (reason: string) => `Zdania tego mówcy nie będą syntetyzowane: ${reason}`,
  manageVoices: "Zarządzaj moimi głosami…",
  mix: "Miksowanie",
  separate: "Oddziel audio tła",
  separateHint: "Lektor zastępuje tylko mowę; muzyka i dźwięki otoczenia zostają",
  separateMissing: "Na tym komputerze nie ma modelu separacji; nawet po włączeniu jest pomijana, a oryginalne audio przetwarzane w całości.",
  installSeparate: "Zainstaluj model separacji…",
  original: "Oryginalne audio",
  originalPicker: "Co dzieje się z oryginalnym audio podczas lektora",
  originalLabel: { duck: "Przycisz", mute: "Wycisz", keep: "Zachowaj" },

  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) => o.original === 'keep'
      ? `Oryginalne audio pozostaje bez zmian i gra pod lektorem${o.separated ? "; przy zachowaniu nic nie jest oddzielane" : ""}.`
      : `${o.separated ? "Audio tła trafia na osobną ścieżkę, a w oryginale zostaje tylko mowa, która jest" : "Bez separacji całe oryginalne audio jest"} ${o.original === 'mute' ? "wyciszone" : `przyciszone o −${o.duckDb} dB`}. Do oryginalnego audio można wrócić w nagłówku ścieżki lektora w dowolnej chwili.`,
  duckDb: "Stopień przyciszenia (dB)",
  duckLabel: "Przycisz",
  duckUnit: "dB",
  translate: "Tłumaczenie",
  textModel: "Model tekstowy",
  textModelPicker: "Model tekstowy tłumaczenia",
  textModelsLoading: "Wczytywanie modeli tekstowych…",
  manageTextModels: "Zarządzaj modelami tekstowymi…",
  textMissingTitle: "Nie ma jeszcze dostępnego modelu tekstowego",
  goLlm: "Otwórz Modele › Generowanie tekstu",
  noStructured: "Bez wyniku strukturalnego · tłumaczenie niemożliwe",
  style: "Wskazówka stylu",
  stylePlaceholder: "Np. swobodnie, zwięźle; zachowaj oryginalne imiona",
  styleHint: "Opcjonalnie; do 500 znaków.",
  cta: (language: string) => `Lektor w ${language}`,

  ctaHint: (language: string, stems: { separated: boolean; original: DubOriginalAudio }) => {
    const tracks = [`„Lektor · ${language}”`];
    if (stems.separated && stems.original !== 'keep') tracks.push("„Tło”");
    if (stems.separated && stems.original === 'duck') tracks.push("„Wokal”");
    const list = tracks.length === 1 ? tracks[0] : `${tracks.slice(0, -1).join(", ")} i ${tracks[tracks.length - 1]}`;
    return `Po zakończeniu zapisuje na ${pluralForm('pl', tracks.length, { one: `ścieżkę`, few: `ścieżki`, many: `ścieżki`, other: `ścieżki` })} ${list} na osi czasu; cofnięcie jednym kliknięciem. Modele online są płatne za wywołanie.`;
  },
  noSpeechTitle: "Brak transkrypcji do odczytania",
  noSpeech: "Lektor działa zdanie po zdaniu z transkrypcji. Najpierw transkrybuj materiał przez „Generuj napisy” w panelu napisów.",
  busy: "W tym wideo lektor już powstaje; poczekaj na zakończenie.",
  readOnly: "Wideo jest tylko do odczytu; nie można dodać lektora.",

  submitting: "Wysyłanie lektora",
  queued: "W kolejce",
  running: (language: string) => `Odczytywanie · ${language}`,
  stepUnits: (step: 'translate' | 'synthesize', done: number, total: number | null) => `${step === 'translate' ? "Przetłumaczono" : "Zsyntetyzowano"} ${total ? `${done} / ${sentences(total)}` : sentences(done)}`,
  sentences: (running: number, failed: number) => [running ? `${sentences(running)} w syntezie` : "", failed ? `${sentences(failed)} z niepowodzeniem` : ""].filter(Boolean).join(" · "),
  cancel: "Anuluj lektora",
  cancelled: "Lektor anulowany",
  cancelFailed: (message: string) => `Nie udało się anulować lektora: ${message}`,
  liveNote: "Po zakończeniu Runtime zapisuje wynik bezpośrednio na osi czasu; można cofnąć w dowolnej chwili. Możesz opuścić tę stronę.",
  foreign: "Ten lektor uruchomiono gdzie indziej. Po zakończeniu sprawdź oś czasu; cofnij przez edytor.",

  grantTitle: (recipient: string) => `Brak uprawnienia do wysłania transkrypcji do ${recipient}`,
  grantBody: "Lektor wysyła dostawcy tłumaczenie do syntezy (i oryginał, gdy brak tłumaczenia). Nadaj uprawnienie ograniczone do tego wideo; bez niego nic nie jest wysyłane.",
  grantAction: "Nadaj uprawnienie i uruchom",
  grantRetryAction: "Nadaj uprawnienie i spróbuj ponownie",
  grantDialogTitle: "Nadaj uprawnienie do udostępniania danych",
  grantDialogIntro: "Po potwierdzeniu BaoCut zapisze uprawnienie i będzie kontynuować lektora:",
  grantConfirm: "Zezwól i kontynuuj",
  grantCancel: "Nie teraz",
  granting: "Nadawanie uprawnienia…",
  grantFailed: (message: string) => `Nie udało się nadać uprawnienia: ${message}`,
  grantStillRefused: "Nadal odmowa po nadaniu uprawnienia",
  grantNext: "Gdy tłumaczenie i synteza używają różnych dostawców, każdy wymaga osobnego uprawnienia.",
  commands: "Wiersz poleceń",

  notConfigured: "Lektor nie jest jeszcze dostępny",
  submitFailed: "Nie udało się uruchomić lektora",
  failed: "Lektor nie powiódł się",
  interrupted: "Lektor został przerwany",
  retry: "Spróbuj ponownie",
  retryFailed: (message: string) => `Nie udało się ponowić: ${message}`,
  retryCharges: "Ponowna próba zaczyna od zatrzymanego kroku. Jeśli to „Tłumaczenie”, cały krok jest powtarzany; gotowe partie ponownie wywołują model i mogą być ponownie płatne.",
  retryPartial: "Ponowna próba zaczyna od „Syntezy zdań”: gotowe zdania są używane ponownie, a syntetyzowane tylko nieudane i pozostałe.",
  retryFree: "Ponowna próba zaczyna od zatrzymanego kroku; gotowe wcześniejsze kroki są używane bez ponownego wywołania modelu.",
  retryFrozen: "Przypisania głosów zamrożono przy starcie: naprawa głosu (ponowny klon, oświadczenie właściciela) pomaga ponownej próbie, ale zmiana przypisań wymaga nowego lektora.",
  failedUnits: (n: number) => `${sentences(n)} nie udało się zsyntetyzować`,
  stoppedAt: (synthesized: number, remaining: number) => `Zatrzymano po syntezie ${sentences(synthesized)}; ${remaining} pozostało`,
  dismiss: "OK",

  doneTitle: (language: string) => `Odczytano w ${language}`,
  doneToast: (language: string, placed: number) => `Odczytano w ${language} · ${sentences(placed)} umieszczono na osi czasu`,
  placed: (placed: number, total: number) => `${placed} / ${total} zdań umieszczono na osi czasu`,
  fitHead: "Gdzie trafiło każde zdanie",
  speakersHead: "Głosy mówców",
  speakerUnits: (n: number) => sentences(n),
  speakerNone: "Bez mówcy",
  voiceFailedHead: "Zdania tych mówców nie zostały zsyntetyzowane",
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · ${sentences(n)} · ${reason}`,
  voiceFailedFix: "Lektor zakończony, nie można ponowić: cofnij grupę → napraw głos (ponowny klon, oświadczenie właściciela) lub zmień przypisanie → odczytaj ponownie.",
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) => [
      pluralForm('pl', calls, { one: `${calls} wywołanie`, few: `${calls} wywołania`, many: `${calls} wywołań`, other: `${calls} wywołania` }),
      retries ? `${retries} wysłano ponownie` : "",
      failures ? `${failures} z niepowodzeniem` : "",
      reused ? `${sentences(reused)} użyto ponownie` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  translationCreated: "Nowe tłumaczenie zapisano w wideo (cofnięcie lektora go nie usuwa)",
  translationUsed: "Użyto istniejącego tłumaczenia",
  glossaryUsed: (n: number) => `Użyto: ${glossaryCount(n)}`,
  warnings: "Ostrzeżenia",
  undo: "Cofnij tego lektora",
  undoing: "Cofanie…",
  undone: "Lektor cofnięty",
  undonePartial: "Cofnięto klipy, wyciszenia i przyciszenia lektora. Pusta ścieżka i dokument planu zostają w wideo (protokół nie ma usuwania ścieżek ani dokumentów).",
  undoLabel: (language: string) => `Cofnij lektora (${language})`,
  undoFailed: "Nie udało się cofnąć tego lektora",
  undoNotOpen: "Najpierw otwórz to wideo, aby cofnąć lektora.",
  close: "Zamknij",
  again: "Odczytaj ponownie",
  providerFallback: "ten dostawca",
  unknownLanguage: "Nieznany język",
};

export const plTimelineDub: TimelineDubMessages = {
  trackLabel: (language: string) => `Dubbing · ${language}`,

  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? "Wokal" : "Tło"} · ${language}`,

  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? " · za szybko" : ""}`,

  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)} s`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) => [
      parts.text,
      parts.speaker,
      parts.rate,
      parts.muted ? "Wyciszone" : "",
      parts.manual ? "Prędkość zmieniono ręcznie" : "",
      parts.editable ? "Przeciągnij prawą krawędź, aby zmienić długość · więcej w menu kontekstowym" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  menuLabel: (title: string) => `Menu lektora dla „${title}”`,
  selection: (n: number) => `${sentences(n)} wybrano`,
  count: (n: number) => (n > 1 ? `Te ${n}` : "To zdanie"),
  listen: "Odtwórz to zdanie",
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ""}`,
  mute: (allMuted: boolean, n: number) => `${allMuted ? "Wyłącz wyciszenie" : "Wycisz"} ${these(n)}`,
  muteHint: (allMuted: boolean) => (allMuted ? "Przywróć lektora tych zdań" : "Te zdania milkną · także w eksporcie"),
  remove: (n: number) => `Usuń ${these(n)}`,
  removeHint: "Usuwa ze ścieżki lektora · można cofnąć",
  removeGroup: "Usuń tę grupę dubbingu",
  removeGroupHint: (bed: boolean) => `${bed ? "Usuwa razem z audio tła" : "Usuwa cały lektor tego języka"} · przywraca wyciszone przez niego oryginalne audio`,
  labelMute: "Wycisz lektora",
  labelUnmute: "Włącz lektora",
  labelRemove: "Usuń lektora",
  labelRemoveGroup: (language: string) => `Usuń lektora (${language})`,
  labelStretch: "Zmień prędkość lektora",
  muted: (n: number) => `Wyciszono ${sentences(n)} lektora`,
  unmuted: (n: number) => `Włączono ${sentences(n)} lektora`,
  removed: (n: number) => `Usunięto: ${sentences(n)} lektora`,
  groupRemoved: (language: string) => `Usunięto „Lektor · ${language}” · pusta ścieżka lektora i dokument planu zostają w wideo`,
  planUnread: "Nie udało się odczytać planu: wyciszone oryginalne audio nie zostało przywrócone. Włącz je na oryginalnych klipach.",
};

export const plDubRegen: DubRegenMessages = {

  headMenu: (label: string) => `„${label}” ścieżka`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) => [
      sentences(c.total),
      c.failed ? `${c.failed} niezsyntetyzowane` : "",
      c.fast ? `${c.fast} za szybko` : "",
      c.muted ? `${c.muted} wyciszone` : "",
      c.queued ? `${c.queued} w regeneracji` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  listenDub: "Słuchaj lektora",
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) => `Lektor tej grupy${o.bed ? " + tło" : ""} · ${o.duck ? "oryginał przyciszony" : "oryginał wyciszony"}${o.others ? " · inne języki wyłączone" : ""}`,
  listenDubKeep: "Ta grupa zachowała oryginalne audio bez zapisania jego części; użyj „Słuchaj obu”",
  listenOriginal: "Słuchaj oryginału",
  listenOriginalHint: (others: boolean) => `Przywraca oryginalne audio wideo · ${others ? "wszystkie grupy lektora" : "ta grupa lektora"} wyciszone`,
  listenBoth: "Słuchaj obu",
  listenBothHint: (bed: boolean) => `Do porównania${bed ? " · tło tej grupy wyłączone" : ""}`,
  sourceLabel: { dub: "Słuchaj lektora", original: "Słuchaj oryginału", both: "Słuchaj obu" },
  sourceDone: { dub: (language: string) => `Słuchanie „Lektor · ${language}”`, original: "Słuchanie oryginału · lektor wyciszony", both: "Oryginał i lektor grają razem" },
  regenSome: (n: number) => (n ? `Wygeneruj ponownie ${sentences(n)}…` : "Wygeneruj ponownie…"),
  regenSomeHint: (failed: number, fast: number) => failed || fast
      ? `${[failed ? `${failed} niezsyntetyzowane` : "", fast ? `${fast} za szybko` : ""].filter(Boolean).join(" · ")} · najpierw możesz edytować tłumaczenie`
      : "Brak nieudanych lub zbyt szybkich zdań",
  redub: "Odczytaj ponownie…",
  redubHint: "Otwiera tłumaczonego lektora: zmień język lub głos i ponów całą grupę",
  readOnly: "Wideo jest tylko do odczytu",

  regenBlocks: (n: number) => `Wygeneruj ponownie ${these(n)}`,
  regenBlocksHint: "Synteza tego samego tłumaczenia i głosu ponownie · nowe ziarno · stara wersja zostaje",
  retext: "Edytuj tłumaczenie i odczytaj…",
  retextHint: "Najpierw sprawdź długości i edytuj tłumaczenie, potem odczytaj tylko te zdania",
  inQueue: "Niektóre zdania są generowane ponownie",

  queued: "Ponowne generowanie…",
  queuedTip: (text: string) => `${text} · ponowne generowanie`,
  version: (k: number, seed: number | null) => (seed === null ? `Wersja ${k}` : `Wersja ${k} · ziarno ${seed}`),

  submitted: (n: number) => `Rozpoczęto ponowne generowanie ${sentences(n)} lektora`,
  submitFailed: (message: string) => `Nie udało się rozpocząć ponownego generowania: ${message}`,
  grantRefused: (recipient: string) => `Ponowne generowanie wysyła tłumaczenie do ${recipient}, brak jeszcze uprawnienia. Nadaj je w Ustawieniach lub zacznij nowego tłumaczonego lektora`,
  busy: "Grupa jest wysyłana; poczekaj chwilę",
  done: (replaced: number, total: number) => replaced === total ? `Wygenerowano ponownie ${sentences(replaced)} lektora` : `Wygenerowano ponownie ${replaced}/${total} zdań lektora`,
  doneNone: "Żadne zdanie nie otrzymało nowej wersji",
  notPlaced: (status: string, n: number) => status === 'overlong'
      ? `${sentences(n)} nie zmieściło się; poprzednią wersję zachowano`
      : status === 'stale'
        ? `${sentences(n)} miało nieaktualne tłumaczenie i nie zostało zsyntetyzowane`
        : status === 'voice-unavailable'
          ? `${sentences(n)} miało niedostępny głos i nie zostało zsyntetyzowane`
          : `${sentences(n)} nie ma na osi czasu`,
  failed: (message: string) => `Ponowne generowanie nie zakończyło się: ${message}`,
  cancelled: "Ponowne generowanie anulowano",
  undo: "Cofnij",
  undoMissing: "Nie znaleziono zmiany zapisanej przez tę regenerację; użyj cofania w edytorze",
  labelRetext: "Edytuj tłumaczenie (ponowny lektor)",

  fitTitle: (n: number) => `Edytuj tłumaczenie i odczytaj ${sentences(n)}`,
  fitIntro: "Edytujesz wypowiadane tłumaczone zdanie (zmienione są oznaczane jako sprawdzone); napisy nie są ponownie dzielone. Każde zdanie syntetyzuje się z nowym ziarnem, a stara wersja zostaje.",
  fitDub: (seconds: number, rate: string) => `Dubbing ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ""}`,
  fitVoice: "Niezsyntetyzowane: głos niedostępny",
  fitOverlong: (seconds: number | null) => (seconds === null ? "Nieumieszczone: za długie" : `Nieumieszczone: ${seconds.toFixed(1)} s za długo`),
  fitLoading: "Wczytywanie tłumaczenia…",
  fitUnreadable: (message: string) => `Nie udało się odczytać tłumaczenia lektora (${message}); ponowny lektor tylko z oryginalnego tłumaczenia`,
  fitMissing: "Tego zdania nie ma w tłumaczeniu; ponowny lektor ze skryptu w planie",
  fitText: (index: number) => `Tłumaczenie zdania ${index}`,
  fitCancel: "Anuluj",
  fitSubmit: (n: number, changed: number) => (changed ? `Edytuj ${changed} i odczytaj ${sentences(n)}` : `Odczytaj ponownie ${sentences(n)}`),
  fitBusy: "Przesyłanie…",

  takesTitle: "Wersje",
  takesAside: (n: number) => takeCount(n),
  takeCurrent: "Bieżąca",
  takeUse: "Przełącz na tę wersję",
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) => [
      seed !== null ? `ziarno ${seed}` : "",
      seconds !== null ? `${seconds.toFixed(1)} s` : "nieumieszczone",
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  takeUnavailable: "Tej wersji nie ma na osi czasu lub nie znaleziono materiału",
  takesNote: "Każda regeneracja zapisuje wersję; powrót do starszej jest zmianą do cofnięcia i nie wykonuje ponownej syntezy.",
  takeName: (k: number) => `Wersja ${k}`,
  labelSwitchTake: (k: number) => `Przełącz na wersję lektora ${k}`,
  switched: (k: number) => `Przełączono na wersję ${k}`,
  regenThis: "Wygeneruj ponownie to zdanie",
  unreadableFormat: "Nierozpoznany format",
  unreadableNoTranslation: "Plan nie ma tłumaczenia",
};
