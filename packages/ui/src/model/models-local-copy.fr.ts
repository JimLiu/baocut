import type { ModelBundleStatus } from '@baocut/protocol';
import type { ModelBundleReason } from '@baocut/protocol';
import type { ModelsLocalMessages } from './models-local-copy.ts';

export const fr: ModelsLocalMessages = {

  reason: {
    unsupported: "Non pris en charge ici",
    resource: "Désactivé",
    'worker-missing': "Model Worker manquant",
    'missing-manifest': "Manifeste manquant",
    'missing-file': "Fichiers manquants",
    'size-mismatch': "Taille de fichier incorrecte",
    'hash-mismatch': "Empreinte incorrecte",
    incomplete: "Composants manquants",
    'load-failed': "Chargement impossible",
    relocating: "Déplacement",
  } as Record<ModelBundleReason, string>,
  chipDefault: "Par défaut",
  chipLoading: "Chargement",
  chipReady: "Chargé",
  chipBusy: "En cours",
  chipUnloading: "Déchargement",
  chipUnavailable: "Indisponible",

  capability: {
    transcribe: "Transcrire",
    align: "Alignement",
    synthesize: "Synthétiser",
    image: "Images",
    separate: "Séparation",
    diarize: "Diarisation des locuteurs",
  } as Record<ModelBundleStatus['capability'], string>,

  auto: "Automatique",

  notInstalled: (name: string) => `${name} (non installé)`,

  componentName: { aligner: "Aligneur forcé", speaker: "Représentation des locuteurs", vad: "VAD (détection d’activité vocale)" } as Record<string, string>,
  weights: "Poids du modèle",
};
