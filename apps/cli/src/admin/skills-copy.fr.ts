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

  skillHelp: `Utilisation :
  baocut skill install [--dir <dossier>]… [--agent agents|claude] [--copy]
                                   Installe le skill BaoCut pour les agents externes (comment utiliser BaoCut). Par défaut
                                   dans ~/.agents/skills/baocut (Codex et autres agents) et ~/.claude/skills/baocut (Claude Code),
                                   sous forme de liens vers le skill de l’app BaoCut : il se met à jour avec l’app
    --dir <dossier>                Installe plutôt dans <dossier>/.agents/skills et <dossier>/.claude/skills : n’importe
                                   quel dossier, pas seulement un projet BaoCut ; répétez-le pour plusieurs dossiers
    --agent agents|claude          Un seul des deux : .agents/skills ou .claude/skills
    --copy                         Copie au lieu de lier (une copie ne suit pas les mises à jour : réinstallez)
  baocut skill status              La version du skill dans l’app, où il est installé et si chaque emplacement est à jour,
                                   et la commande baocut de votre terminal
  baocut skill remove [--dir <dossier>]… [--agent agents|claude] [--yes]
                                   Le retire : pour un lien, seul le lien part ; supprimer une copie demande --yes.
                                   Ce qui se trouve dans baocut/ et n’est pas le skill BaoCut n’est jamais remplacé ni supprimé`,
  installedAt: (path, linkTarget) => `Installé dans ${path}${linkTarget ? ` → ${linkTarget}` : ' (copie)'}`,
  takesEffect: 'Pris en compte dans une nouvelle session de l’agent',
  removedAt: (path) => `Retiré de ${path}`,
  removeCopies: (paths) =>
    `${paths.join(', ')} ${paths.length === 1 ? 'est une copie' : 'sont des copies'} : le retrait supprime les fichiers, y compris les modifications faites là. Ajoutez --yes pour supprimer`,
  unknownAgent: (value) => `--agent accepte agents (.agents/skills) ou claude (.claude/skills) : ${value}`,
  fixHint: 'Certaines installations sont obsolètes ou cassées : baocut skill install (avec le même --dir) les répare',
  statusSkill: (version, source, bundled) => `Skill     ${version ?? '?'}  ${source}${bundled ? '' : ' (version de développement : généré par le Runtime)'}`,
  statusCli: (entry) => `CLI       ${entry ?? 'non incluse (version de développement)'}`,
  statusOnPath: (path, target, fromApp) => `Terminal  ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (cette app)' : ' (pas cette app)'}`,
  statusNotOnPath: (command) => `Terminal  baocut n’est pas dans le PATH${command ? ` ; pour l’utiliser dans tout terminal : ${command}` : ''}`,
  statusAddToPath: (dir) => `Terminal  baocut n’est pas dans le PATH ; pour l’utiliser dans tout terminal, ajoutez ${dir} au PATH de votre utilisateur`,
  appOutsideApplications: 'BaoCut ne s’exécute pas depuis le dossier Applications : les liens se cassent si vous déplacez ou supprimez l’app',
  globalHeading: 'Global',
  state: { none: 'Non installé', current: 'À jour', stale: 'Obsolète', broken: 'Lien cassé', foreign: 'Autre chose s’y trouve (laissé tel quel)' },
  mode: { link: 'Lien', copy: 'Copie' },
};
