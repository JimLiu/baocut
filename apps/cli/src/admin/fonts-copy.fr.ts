import {  type FontFamilyState } from '@baocut/protocol';
import { pluralForm } from '@baocut/protocol';
import type { FontsMessages } from './fonts-copy.ts';

export const fr: FontsMessages = {

  help: `Utilisation :
  baocut fonts [downloaded]        Polices téléchargées (Google Fonts, à la demande) :
                                   famille, graisses, taille, licence et taille totale
  baocut fonts search [text] [--category <category>] [--script <script>] [--limit <n>]
                                   Liste du sélecteur : familles intégrées, sur cet ordinateur et du catalogue,
                                   avec leur état (intégrées, locales, téléchargées, téléchargeables,
                                   téléchargement en cours, échec). Catégories : sans-serif, serif, display, handwriting,
                                   monospace ; écritures : chinese, japanese, korean, latin…
  baocut fonts download <family> [--weights 400,700] [--italic]
                                   Télécharger une famille (normal et gras par défaut) ; progression sur stderr, Ctrl-C
                                   annule. Seuls famille et graisses sont envoyés ; pour les miroirs, voir les réglages
                                   fonts.cssEndpoint et fonts.fileEndpoint ; refusé en mode strictement hors ligne
  baocut fonts remove <family>     Supprimer cette famille téléchargée (refusé si utilisée par un export inachevé)
  baocut fonts clear               Effacer les polices téléchargées (celles utilisées par des exports inachevés sont conservées)`,
  alreadyDownloaded: (family: string) => `« ${family} » est déjà téléchargée`,
  downloadDone: "Téléchargement terminé",
  remedy: (text: string) => `Pour corriger : ${text}`,
  usage:
    "Utilisation : baocut fonts [downloaded] | search [text] [--category <category>] [--script <script>] [--limit <n>] | download <family> [--weights 400,700] [--italic] | remove <family> | clear",
  listSep: ", ",
  categoryChoices: (choices: readonly string[]) => `--category doit être une valeur parmi ${choices.join(", ")}`,
  scriptChoices: (choices: readonly string[]) => `--script doit être une valeur parmi ${choices.join(", ")}`,
  limitRange: "--limit doit être un entier de 1 à 500",
  italicNeedsWeights: "--italic s’utilise avec --weights",
  weightsFormat: "--weights accepte des graisses de 1 à 1000 séparées par des virgules",
  stateLabels: {
    'built-in': "Intégré",
    installed: "Sur cet ordinateur",
    downloaded: "Téléchargé",
    downloadable: "Téléchargeable",
    downloading: "Téléchargement",
    failed: "Échec",
    unavailable: "Indisponible",
  } satisfies Record<FontFamilyState, string>,
  face: (weight: number, italic: boolean) => `${weight}${italic ? " italique" : ""}`,
  noDownloads: "Aucune police téléchargée",
  downloadedTotal: (families: number, faces: number, size: string) =>
    `${families} ${pluralForm('fr', families, { one: "famille", other: "familles" })}, ${faces} ${pluralForm('fr', faces, { one: "graisse", other: "graisses" })}, ${size} au total`,
  noMatches: "Aucune police correspondante",
  failedWithReason: (state: string, message: string) => `${state} (${message})`,
  truncated: (total: number, shown: number) => `(${total} au total, affichage des ${shown})`,
  removed: (count: number, freed: string) => `Supprimé : ${count} ${pluralForm('fr', count, { one: "graisse", other: "graisses" })}, espace libéré : ${freed}`,
  nothingToRemove: "Aucune police à supprimer",
  kept: (count: number, faces: readonly string[]) => `Conservé : ${count} (utilisées par des exports inachevés) : ${faces.join(", ")}`,
};
