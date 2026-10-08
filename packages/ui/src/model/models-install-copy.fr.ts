import type { ModelsInstallMessages } from './models-install-copy.ts';

import { pluralForm } from '@baocut/protocol';
const and = (items: readonly string[]) => new Intl.ListFormat('fr', { type: 'conjunction' }).format(items);
const files = (n: number) => `${n} ${pluralForm('fr', n, { one: 'fichier', other: 'fichiers' })}`;
const KEEP = 'Téléchargements reçus conservés ; la prochaine reprise continue au même point.';
const SOURCE = '« Source de téléchargement des modèles » dans Réglages › Général';

export const fr: ModelsInstallMessages = {

  planSize: (size: string) => `Télécharge ${size}`,
  planSizeEstimate: (size: string) => `À propos de ${size} (certaines tailles inconnues, estimation enregistrée utilisée)`,
  amountEstimate: (size: string) => `À propos de ${size}`,
  noSpace: (need: string, have: string) =>
    `Espace insuffisant : il faut ${need}, disque du dossier des modèles avec seulement ${have} libres. Libérez avant téléchargement.`,
  resumed: (size: string) => `La version de ${size} déjà téléchargés sont réutilisés.`,
  space: (size: string) => `${size} libres sur disque`,
  lineKeep: "Déjà installé, inchangé",
  lineSize: (size: string, count: number) => `${size} · ${files(count)}`,
  lineUnknown: (count: number) => `Taille inconnue · ${files(count)}`,

  queued: "Téléchargement en file",
  downloading: (amount: string) => `Téléchargement de ${amount}`,
  downloadingUnknown: (amount: string) => `Téléchargement · ${amount} reçus`,
  verifying: "Vérification et publication",
  pausedKept: (amount: string) => `Mis en pause · ${amount} conservés ; reprise au même point`,
  paused: "En pause",


  remedyNoSpace: (need: string | null, have: string | null) =>
    `${need !== null && have !== null ? `Nécessite ${need}, seulement ${have} disponibles. ` : ""}Libérez de l’espace puis retéléchargez. ${KEEP}`,
  remedyNetwork: `Vérifiez le réseau puis retéléchargez. ${KEEP} Si source par défaut inaccessible, choisissez un miroir dans ${SOURCE}.`,
  remedyIntegrity: `Taille ou sha256 non conforme au manifeste, fichiers incorrects supprimés. Changez de source (${SOURCE}), puis retéléchargez.`,
  remedySource: `Source sans fichier ou accès refusé. Vérifiez que le miroir défini dans ${SOURCE} (ou BAOCUT_MODELS_ENDPOINT) est complet.`,
  remedyManifest: "Manifeste sans sha256 fiable ; installation après mise à jour de BaoCut seulement.",
  remedyOffline: "Hors ligne strict : aucun téléchargement. Désactivez ce mode dans Réglages pour télécharger.",
  remedySizeChanged: "Taille modifiée. Confirmez le nouveau plan.",
  remedyInUse:
    "Une tâche utilise ce paquet (transcription, synthèse, vérification ou installation). Attendez ou annulez dans Tâches en arrière-plan, puis supprimez.",
  remedyUnavailable:
    "Paquet inutilisable (installation incomplète, désactivé ou incompatible). Réparez ou réactivez d’abord.",
  remedyInstallFailed: `Réessayez le téléchargement. ${KEEP}`,

  problemText: (message: string, remedy: string) => (/[.!?。！？]$/.test(message) ? `${message} ${remedy}` : `${message}. ${remedy}`),


  removalBody: (unknown: boolean, frees: string | null, kept: readonly { repo: string; usedBy: readonly string[] }[]) =>
    [
      unknown ? "Supprime seulement les fichiers propres à ce paquet." : frees !== null ? `Libère environ ${frees}.` : null,
      ...kept.map((k) => `${k.repo} est conservé car ${and(k.usedBy)} l’${pluralForm('fr', k.usedBy.length, { one: "utilise", other: "utilisent" })} encore.`),
      "Pour réutiliser, il faudra retélécharger.",
    ]
      .filter(Boolean)
      .join(" "),
  removed: (bundleId: string) => `Supprimé : ${bundleId}`,
  removedKept: (bundleId: string, repos: readonly string[]) =>
    `Supprimé : ${bundleId} · ${and(repos)} ${pluralForm('fr', repos.length, { one: "reste utilisé par d’autres paquets et a été conservé", other: "restent utilisés par d’autres paquets et ont été conservés" })}`,
};
