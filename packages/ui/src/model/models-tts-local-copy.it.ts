import type { TtsLocalMessages } from './models-tts-local-copy.ts';
import { pluralForm } from '@baocut/protocol';

const voices = (n: number) => pluralForm('it', n, { one: `${n} voce integrata`, other: `${n} voci integrate` });
function languageName(code: string): string {
  try { return new Intl.DisplayNames(['it'], { type: 'language' }).of(code) ?? code; } catch { return code; }
}

export const it: TtsLocalMessages = {
  languageShort: languageName, languagesAny: 'Qualsiasi lingua', languagesMore: (shown: readonly string[], total: number) => `${shown.join(' / ')} e altre (${pluralForm('it', total, { one: `${total} lingua`, other: `${total} lingue` })})`,
  summaryCloneDescribe: (builtins: number, byDuration: boolean) => `${voices(builtins)}, clona una voce da una registrazione o crea una nuova voce scegliendo genere, età e altezza${byDuration ? '; può leggere in una durata desiderata' : ''}`,
  summaryClone: (builtins: number, style: boolean) => `${voices(builtins)} oppure clona una voce da una registrazione${style ? '; un prompt di una riga può impostare lo stile' : ''}`,
  summaryDescribe: (builtins: number) => builtins ? `Descrivi la voce desiderata in una frase e il modello la crea; puoi anche usare direttamente ${voices(builtins)}` : 'Descrivi la voce desiderata in una frase e il modello la crea',
  summaryPreset: (speakers: number, style: boolean) => `${pluralForm('it', speakers, { one: `${speakers} voce preset`, other: `${speakers} voci preset` })}; scegline una e legge${style ? '; un prompt di una riga può impostare il tono' : ''}`,
  modeCloneDescribe: 'Voci integrate / Clona / Descrivi', modeClone: 'Voci integrate / Clona', modeDescribe: 'Voce da descrizione', modePreset: 'Voci preset', factStyle: 'Prompt di stile', factSlow: 'Più lento',
  nonCommercialChip: 'Solo non commerciale', licenseCommercial: (name: string) => `${name} · Uso commerciale consentito`, licenseNonCommercial: (name: string, owner: string) => `${name} · Solo uso non commerciale · Per l’uso commerciale, presenta una richiesta separata a ${owner}`,
  familyDesc: {
    'qwen3-tts': 'Qwen3-TTS: CustomVoice ha 9 parlanti preset e un prompt di una riga può impostare il tono; Base clona da una registrazione di riferimento; 1.7B VoiceDesign crea una nuova voce solo da una descrizione. 1.7B suona meglio ma è più lento.',
    indextts2: 'IndexTTS: otto voci integrate oppure clona una tua registrazione; usa solo il timbro della registrazione e non ne legge la trascrizione. IndexTTS 2.5 può anche regolare la velocità di parlato.',
    'gpt-sovits': 'GPT-SoVITS: otto voci integrate oppure clona una tua registrazione; il suono è più simile se fornisci anche la trascrizione della registrazione di riferimento, che in quel caso deve durare 3–10 secondi.',
    voxcpm2: 'VoxCPM2: otto voci integrate oppure clona una tua registrazione; il suono è più simile con la trascrizione della registrazione e un prompt di una riga può impostare lo stile di parlato; produce 48 kHz.',
    omnivoice: 'OmniVoice: otto voci integrate, clona una tua registrazione o crea una nuova voce scegliendo genere, età e altezza da un elenco di parole; legge il maggior numero di lingue. Solo non commerciale.',
  },
  quickDescribe: 'La voce è determinata interamente da questa descrizione: cambiandola ottieni una persona diversa', quickVoxcpm: 'Circa in tempo reale: una frase richiede per la generazione quanto per la lettura e il primo caricamento richiede circa 5 secondi', quickNonCommercial: (license: string) => `Solo non commerciale (${license}): passa a un altro modello per i contenuti che userai commercialmente`, quickSlow: 'Modello grande: la sintesi è più lenta di modelli simili e il primo caricamento richiede più tempo',
};
