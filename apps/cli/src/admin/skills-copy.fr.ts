import { pluralForm } from '@baocut/protocol';
import type { SkillsMessages } from './skills-copy.ts';

export const fr: SkillsMessages = {
  skillsHelp: `Utilisation :
  baocut skills add <folder>       Copier un dossier de Skill local (SKILL.md à sa racine)
                                   dans <BAOCUT_HOME>/skills, activé par défaut
  baocut skills import <source>    Importer un Skill depuis GitHub : owner/repo, URL du dépôt ou
                                   …/tree/<branch>/<folder> ; désactivé par défaut, vérifiez-le avant activation
    --id <id>                      Pour add et import : autre identifiant (nom du dossier par défaut ;
                                   refusé s’il existe déjà, jamais écrasé)
  baocut skills enable|disable <id>
                                   Activer / désactiver un Skill : effet à la prochaine nouvelle session d’Agent
  baocut skills remove <id>        Supprimer un Skill ajouté ou importé (ceux intégrés peuvent seulement être désactivés)`,
  added: "Ajouté",
  imported: "Importé",
  turnedOn: "Activé",
  turnedOff: "Désactivé",
  reviewFirst: (id: string) => `Vérifiez-le d’abord (baocut skills read ${id}), puis activez-le avec baocut skills enable ${id}`,
  takesEffectNextSession: "Prend effet à la prochaine nouvelle session d’Agent ; les sessions en cours ne sont pas affectées",
  removed: (id: string, path: string) => `Supprimé : ${id} (${path})`,
  localSource: (path: string, addedAt: string) => `dossier local ${path} (${addedAt})`,
  remoteSource: (url: string, ref: string, commit: string, importedAt: string) => `${url} (${ref}@${commit}, ${importedAt})`,
  changed: (verb: string, id: string, name: string, enabled: boolean, path: string, source: string | null) =>
    `${verb} ${id} (${name}, ${enabled ? "activé" : "désactivé"}) → ${path}${source ? `\nSource : ${source}` : ""}`,
  idFormat: (flag: string, value: string) => `${flag} nécessite un identifiant de Skill (minuscules séparées par des tirets, voir baocut skills) : ${value}`,

  skillHelp: `Utilisation :
  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <folder>] [--link] [--yes]
                                   Installer le Skill BaoCut pour Agents externes (utilisation de BaoCut) dans baocut/
                                   du dossier de Skills de l’hôte : Claude Code ~/.claude/skills, Codex ~/.codex/skills,
                                   Cursor ~/.cursor/skills, Gemini CLI ~/.gemini/skills
    --dir <folder>                 Utiliser un autre dossier de Skills (installation dans son sous-dossier baocut/) ; requis sans --agent
    --link                         Placer le Skill rendu dans <BAOCUT_HOME>/agent-skills/baocut et un lien dans l’hôte :
                                   une nouvelle installation ultérieure (pour tout hôte) les met tous à jour
    --yes                          Remplacer la cible existante (pour un lien, seul le lien est remplacé, pas le dossier
                                   ciblé) ; sans cette option, aucun écrasement
  baocut skill path                Source du Skill BaoCut, emplacement d’installation par hôte et état actuel
                                   (ne nécessite pas le Runtime)`,
  targetExists: (target: string, linkTarget: string | null) =>
    `${target} existe déjà (${linkTarget !== null ? `un lien vers ${linkTarget}` : "un dossier ou fichier"}) ; rien n’a été modifié. Ajoutez --yes pour le remplacer`,
  installed: (target: string, files: number, linkTo: string | null) =>
    `Skill BaoCut installé dans ${target} (${files} ${pluralForm('fr', files, { one: "fichier", other: "fichiers" })}${linkTo ? `, lié à ${linkTo}` : ""})`,
  takesEffect: (host: string | null) => (host ? `Prend effet dans une nouvelle session ${host}` : "Prend effet dans une nouvelle session"),
  pathEscapes: (path: string) => `Un chemin du Skill BaoCut pointe hors de son dossier : ${path}`,
  sourceLine: (dir: string | null) =>
    `Source    ${dir ?? "introuvable (BaoCut n’est pas installé et ce n’est pas le dépôt ; vous pouvez définir BAOCUT_AGENT_SKILLS_DIR)"}`,
  notInstalled: "Non installé",
  linkState: (target: string) => `Lien → ${target}`,
  installedFolder: "Installé (dossier)",
  isFile: "Un fichier (pas un dossier de Skill)",
};
