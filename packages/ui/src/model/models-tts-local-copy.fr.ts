import type { TtsLocalMessages } from './models-tts-local-copy.ts';

import { pluralForm } from '@baocut/protocol';
const voices = (n: number) => `${n} ${pluralForm('fr', n, { one: 'voix intégrée', other: 'voix intégrées' })}`;
function languageName(code: string): string { try { return new Intl.DisplayNames(['fr'], { type: 'language' }).of(code) ?? code; } catch { return code; } }

export const fr: TtsLocalMessages = {

  languageShort: languageName,
  languagesAny: "Toute langue",

  languagesMore: (shown: readonly string[], total: number) => `${shown.join(" / ")} et plus (${total} langues)`,

  summaryCloneDescribe: (builtins: number, byDuration: boolean) =>
    `${voices(builtins)}, cloner une référence ou créer une voix par sexe, âge et hauteur${
      byDuration ? " ; peut lire selon une durée cible" : ""
    }`,

  summaryClone: (builtins: number, style: boolean) =>
    `${voices(builtins)} ou cloner depuis une référence${style ? " ; une phrase règle le style" : ""}`,

  summaryDescribe: (builtins: number) =>
    builtins
      ? `Décrivez la voix en une phrase pour la créer ; vous pouvez aussi utiliser directement les ${voices(builtins)}`
      : "Décrivez la voix en une phrase pour la créer",

  summaryPreset: (speakers: number, style: boolean) =>
    `${speakers} prédéfinies ${pluralForm('fr', speakers, { one: "voix", other: "voix" })} ; choisissez et il lit${style ? " ; une phrase règle le ton" : ""}`,
  modeCloneDescribe: "Voix intégrées / Cloner / Décrire",
  modeClone: "Voix intégrées / Cloner",
  modeDescribe: "Voix depuis une description",
  modePreset: "Voix prédéfinies",
  factStyle: "Consigne de style",
  factSlow: "Plus lent",

  nonCommercialChip: "Non commercial uniquement",
  licenseCommercial: (name: string) => `${name} · Usage commercial autorisé`,
  licenseNonCommercial: (name: string, owner: string) =>
    `${name} · Non commercial uniquement · Pour usage commercial, demander à ${owner} séparément`,

  familyDesc: {
    'qwen3-tts':
      "Qwen3-TTS : CustomVoice a 9 locuteurs prédéfinis, ton réglable en une phrase ; Base clone une référence ; 1.7B VoiceDesign crée depuis une description. 1.7B sonne mieux, plus lent.",
    indextts2:
      "IndexTTS : huit voix intégrées ou clonage de votre référence ; reprend seulement le timbre, pas la transcription. IndexTTS 2.5 règle aussi la vitesse.",
    'gpt-sovits':
      "GPT-SoVITS : huit voix intégrées ou clonage ; plus proche avec transcription de référence, qui doit alors durer 3–10 secondes.",
    voxcpm2:
      "VoxCPM2 : huit voix intégrées ou clonage ; plus proche avec transcription, style réglable en une phrase ; sortie 48 kHz.",
    omnivoice:
      "OmniVoice : huit voix intégrées, clonage, ou création depuis sexe, âge, hauteur choisis dans une liste ; le plus de langues. Non commercial seulement.",
  } as Record<string, string>,
  quickDescribe: "Voix entièrement définie par la description ; la changer donne une autre personne",
  quickVoxcpm: "Environ temps réel : génération aussi longue que lecture, premier chargement environ 5 secondes",
  quickNonCommercial: (license: string) => `Non commercial uniquement (${license}) : choisissez un autre modèle pour un usage commercial`,
  quickSlow: "Grand modèle : synthèse plus lente que ses équivalents, premier chargement plus long",
};
