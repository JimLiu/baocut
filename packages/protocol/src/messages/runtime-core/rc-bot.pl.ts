import { pluralForm } from '../../i18n.ts';
import type { RcBotMessages } from './rc-bot.ts';

const minutesGen = (n: number) => `${n} ${pluralForm('pl', n, { one: 'minuty', few: 'minut', many: 'minut', other: 'minuty' })}`;

export const pl: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Wszystko',
  channelNotFound: (p: { id: string }) => `Nie znaleziono kanału: ${p.id}`,
  mainChannelLocked: 'Kanału domyślnego nie można zarchiwizować ani usunąć.',
  channelArchived: 'Ten kanał jest zarchiwizowany. Przywróć go, aby dalej tu pracować.',
  channelDeleteCountsChanged: 'Liczba zadań lub zaplanowanych zadań w tym kanale się zmieniła. Sprawdź ponownie przed usunięciem.',
  memoryVersionConflict: 'Pamięć zmieniła się od czasu jej otwarcia. Przejrzyj najnowszą wersję i spróbuj ponownie.',
  memoryTooLarge: (p: { max: number }) => `Pamięć może mieć najwyżej ${p.max} KB. Uporządkuj ją, zanim dodasz więcej.`,
  memorySensitive: 'Nie zapisuj w pamięci kluczy, haseł, numerów dokumentów tożsamości ani numerów kart.',
  accessAboveChannelMax: 'Tryb dostępu zadania nie może być wyższy niż limit kanału.',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `Nie znaleziono zadania: ${p.id}`,
  workItemCursorInvalid: 'Pozycja na liście zadań jest nieprawidłowa. Wczytaj listę ponownie.',
  transitionDenied: (p: { from: string; event: string }) => `To zadanie nie może wykonać „${p.event}”, gdy jest w stanie ${p.from}.`,
  textHasLinkOrNumber: 'Tekst zadania nie powinien zawierać linków, adresów e-mail ani długich numerów. Umieść je w zasobach.',
  titleByUser: 'Ten tytuł został napisany przez Ciebie, więc agent nie może go zmienić.',
  userTasksNoThread: 'Twoje własne zadania nie uruchamiają wątku.',
  stoppedByYou: 'Zatrzymano przez Ciebie.',
  continueOrStop: 'Kontynuować czy zatrzymać?',
  optionContinue: 'Kontynuuj',
  optionStop: 'Zatrzymaj',
  stalledNoProgress: (p: { minutes: number }) => `Brak postępu od ${minutesGen(p.minutes)}.`,
  stalledJobHung: (p: { job: string }) => `${p.job} milczy znacznie dłużej, niż oczekiwano.`,
  stalledBudget: 'To zadanie zużyło 80% swojego budżetu.',
  interruptedOnExit: 'Przerwano przy ostatnim zamknięciu BaoCut.',
  threadLost: 'Brakuje wątku tego zadania.',
  agentUnavailable: (p: { agent: string }) => `${p.agent} jest teraz niedostępny, więc to zadanie nie mogło ruszyć. Sprawdź to w Ustawieniach, a potem kontynuuj.`,
  needsYouToRun: (p: { agent: string }) => `Ten krok wymaga Twojej obecności: ${p.agent} nie może prosić o zatwierdzenie krok po kroku. Kontynuować teraz?`,
  approvalWaiting: (p: { summary: string }) => `Czeka na Twoje zatwierdzenie: ${p.summary}`,
  youAnswered: (p: { text: string }) => `Twoja odpowiedź: ${p.text}`,
  youConfirmedDone: 'Potwierdzono przez Ciebie, że gotowe.',
  youReopened: 'To zadanie zostało przez Ciebie ponownie otwarte.',
  previousQuestion: (p: { text: string }) => `Wcześniejsze pytanie: ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `Wątek zmienił ${p.what} po rozwiązaniu zadania.`,
  movedFrom: (p: { channel: string }) => `Przeniesiono z ${p.channel}.`,
  queued: (p: { position: number }) => `Czeka na wolne miejsce (nr ${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `${p.video} w wersji ${p.version} zawiera Twoje zmiany, więc nie można cofnąć wyłącznie zmian agenta.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `Wersja ${p.version} pliku ${p.video} łączy Twoje zmiany ze zmianami agenta, więc nie można cofnąć wyłącznie zmian agenta.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title}: ${p.headline}`,
  reminder: (p: { title: string }) => `Przypomnienie: ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `Termin „${p.title}” minął ${p.date}. Zadanie jest nadal otwarte.`,
  reminderStale: (p: { title: string; days: number }) =>
    `„${p.title}” czeka na Ciebie od ${p.days} ${pluralForm('pl', p.days, { one: 'dnia', few: 'dni', many: 'dni', other: 'dnia' })}.`,
  welcome:
    'Powiedz, co chcesz zrobić ze swoimi filmami, a ja się tym zajmę. Dam znać, gdy coś będzie wymagało Twojej uwagi.',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Widzę ${p.projects} ${pluralForm('pl', p.projects, { one: 'projekt', few: 'projekty', many: 'projektów', other: 'projektu' })} i ${p.videos} ${pluralForm('pl', p.videos, { one: 'film', few: 'filmy', many: 'filmów', other: 'filmu' })}. Powiedz, co chcesz zrobić, a ja się tym zajmę.`,
  starterSummarize: 'Podsumuj film',
  starterSummarizeText: 'Podsumuj mój najnowszy film',
  starterCaptions: 'Dodaj napisy',
  starterCaptionsText: 'Dodaj napisy do mojego najnowszego filmu',
  starterHighlights: 'Znajdź najlepsze momenty',
  starterHighlightsText: 'Znajdź najlepsze momenty w moim najnowszym filmie',
  channelIntro: (p: { name: string; purpose: string }) => `Ten kanał służy do: ${p.purpose}. Powiedz, co tu zrobić, a całą pracę zostawię w tym kanale.`,
  channelIntroNoPurpose: (p: { name: string }) => `To kanał ${p.name}. Powiedz, do czego służy i od czego zacząć.`,
  starterChannelPlan: 'Zaproponuj pierwsze zadania',
  starterChannelPlanText: (p: { subject: string }) => `Zaproponuj pierwsze zadania dla: ${p.subject}`,
  starterChannelLatest: 'Użyj mojego najnowszego filmu',
  starterChannelLatestText: (p: { subject: string }) => `Użyj mojego najnowszego filmu dla: ${p.subject}`,
  starterChannelGoal: 'Opowiedz więcej',
  starterChannelGoalText: 'Więcej o tym, do czego służy ten kanał: ',
  markDone: 'Oznacz jako gotowe',
  handoffDriver: (p: { agent: string }) => `Kontynuujemy z ${p.agent}.`,
  editedMessage: 'Ta wiadomość została przez Ciebie edytowana.',
  reactionYes: 'Tak',
  reactionNo: 'Nie',
  approvalNeedsYou: 'Czeka na Ciebie zatwierdzenie.',
  makeNoGenerator: 'Nie skonfigurowano modelu tekstowego, więc sugestie są niedostępne.',
  scheduleNotReady: 'Zaplanowane zadania są teraz niedostępne.',
  proposalChannelExists: 'Kanał o tej nazwie już istnieje.',
  dependencyWaiting: (p: { title: string }) => `Czeka na „${p.title}”.`,
  lateStart: (p: { minutes: number }) => `Rozpoczęto z opóźnieniem ${minutesGen(p.minutes)}.`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `„${p.title}” jest gotowe do przejrzenia`,
  notifyNeedsInput: (p: { title: string }) => `„${p.title}” wymaga Twojej odpowiedzi`,
  notifyStalled: (p: { title: string }) => `„${p.title}” utknęło`,
  notifyReminder: (p: { title: string }) => `Przypomnienie: ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'Ta karta nie jest już dostępna.',
  proposalHandled: 'Ta karta została już obsłużona.',
  chipStale: 'Te sugestie są nieaktualne.',
  userOnly: 'Tylko użytkownik może to zrobić.',
  notReady: 'Tryb Bota nie jest jeszcze gotowy.',
  automationPaused: 'Automatyzacja jest wstrzymana.',
};
