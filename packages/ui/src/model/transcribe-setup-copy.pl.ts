import { pluralForm } from '@baocut/protocol';
import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';

export const pl: TranscribeSetupMessages = {
  notConnected: "Niepołączony",
  unavailable: "Niedostępne",
  autoDetect: "Wykryj automatycznie",
  hintNoModel: "Nie wiadomo jeszcze, który model mowy zostanie użyty. Wybierz powyżej, aby sprawdzić, czy przyjmuje wskazówki rozpoznawania.",
  hintUnsupported: (model: string, alt: string | null) => `${model} nie przyjmuje wskazówek rozpoznawania, więc słowniki i prompt nie zostaną użyte w tym kroku i będą pominięte przy transkrypcji.${alt ? ` Aby użyć ich przy transkrypcji, wybierz ${alt}.` : ""}`,
  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => { const custom = b.custom ? pluralForm('pl', b.custom, { one: `Prompt: ${b.custom} znak`, few: `Prompt: ${b.custom} znaki`, many: `Prompt: ${b.custom} znaków`, other: `Prompt: ${b.custom} znaku` }) : "brak promptu"; const dropped = b.dropped ? ` · Nie mieści się: ${b.dropped}; słowniki z początku listy są używane najpierw` : ''; return `Wysłano do ${model}: ${custom} + ${pluralForm('pl', b.terms, { one: `${b.terms} termin`, few: `${b.terms} terminy`, many: `${b.terms} terminów`, other: `${b.terms} terminu` })} · przybliżona liczba znaków: ${b.chars} / ${max}${dropped}`; },
  glossaryGone: "Nie ma już w bibliotece słowników · tym razem nie zostanie użyty",
  glossaryTranslation: "Słownik tłumaczenia; nie służy do transkrypcji · tym razem nie zostanie użyty",
  anyLanguage: "Dowolny język",
  termCount: (count: number) => pluralForm('pl', count, { one: `${count} termin`, few: `${count} terminy`, many: `${count} terminów`, other: `${count} terminu` }),
  noDefaultModel: "Nie ma jeszcze domyślnego modelu mowy",
  defaultModel: (label: string) => `${label} (domyślny)`,
  autoDetectLanguage: "Wykrywaj język automatycznie",
  glossaries: (count: number) => pluralForm('pl', count, { one: `${count} słownik`, few: `${count} słowniki`, many: `${count} słowników`, other: `${count} słownika` }),
  hasPrompt: "Z promptem",
  noDefaultFacts: "Nie ma jeszcze domyślnego modelu mowy. Wybierz model lub ustaw domyślny na stronie „Modele”. Jeśli zaczniesz bez wyboru, dowiesz się, czego brakuje.",
  modelUnusable: "Nie można teraz użyć tego modelu",
  acceptsHint: "Przyjmuje wskazówki rozpoznawania",
  noHint: "Bez wskazówek rozpoznawania",
  followDefault: (facts: string) => `Używa domyślnego · ${facts}`,
};
