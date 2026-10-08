import { pluralForm } from '@baocut/protocol';
import type { SkillOrigin } from '@baocut/protocol';
import type { SkillAction } from './agent-skills.ts';
import type { AgentSkillsMessages } from './agent-skills.ts';

export const fr: AgentSkillsMessages = {
  origin: { builtin: "Intégré", personal: "Les miens", 'third-party': "Tiers" } as Record<SkillOrigin, string>,
  all: "Tout",
  commit: (sha: string) => ` (${sha})`,
  bytes: (n: number) => (pluralForm('fr', n, { one: `${n} octet`, other: `${n} octets` })),
  action: {
    load: "charger les Skills",
    toggle: "le changer",
    add: "l’ajouter",
    import: "l’importer",
    remove: "le retirer",
    read: "ouvrir le fichier",
    send: "envoyer",
  } as Record<SkillAction, string>,
  exists: (id: string | null) =>
    `Un Skill nommé « ${id ?? "ce"} » existe déjà et ne sera pas écrasé. Retirez l’ancien ou renommez le dossier et ajoutez à nouveau.`,
  invalid: (issue: string) => `Skill inutilisable : ${issue}. La racine nécessite SKILL.md commençant par name et description.`,
  tooLarge: (files: number, total: string, skillFile: string) =>
    `Skill trop volumineux : au plus ${files} fichiers totalisant ${total}, SKILL.md lui-même au plus ${skillFile}.`,
  githubNotFound: "Dépôt, branche ou dossier GitHub introuvable (peut-être privé). Vérifiez l’adresse.",
  folderNotFound: "Dossier introuvable, peut-être déplacé ou supprimé.",
  urlInvalid: "Adresse non reconnue. Utilisez owner/repo ou https://github.com/owner/repo/tree/branch/folder.",
  network: "GitHub inaccessible. Vérifiez le réseau et réessayez.",
  rateLimited: "Limite d’accès anonyme GitHub atteinte. Réimportez plus tard.",
  offline: "Hors ligne strict activé ; import GitHub impossible.",
  builtinNotRemovable: "Skills intégrés non supprimables, mais désactivables.",
  notFound: "Ce Skill a disparu, peut-être retiré à l’instant.",
  fileNotFound: "Ce fichier a disparu.",
  fileTooLarge: "Fichier trop volumineux ici. Ouvrez-le dans son dossier.",
  fileNotText: "Pas un fichier texte, non affiché ici.",
  webNotAllowed: "Indisponible dans le navigateur. Utilisez l’application de bureau BaoCut.",
  webReadOnly: "Session de navigateur en lecture seule, aucune modification.",
  failed: (action: string, raw: string) => `Impossible ${/^[aeiouyàâéèêëîïôöùûüœ]/i.test(action) ? 'd’' : 'de '}${action} : ${raw}`,
  sendFailed: (raw: string) => `Impossible d’envoyer : ${raw}`,
};
