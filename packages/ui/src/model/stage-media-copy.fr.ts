import { pluralForm } from '@baocut/protocol';
import type { MissingAsset } from '@baocut/protocol';
import type { StageMediaMessages } from './stage-media-copy.ts';

export const fr: StageMediaMessages = {
  titles: {
    missing: "Fichier source introuvable",
    changed: "Le fichier source a changé",
    'outside-project': "Le fichier source est hors projet",
    unplayable: "Le fichier source ne peut pas être lu",
  } satisfies Record<MissingAsset['reason'] | 'unplayable', string>,
  causes: {
    missing: "Fichier déplacé, renommé, supprimé ou disque déconnecté possible.",
    changed: "Le fichier n’est plus celui importé (taille différente). Peut-être écrasé ou réexporté.",
    'outside-project': "Emplacement hors du projet de cette vidéo ; BaoCut n’y lit pas les fichiers.",
  } satisfies Record<MissingAsset['reason'], string>,
  unplayable: (error: string) => `Le lecteur ne peut pas ouvrir ce fichier : ${error}.`,

  tail: {
    video: "Sous-titres toujours lus, sans image ni son original.",
    audio: "Sous-titres toujours lus, sans cet audio.",
  },

  body: (cause: string, tail: string) => `${cause} ${tail}`,
  volume: (volume: string) => `Le fichier est sur « ${volume} ». Connectez ce disque pour récupération automatique.`,
  more: (count: number) => `${count} autres médias vidéo ou audio ${pluralForm('fr', count, { one: "média", other: "médias" })} sont aussi illisibles.`,
  relinkHint: "Choisissez l’original pour récupérer. BaoCut vérifie le contenu, différent = reconnexion refusée.",
  desktopOnly: "Ouvrez dans BaoCut bureau et utilisez « Relier à nouveau… » sur le canevas pour choisir l’original.",
  managed: "Fichier stocké dans le dossier vidéo, non reconnectable ailleurs.",
  oldRevision: "La timeline utilise une ancienne version ; seule l’actuelle peut être reconnectée.",
  relink: "Relier…",
  relinking: "Vérification…",
  pickTitle: (name: string) => `Trouver « ${name} »`,
  pickButton: "Relier",
  label: (name: string) => `Relier à nouveau « ${name} »`,
  relinkFailed: (message: string) => `Impossible de relier à nouveau : ${message}`,
  decodeFailed: "Décodage en échec",
  unsupported: "Format non pris en charge",
};
