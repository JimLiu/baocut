import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const nl: TtsQuickTestMessages = {
  kindIntro: "Intro",
  kindNumbers: "Getallen",
  kindMood: "Toon",


  presetSub: {
    Vivian: "Vrouwelijk · Helder",
    Serena: "Vrouwelijk · Kalm",
    Uncle_Fu: "Mannelijk · Diep",
    Dylan: "Mannelijk · Jong",
    Eric: "Mannelijk · Omroep",
    Ryan: "Mannelijk · Vrolijk",
    Aiden: "Mannelijk · Vertellend",
    Ono_Anna: "Vrouwelijk · Japans",
    Sohee: "Vrouwelijk · Koreaans",
  } as Readonly<Record<string, string>>,


  builtinVoice: {
    'zh-female': "Chinees, vrouwelijk",
    'zh-male': "Chinees, mannelijk",
    'en-female': "Engels, vrouwelijk",
    'en-male': "Engels, mannelijk",
    'ja-female': "Japans, vrouwelijk",
    'ja-male': "Japans, mannelijk",
    'es-female': "Spaans, vrouwelijk",
    'es-male': "Spaans, mannelijk",
  } as Readonly<Record<string, string>>,
  builtinCredit: "FLEURS-corpus (CC BY 4.0) en CMU ARCTIC · ingekort en op luidheid genormaliseerd · oorspronkelijke vermeldingen behouden",

  describeWarm: "Warme vrouwenstem",
  describeWarmText: "Een warme, vriendelijke volwassen vrouwenstem in een gematigd tempo, alsof je met een vriendin praat",
  describeAnchor: "Rustige mannenstem",
  describeAnchorText: "Een rustige, heldere volwassen mannenstem met een omroeptoon en gelijkmatig ritme",
  describeBright: "Heldere jonge stem",
  describeBrightText: "Een heldere, levendige jonge stem met een ontspannen toon",

  toneUpbeat: "Vrolijk",
  toneUpbeatText: "Spreek met heldere, vrolijke energie, wat sneller dan normaal",
  toneNatural: "Natuurlijk",
  toneAnchor: "Gelijkmatig",
  toneAnchorText: "Spreek met een rustige, heldere omroepstem in een gelijkmatig tempo",
  toneSoft: "Zacht",
  toneSoftText: "Spreek zacht en langzamer, alsof je dichtbij praat",

  customDescribe: "Eigen stem beschrijven",
  defaultVoice: "Standaardstem",
  myVoices: "Mijn stemmen",
  fileVoice: "Een opname eenmalig gebruiken",
  seconds: (n: string) => `${n} s`,

  textRequired: "Voer eerst de tekst in om te synthetiseren",
  textTooLong: (max: number) => `Maximaal ${max} tekens tegelijk; gebruik een kortere zin voor een voorbeeld`,
  describeRequired: "Beschrijf eerst de gewenste stem in één zin",
  myVoiceGone: "Deze stem staat niet meer bij Mijn stemmen; kies een andere",
  referenceRequired: "Kies eerst een referentieopname of ga terug naar een ingebouwde stem",

  phaseSubmitting: "Verzenden",
  phaseQueued: "In wachtrij",
  phaseLoading: "Model laden",
  phaseGeneratingStep: (step: number, total: number) => `Audio genereren · stap ${step}/${total}`,
  phaseGenerating: "Audio genereren",
  phaseWriting: "Audio schrijven",
  phasePreparing: "Voorbereiden",

  sampleVoice: (name: string) => `Voorbeeld · ${name}`,
  customText: "Eigen tekst",
  elapsed: (seconds: string) => `Duur: ${seconds} s`,
  audioLength: (seconds: string) => `Audio ${seconds} s`,
};
