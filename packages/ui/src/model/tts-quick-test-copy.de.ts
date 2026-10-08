import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';

export const de: TtsQuickTestMessages = {
  kindIntro: "Einführung",
  kindNumbers: "Zahlen",
  kindMood: "Ton",


  presetSub: {
    Vivian: "Weiblich · Hell",
    Serena: "Weiblich · Ruhig",
    Uncle_Fu: "Männlich · Tief",
    Dylan: "Männlich · Jung",
    Eric: "Männlich · Rundfunk",
    Ryan: "Männlich · Fröhlich",
    Aiden: "Männlich · Erzählerisch",
    Ono_Anna: "Weiblich · Japanisch",
    Sohee: "Weiblich · Koreanisch",
  } as Readonly<Record<string, string>>,


  builtinVoice: {
    'zh-female': "Chinesisch, weiblich",
    'zh-male': "Chinesisch, männlich",
    'en-female': "Englisch, weiblich",
    'en-male': "Englisch, männlich",
    'ja-female': "Japanisch, weiblich",
    'ja-male': "Japanisch, männlich",
    'es-female': "Spanisch, weiblich",
    'es-male': "Spanisch, männlich",
  } as Readonly<Record<string, string>>,
  builtinCredit: "FLEURS-Korpus (CC BY 4.0) und CMU ARCTIC · gekürzt und in der Lautstärke normalisiert · Originalhinweise beibehalten",

  describeWarm: "Warme Frauenstimme",
  describeWarmText: "Eine warme, freundliche erwachsene Frauenstimme in mäßigem Tempo, wie ein Gespräch mit einer Freundin",
  describeAnchor: "Ruhige Männerstimme",
  describeAnchorText: "Eine ruhige, klare erwachsene Männerstimme mit Rundfunkton und gleichmäßigem Rhythmus",
  describeBright: "Helle junge Stimme",
  describeBrightText: "Eine helle, lebhafte junge Stimme mit entspanntem Ton",

  toneUpbeat: "Fröhlich",
  toneUpbeatText: "Mit heller, fröhlicher Energie sprechen, etwas schneller als üblich",
  toneNatural: "Natürlich",
  toneAnchor: "Gleichmäßig",
  toneAnchorText: "Mit ruhiger, klarer Rundfunkstimme in gleichmäßigem Tempo sprechen",
  toneSoft: "Sanft",
  toneSoftText: "Leise und langsamer sprechen, wie bei einem Gespräch aus der Nähe",

  customDescribe: "Eigene Stimme beschreiben",
  defaultVoice: "Standardstimme",
  myVoices: "Meine Stimmen",
  fileVoice: "Aufnahme einmal verwenden",
  seconds: (n: string) => `${n} s`,

  textRequired: "Zuerst den zu synthetisierenden Text eingeben",
  textTooLong: (max: number) => `Bis zu ${max} Zeichen auf einmal; für eine Vorschau einen kürzeren Satz verwenden`,
  describeRequired: "Zuerst die gewünschte Stimme in einem Satz beschreiben",
  myVoiceGone: "Diese Stimme ist nicht mehr unter „Meine Stimmen“; eine andere auswählen",
  referenceRequired: "Zuerst eine Referenzaufnahme auswählen oder zu einer integrierten Stimme zurückwechseln",

  phaseSubmitting: "Wird gesendet",
  phaseQueued: "In Warteschlange",
  phaseLoading: "Modell wird geladen",
  phaseGeneratingStep: (step: number, total: number) => `Audio wird erzeugt · Schritt ${step}/${total}`,
  phaseGenerating: "Audio wird erzeugt",
  phaseWriting: "Audio wird geschrieben",
  phasePreparing: "Wird vorbereitet",

  sampleVoice: (name: string) => `Beispiel · ${name}`,
  customText: "Eigener Text",
  elapsed: (seconds: string) => `Dauer: ${seconds} s`,
  audioLength: (seconds: string) => `Audio ${seconds} s`,
};
