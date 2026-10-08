import type { ModelsDirMessages } from './models-dir-copy.ts';

import { pluralForm } from '@baocut/protocol';
const and = (items: readonly string[]) => new Intl.ListFormat('fr', { type: 'conjunction' }).format(items);
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const models = (n: number) => `${n} ${pluralForm('fr', n, { one: 'modèle', other: 'modèles' })}`;

export const fr: ModelsDirMessages = {

  dir: {
    title: "Dossier des modèles",
    defaultChip: "Par défaut",
    envChip: "Variable d’environnement",
    change: "Changer…",
    restore: "Restaurer le défaut",
    envNote: "Défini par BAOCUT_MODELS_DIR. Modifiez cette variable et redémarrez BaoCut pour changer.",
    shareHint:
      "Si d’autres applications partagent ce dossier, supprimer un modèle efface ses fichiers et le rend introuvable pour elles aussi.",
    blockedPrefix: "Modification indisponible :",
    viewTasks: "Voir les tâches",
    changeTitle: "Changer le dossier des modèles",
    restoreTitle: "Restaurer l’emplacement par défaut",
    restoreLead: "Rétablir le dossier des modèles à",
    checking: "Analyse du dossier…",
    cancel: "Annuler",
    howTo: "Que faire des modèles existants",
    moveOption: "Déplacer les modèles existants",
    switchOption: "Changer seulement l’emplacement",
    confirmMove: "Déplacer et changer",
    confirmSwitch: "Changer l’emplacement",
    movingLabel: "Déplacement des modèles",
    stayOpen: "Ne quittez pas BaoCut pendant ce temps",
    missingDir:
      "Dossier inexistant (disque externe déconnecté possible). Modèles utilisables après connexion, ou choisissez un autre emplacement.",
    notWritableDir: "BaoCut n’a pas le droit d’écrire ici ; téléchargement de modèles impossible.",
    loading: "Lecture du dossier des modèles…",
    pickFailed: (message: string) => `Impossible de choisir le dossier : ${message}`,
    same: "Dossier des modèles déjà actuel",
  },

  stats: (used: string, free: string | null, count: number) =>
    [`${used} utilisés`, ...(free !== null ? [`${free} libres sur disque`] : []), `${models(count)} trouvé`].join(" · "),

  blocker: (downloading: readonly string[], testing: readonly string[], tasks: number) => {
    const parts: string[] = [];
    if (downloading.length) parts.push(`téléchargement de ${and(downloading)}`);
    if (testing.length) parts.push(`vérification de ${and(testing)}`);
    if (tasks) parts.push(`${tasks} ${pluralForm('fr', tasks, { one: "tâche utilise", other: "tâches utilisent" })} des modèles locaux`);
    return `${capitalize(parts.join(" ; "))}. Attendez leur fin avant de changer, pour éviter de déplacer des fichiers utilisés.`;
  },
  missingTitle: "Dossier introuvable",
  missingText: "Dossier inexistant, disque externe peut-être déconnecté ; reconnectez et choisissez à nouveau.",
  notWritableTitle: "Dossier non accessible en écriture",
  notWritableText:
    "BaoCut ne peut pas écrire ici ; téléchargement impossible. Choisissez un dossier accessible ou modifiez ses permissions.",
  nestedTitle: "Emplacement impossible",
  nestedText:
    "Dossiers actuel et nouveau imbriqués. Choisissez un dossier qui ne contient ni n’est contenu par l’autre.",

  found: (count: number, bytes: string, free: string | null) =>
    `${
      count
        ? `Trouvé : ${count} téléchargés ${pluralForm('fr', count, { one: "modèle", other: "modèles" })} (${bytes}), prêts à utiliser.`
        : "Aucun modèle ici. Les prochains téléchargements iront ici."
    }${free !== null ? ` ${free} libres sur disque.` : ""}`,
  moveNoFit: (required: string, free: string, short: string) =>
    `Le déplacement nécessite ${required}, disque cible avec seulement ${free} libres (${short} manquants). Cela ne tient pas.`,
  moveSameVolume: (size: string) => `Déplace ${size} sur le même disque, donc rapidement. Aucun fichier conservé à l’ancien emplacement.`,
  moveOther: (size: string) => `Déplace ${size}. Aucun fichier conservé à l’ancien emplacement.`,

  switchDescription: (count: number) =>
    `Anciens fichiers conservés, non supprimés. Seuls les ${count ? `${models(count)} ` : "modèles "}déjà au nouvel emplacement sont utilisables ; autres signalés non installés.`,
  appliedMoving: (where: string) => `Déplacement démarré vers ${where}`,
  appliedKept: (where: string) => `Dossier des modèles remplacé par ${where} · anciens fichiers conservés`,
  applied: (where: string) => `Dossier des modèles remplacé par ${where}`,

  moveWaiting: (to: string | null) => `Attente de déplacement${to ? ` vers ${to}` : ""}…`,
  moveValidating: (amount: string | null) => `Vérification des fichiers copiés${amount ? ` (${amount})` : ""}…`,
  movePublishing: "Fin du déplacement…",
  moving: (amount: string | null, to: string | null) => `Déplacement${amount ? ` ${amount}` : ""}${to ? ` vers ${to}` : ""}…`,
};
