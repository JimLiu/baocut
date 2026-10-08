import type { ModelsProbeMessages } from './models-probe-copy.ts';
import { pluralForm } from '@baocut/protocol';

const plural = (n: number, one: string, many: string) => `${n} ${pluralForm('fr', n, { one, other: many })}`;

export const fr: ModelsProbeMessages = {

  speechText: "Bonjour, ceci est un test de synthèse vocale BaoCut.",
  noResult: "Tâche terminée mais aucun résultat reçu.",
  failed: "Échec de la tâche.",
  cancelled: "Tâche annulée.",
  interrupted: "Runtime redémarré ; test inachevé.",
  unknownOutcome: "Runtime redémarré avant réponse ; résultat inconnu.",

  audioFacts: (seconds: string, khz: number, type: string) => `${seconds} s · ${khz} kHz · ${type}`,
  videoFacts: (width: number, height: number, seconds: string, type: string) => `${width} × ${height} · ${seconds} s · ${type}`,
  textFacts: (entries: number, seconds: string, type: string) => `${plural(entries, "entrée", "entrées")} · ${seconds} s · ${type}`,
  packageFacts: (files: number, type: string) => `${plural(files, "fichier", "fichiers")} · ${type}`,
  projectFacts: (clips: number, seconds: string, type: string) => `${plural(clips, "clip", "clips")} · ${seconds} s · ${type}`,

  chars: (count: string) => `${count} caractères`,
  inputTokens: (count: string) => `${count} tokens d’entrée`,
  outputTokens: (count: string) => `${count} tokens de sortie`,
  hitLimit: "Limite de sortie atteinte",
  filtered: "Bloqué par le filtre de contenu du fournisseur",

  untested: "Non testé",
  testing: "Test en cours…",
  passed: "Test réussi",
  passedIn: (seconds: number) => `Test réussi · ${seconds} s`,
};
