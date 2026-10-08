import { pluralForm } from '../../i18n.ts';
import type { JobsSpeakersMessages } from './speakers.ts';

export const pl: JobsSpeakersMessages = {
  label: "Zidentyfikuj mówców",
  description: "Rozróżnia mówców według głosu w istniejącej transkrypcji wideo (model lokalny, bez ponownej transkrypcji). Wynik jest propozycją; po potwierdzeniu zastosuj ją przez edits.applySpeakers.",
  stepDiarize: "Rozróżnij mówców",
  stepPropose: "Uporządkuj wyniki",
  videoNotOpen: "Wideo nie jest otwarte",
  notFromAsset: "Ta transkrypcja nie należy do materiału w wideo, więc nie można rozróżnić mówców według głosu",
  modelMissing: "Na tym komputerze nie ma modelu rozróżniania mówców",
  modelNotInstalled: "Model rozróżniania mówców nie jest jeszcze zainstalowany. Najpierw go pobierz.",
  transcriptUnreadable: "Nie udało się odczytać transkrypcji",
  videoClosed: "Wideo zostało zamknięte",
  transcriptGone: "Transkrypcja nie jest już w wideo",
  noWords: "Transkrypcja nie zawiera słów",
  untimedWords: "Transkrypcja zawiera słowa bez czasu, więc nie można rozróżnić mówców według głosu",
  sourceMissing: "Nie udało się znaleźć pliku źródłowego materiału",
  hashMismatch: "Suma kontrolna speakers.json nie odpowiada zgłoszonej przez Worker",
  wordCountMismatch: "Liczba słów w speakers.json nie odpowiada transkrypcji",
  transcriptChanged: "Transkrypcja zmieniła się po rozpoznaniu mówców. Rozpoznaj ich ponownie.",
  translationChanged: "Tłumaczenie zmieniło się po rozpoznaniu mówców. Rozpoznaj ich ponownie.",
  unknownSpeaker: "Tego mówcy nie ma w propozycji",
  nameInvalid: (p: { max: number }) => pluralForm('pl', p.max, { one: `Nazwa mówcy nie może być pusta; najwyżej ${p.max} znak`, few: `Nazwa mówcy nie może być pusta; najwyżej ${p.max} znaki`, many: `Nazwa mówcy nie może być pusta; najwyżej ${p.max} znaków`, other: `Nazwa mówcy nie może być pusta; najwyżej ${p.max} znaku` }),
  applyFailed: "Nie udało się zastosować propozycji",
};
