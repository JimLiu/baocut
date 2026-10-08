import type { TtsQuickTestMessages } from './tts-quick-test-copy.ts';
import { pluralForm } from '@baocut/protocol';

const characters = (n: number) => pluralForm('it', n, { one: `${n} carattere`, other: `${n} caratteri` });

export const it: TtsQuickTestMessages = {
  kindIntro: 'Introduzione', kindNumbers: 'Numeri', kindMood: 'Tono',
  presetSub: { Vivian: 'Femminile · Brillante', Serena: 'Femminile · Calma', Uncle_Fu: 'Maschile · Profonda', Dylan: 'Maschile · Giovane', Eric: 'Maschile · Da notiziario', Ryan: 'Maschile · Vivace', Aiden: 'Maschile · Narrativa', Ono_Anna: 'Femminile · Giapponese', Sohee: 'Femminile · Coreana' },
  builtinVoice: { 'zh-female': 'Femminile cinese', 'zh-male': 'Maschile cinese', 'en-female': 'Femminile inglese', 'en-male': 'Maschile inglese', 'ja-female': 'Femminile giapponese', 'ja-male': 'Maschile giapponese', 'es-female': 'Femminile spagnola', 'es-male': 'Maschile spagnola' },
  builtinCredit: 'Corpus FLEURS (CC BY 4.0) e CMU ARCTIC · rifilato e con volume normalizzato · avvisi originali conservati',
  describeWarm: 'Femminile calorosa', describeWarmText: 'Una voce femminile adulta calorosa e amichevole, a ritmo moderato, come una conversazione con un amico',
  describeAnchor: 'Maschile stabile', describeAnchorText: 'Una voce maschile adulta stabile e chiara, con tono da notiziario e ritmo regolare',
  describeBright: 'Giovane brillante', describeBrightText: 'Una voce giovane brillante e vivace, con tono rilassato',
  toneUpbeat: 'Vivace', toneUpbeatText: 'Parla con energia brillante e vivace, un po’ più veloce del solito', toneNatural: 'Naturale', toneAnchor: 'Stabile', toneAnchorText: 'Parla con una voce da notiziario stabile e chiara, a ritmo regolare', toneSoft: 'Delicato', toneSoftText: 'Parla delicatamente e più lentamente, come in una conversazione ravvicinata',
  customDescribe: 'Descrivi la mia voce', defaultVoice: 'Voce predefinita', myVoices: 'Le mie voci', fileVoice: 'Usa un frammento una volta', seconds: (n: string) => `${n} s`,
  textRequired: 'Inserisci prima il testo da sintetizzare', textTooLong: (max: number) => `Fino a ${characters(max)} alla volta; usa una frase più breve per l’anteprima`, describeRequired: 'Descrivi prima in una frase la voce desiderata', myVoiceGone: 'Questa voce non è più in «Le mie voci»; scegline un’altra', referenceRequired: 'Scegli prima una registrazione di riferimento o torna a una voce integrata',
  phaseSubmitting: 'Invio in corso', phaseQueued: 'In coda', phaseLoading: 'Caricamento del modello', phaseGeneratingStep: (step: number, total: number) => `Generazione audio · passaggio ${step}/${total}`, phaseGenerating: 'Generazione audio', phaseWriting: 'Scrittura audio', phasePreparing: 'Preparazione',
  sampleVoice: (name: string) => `Campione · ${name}`, customText: 'Testo personalizzato', elapsed: (seconds: string) => `Tempo impiegato: ${seconds} s`, audioLength: (seconds: string) => `Audio ${seconds} s`,
};
