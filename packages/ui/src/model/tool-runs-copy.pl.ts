import { pluralForm } from '@baocut/protocol';
import type { ToolRunsMessages } from './tool-runs-copy.ts';


const spaced = (name: string) => (/^[\x20-\x7e]+$/.test(name) ? ` ${name} ` : name);

export const pl: ToolRunsMessages = {
  diarizeStep: "Zidentyfikuj mówców",

  phaseDone: "Gotowe",
  phaseQueued: "W kolejce",
  phaseCancelled: "Anulowano",
  phaseUnfinished: "Nieukończone",
  phasePreparing: "Przygotowywanie",
  stepAt: (cur, total) => `Krok ${cur} z ${total}`,
  cancelledAt: (step, at) => `Anulowano w kroku „${step}” · ${at}`,
  stoppedAt: (step, at) => `Zatrzymano w kroku „${step}” · ${at}`,
  runningAt: (step, at) => `${step} · ${at}`,
  stepDone: "Gotowe",
  stepStopped: "Zatrzymano tutaj",
  stepRunning: "W toku",
  stepWaiting: "Oczekiwanie",

  costEstimate: (amount, currency) => `O wideo ${amount} ${currency}`,
  costSubscription: (recipient) => `Wliczone w subskrypcję ${recipient}`,
  costFree: "Bezpłatnie",
  costMetered: (recipient) => `Opłaty według stawek ${recipient}; brak szacunku tutaj`,
  grantWhat: (kinds, purpose) => `${kinds.join(", ")} (${purpose})`,
  grantLoop: "Już zatwierdzono, ale Runtime nadal odmawia. Sprawdź uprawnienia w Ustawienia › Prywatność lub wybierz inny model.",

  noStructuredOutput: "Model nie obsługuje wyniku strukturalnego, tłumaczenie niemożliwe",

  captionsCreated: (p) => `Utworzono: ${p.language ? `${p.language} warstwa napisów` : "edytowalna warstwa napisów"}${p.bilingual ? ", widok dwujęzyczny" : ""}${
      p.disabled ? " (materiał już pokazuje napisy, nowa warstwa początkowo wyłączona)" : ""
    }`,
  captionsExistingTranslation: "Tłumaczenie ma już warstwę napisów, nie utworzono nowej",
  captionsExistingTranscript: "Transkrypcja ma już warstwę napisów, nie utworzono nowej",
  captionsNotOnTimeline: "Żaden klip osi czasu nie używa materiału, nie utworzono warstwy napisów",
  captionsEmpty: "Brak napisów do wyświetlenia, nie utworzono warstwy",
  originalAudio: { duck: "Oryginalne audio przyciszone", mute: "Oryginalne audio wyciszone", keep: "Oryginalne audio zachowane" },

  thisVideo: "tego wideo",
  newVideo: "Nowe wideo",
  fallbackVideo: "Wideo",
  media: "multimedia",
  savedFiles: (names) => `Transkrypcja i napisy zapisane: ${names.join(", ")}`,
  transcriptLanguage: (language, model) => `Język transkrypcji: ${language}${model ? ` (${model})` : ""}`,
  createdVideoLinked: (video, project) => `Utworzono wideo „${video}”${project ? ` w „${project}”` : ""}; materiał zostaje na miejscu i jest tylko powiązany`,
  wroteTranscript: (video) => `Dodano transkrypcję do „${video}”`,
  speakersFound: (n) => pluralForm('pl', n, { one: `Znaleziono ${n} mówcę; imiona są w napisach i transkrypcji`, few: `Znaleziono ${n} mówców; imiona są w napisach i transkrypcji`, many: `Znaleziono ${n} mówców; imiona są w napisach i transkrypcji`, other: `Znaleziono ${n} mówcy; imiona są w napisach i transkrypcji` }),
  wroteTranslation: (video, language, source) => `Dodano: ${language} – tłumaczenie w wideo „${video}”${source ? ` (z transkrypcji ${source})` : ""}; oryginał bez zmian`,
  unitCount: (n) => `${n} ${pluralForm('pl', n, { one: `zdanie`, few: `zdania`, many: `zdań`, other: `zdania` })}`,
  subtitleFileWritten: (file, dir) => `Plik przetłumaczonych napisów ${file} zapisano w ${dir}; liczba napisów i kody czasowe bez zmian`,
  bilingualLayout: "Dwujęzycznie: oryginał u góry, tłumaczenie poniżej",
  markupStripped: (n) => pluralForm('pl', n, { one: `Usunięto znaczniki z ${n} oryginalnego napisu`, few: `Usunięto znaczniki z ${n} oryginalnych napisów`, many: `Usunięto znaczniki z ${n} oryginalnych napisów`, other: `Usunięto znaczniki z ${n} oryginalnego napisu` }),
  dubTranslated: (language) => `Przetłumaczono na ${language} najpierw: dodano nowe tłumaczenie`,
  dubReusedTranslation: (language) => `Użyto istniejącego ${language} – tłumaczenie`,
  dubWritten: (video, language, engine) => `Dodano nowy ${language} dubbing w wideo „${video}”${engine ? ` (${engine})` : ""}; wcześniejszy dubbing zachowany`,
  dubPlaced: (placed, total) => `${placed} z ${total} zdań umieszczono na osi czasu`,
  linkCreatedVideo: (video, project) => `Utworzono wideo „${video}”${project ? ` w „${project}”` : ""}; pobrane multimedia są na osi czasu`,
  linkAddedTo: (file, video) => `Dodano: ${file} do „${video}”; plik zostaje w folderze pobierania`,
  linkDownloaded: (file, dir) => `Pobrano: ${file}${dir ? ` do ${dir}` : ""}`,
  linkTranscribedFiles: "Transkrypcja ukończona; zapisano TXT i napisy SRT",
  linkTranscribed: "Transkrypcja ukończona; dodano transkrypcję. Ten sposób nie tworzy warstwy napisów; możesz utworzyć w panelu „Napisy” edytora",
  replacedTranscript: (video) => `Zastąpiono transkrypcję „${video}”: jedna zmiana, którą można cofnąć`,
  newVideoFrom: (video, project, original) =>
    `Utworzono wideo „${video}”${project ? ` w „${project}”` : ''}, połączone z tym samym materiałem; ${original ? `„${original}”` : 'oryginalne wideo'} i jego tłumaczenia się nie zmieniły`,
  carryTranslation: (language, kept, reviewed, stale) =>
    `Tłumaczenie (${language}) · zachowane: ${kept} (sprawdzone: ${reviewed}) · nieaktualne: ${stale}`,
  carryPins: (reanchored, orphaned) => `Piny napisów · ponownie zakotwiczone: ${reanchored} · orphaned: ${orphaned}`,
  carryDub: (language, kept, stale) => `Dubbing (${language}) · zachowane: ${kept} · nieaktualne: ${stale}`,
  nothingToCarry: 'To wideo nie miało tłumaczeń, pinów napisów ani dubbingu do przeniesienia',
  refreshHint: 'Nieaktualne zdania przetłumacz ponownie przez „Odśwież nieaktualne tłumaczenia”',
};
