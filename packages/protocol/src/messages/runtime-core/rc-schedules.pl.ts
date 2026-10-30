import type { RcSchedulesMessages } from './rc-schedules.ts';

export const pl: RcSchedulesMessages = {
  notFound: (p) => `Nie znaleziono zaplanowanego zadania: ${p.id}`,
  conversationNotFound: (p) => `Nie znaleziono sesji: ${p.id}`,
  conversationArchived: 'Ta sesja jest zarchiwizowana. Przywróć ją z Zarchiwizowanych sesji, zanim ją zaplanujesz.',
  noProject: 'Ta sesja nie należy do projektu, więc nie może za każdym razem otwierać nowej sesji w projekcie.',
  invalid: 'Sprawdź zaplanowane zadanie: wiadomość, częstotliwość i limit uruchomień muszą być poprawne.',
  notActive: 'Teraz można uruchomić tylko aktywne zaplanowane zadanie.',
  resumeArchived:
    'Sesja docelowa jest zarchiwizowana. Przywróć ją z Zarchiwizowanych sesji albo edytuj zadanie, aby za każdym razem otwierało nową sesję.',
  resumeDeleted: 'Sesja docelowa została usunięta. Edytuj zadanie, aby za każdym razem otwierało nową sesję.',
  resumeProjectRemoved: 'Projekt został usunięty z BaoCut, więc nie można w nim otworzyć nowej sesji.',
  resumeCompleted: 'Osiągnięto maksymalną liczbę uruchomień. Najpierw zwiększ limit.',
  runStopped: 'Zatrzymano przed zakończeniem',
};
