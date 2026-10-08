import { pluralForm } from '@baocut/protocol';
import type { DubGroupMessages } from './dub-group-copy.ts';

export const fr: DubGroupMessages = {
  track: "Afficher cette piste sur la timeline",
  trackGone: "Ce groupe de doublage n’est plus sur la timeline",
  regen: (n: number) => `Régénérer ${n} ${pluralForm('fr', n, { one: "phrase", other: "phrases" })}…`,
  regenNote: "Phrases non synthétisées ou trop longues · vérifiez-les, modifiez la traduction si nécessaire, puis refaites seulement celles-ci",
  download: "Télécharger le groupe",
  downloadNote: "Le téléchargement de groupes entiers n’est pas encore disponible ; choisissez « Seulement ce groupe de doublage » à l’export audio pour obtenir son mixage",
  redub: "Refaire cette langue",
  redubNote: "Ouvre Doublage traduit",
  remove: "Retirer ce groupe de doublage",
  removeNote: "Retire les clips du groupe de la timeline et restaure l’audio original ; annulable. La piste vide et le plan sont conservés",
  removeLoading: "Chargement du plan de doublage…",
  readOnly: "La vidéo est en lecture seule",
  removed: (title: string) => `Retiré : « ${title} »`,
  rowOnTimeline: (label: string) => `Ligne « ${label} » sur la timeline`,
  undo: "Annuler",
  stateOn: "Sur la timeline",
  stateOff: "Piste désactivée",
  stateGone: "Absente de la timeline",
  groupMenu: "Ce groupe de doublage",
  actionsOf: (title: string) => `Actions pour « ${title} »`,
  clickToSelect: (text: string) => `${text} · cliquez pour le sélectionner sur la timeline`,
};
