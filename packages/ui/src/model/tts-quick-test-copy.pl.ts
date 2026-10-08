import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const pl: TtsQuickTestMessages = {
  kindIntro: "Wstęp",
  kindNumbers: "Liczby",
  kindMood: "Ton",

  presetSub: {
    Vivian: "Kobiecy · Jasny",
    Serena: "Kobiecy · Spokojny",
    Uncle_Fu: "Męski · Głęboki",
    Dylan: "Męski · Młody",
    Eric: "Męski · Spikerski",
    Ryan: "Męski · Energiczny",
    Aiden: "Męski · Narracyjny",
    Ono_Anna: "Kobiecy · Japoński",
    Sohee: "Kobiecy · Koreański",
  },

  builtinVoice: {
    'zh-female': "Chiński kobiecy",
    'zh-male': "Chiński męski",
    'en-female': "Angielski kobiecy",
    'en-male': "Angielski męski",
    'ja-female': "Japoński kobiecy",
    'ja-male': "Japoński męski",
    'es-female': "Hiszpański kobiecy",
    'es-male': "Hiszpański męski",
  },
  builtinCredit: "Korpus FLEURS (CC BY 4.0) i CMU ARCTIC · przycięte i znormalizowane głośnościowo · oryginalne informacje zachowane",

  describeWarm: "Ciepły kobiecy",
  describeWarmText: "Ciepły, przyjazny głos dorosłej kobiety w umiarkowanym tempie, jak rozmowa z przyjacielem",
  describeAnchor: "Spokojny męski",
  describeAnchorText: "Spokojny, wyraźny głos dorosłego mężczyzny ze spikerskim tonem i równym rytmem",
  describeBright: "Jasny młodzieńczy",
  describeBrightText: "Jasny, żywy młody głos ze swobodnym tonem",

  toneUpbeat: "Energiczny",
  toneUpbeatText: "Mów jasno i energicznie, nieco szybciej niż zwykle",
  toneNatural: "Naturalny",
  toneAnchor: "Spokojny",
  toneAnchorText: "Mów spokojnym, wyraźnym głosem spikerskim w równym tempie",
  toneSoft: "Łagodny",
  toneSoftText: "Mów łagodnie i wolniej, jak przy bliskiej rozmowie",

  customDescribe: "Opisz własny",
  defaultVoice: "Domyślny głos",
  myVoices: "Moje głosy",
  fileVoice: "Użyj nagrania jednorazowo",
  seconds: (n: string) => `${n} s`,

  textRequired: "Najpierw wpisz tekst do syntezy",
  textTooLong: (max: number) => `Do ${max} znaków naraz; do podglądu użyj krótszego zdania`,
  describeRequired: "Najpierw opisz wybrany głos jednym zdaniem",
  myVoiceGone: "Tego głosu nie ma już w „Moje głosy”; wybierz inny",
  referenceRequired: "Najpierw wybierz nagranie referencyjne lub wróć do wbudowanego głosu",

  phaseSubmitting: "Przesyłanie",
  phaseQueued: "W kolejce",
  phaseLoading: "Ładowanie modelu",
  phaseGeneratingStep: (step: number, total: number) => `Generowanie audio · krok ${step}/${total}`,
  phaseGenerating: "Generowanie audio",
  phaseWriting: "Zapisywanie audio",
  phasePreparing: "Przygotowywanie",

  sampleVoice: (name: string) => `Próbka · ${name}`,
  customText: "Własny tekst",
  elapsed: (seconds: string) => `Zajęło ${seconds} s`,
  audioLength: (seconds: string) => `Audio ${seconds} s`,
};
