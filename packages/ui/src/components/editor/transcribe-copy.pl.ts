import { pluralForm } from '@baocut/protocol';
import type { TranscribeSetupMessages } from './transcribe-copy.ts';

export const pl: TranscribeSetupMessages = {
  title: "Ustawienia transkrypcji",
  language: "Język",
  model: "Model mowy",
  manageModels: "Zarządzaj modelami mowy",
  modelsLoading: "Wczytywanie modeli mowy…",
  noDefault: "Nie ma jeszcze domyślnego modelu mowy",
  hint: "Wskazówki rozpoznawania",
  glossary: "Słownik",
  manageGlossary: "Zarządzaj słownikami",
  glossaryLoading: "Wczytywanie słowników…",
  glossaryEmpty: "Nie ma jeszcze słowników transkrypcji. Utwórz w Ustawienia › Słownik, aby zapisać prawidłową pisownię imion i terminów.",
  glossaryFailed: (message: string) => `Nie udało się odczytać słowników włączonych dla tego wideo: ${message}`,
  glossaryNote: "Zaznacz słownik, aby włączyć go dla tego wideo; każda przyszła transkrypcja go użyje. Możesz to cofnąć.",
  glossaryReadOnly: "Nie można teraz edytować wideo, więc nie można zmienić włączonych słowników.",
  glossaryLimit: (n: number) => pluralForm('pl', n, { one: `W wideo można włączyć najwyżej ${n} słownik`, few: `W wideo można włączyć najwyżej ${n} słowniki`, many: `W wideo można włączyć najwyżej ${n} słowników`, other: `W wideo można włączyć najwyżej ${n} słownika` }),
  glossaryOn: (name: string) => `Włączono słownik „${name}” dla tego wideo`,
  glossaryOff: (name: string) => `Wyłączono słownik „${name}”`,
  glossaryWriteFailed: (message: string) => `Nie udało się zmienić włączonych słowników: ${message}`,
  undo: "Cofnij",
  prompt: "Własny prompt",
  promptPlaceholder: "Opcjonalnie. Na przykład: angielski podcast o optymalizacji inferencji LLM, prowadzący Lin Che i gość Zhou Yuan.",
  how: "Prompt i włączone słowniki (prawidłowa pisownia) są przekazywane razem modelowi mowy, aby pomóc rozpoznać imiona i terminy. Po przekroczeniu limitu terminy z końca są pomijane.",
  reuse: "Materiały z transkrypcją używają jej ponownie; te ustawienia dotyczą tylko materiałów wymagających transkrypcji.",
};
