import type { ProjectsMessages } from './projects-copy.ts';

export const fr: ProjectsMessages = {
  help: `Utilisation :
  baocut projects git-status [<projet>]
                                   État git du projet : dépôt, branche, si BaoCut peut faire un commit
                                   et pourquoi c'est en pause (pour faire un commit, baocut projects git-commit)
  baocut projects git-init [<projet>]
                                   Initialise git dans le dossier du projet (pas dans votre dossier personnel, un dossier
                                   utilisateur standard ou la racine d'un volume, ni dans un autre dépôt)
  baocut projects git-allow [<projet>] [--yes]
                                   Affiche les filtres et include de la configuration locale du dépôt, puis les
                                   autorise : BaoCut n'exécute qu'ensuite les commandes git qui les exécutent
  <projet> est un ID, un nom ou un dossier de projet ; sans lui, le projet qui contient le dossier actuel`,
  noProject: (cwd) => `Aucun projet ne contient ${cwd}. Indiquez un ID, un nom ou un dossier de projet (baocut projects list)`,
  unknownProject: (text) => `Projet introuvable : ${text} (baocut projects list)`,
  ambiguousProject: (text) => `Plusieurs projets s'appellent ${text} ; indiquez son ID`,
  states: {
    ready: 'prêt',
    paused: 'en pause',
    'not-repo': 'pas dans un dépôt git',
    unavailable: 'git indisponible',
    error: 'erreur',
  },
  head: (name, id) => `Projet ${name} (${id})`,
  state: (state) => `Git : ${state}`,
  branch: (branch) => `Branche : ${branch}`,
  detached: 'Branche : (HEAD détachée)',
  version: (version) => `Version de git : ${version}`,
  repo: (root) => `Dépôt : ${root}`,
  autoCommit: (on) => `Commit automatique : ${on ? 'activé' : 'désactivé'}`,
  lastCommit: (commit, auto, at) => `Dernier commit : ${commit.slice(0, 12)} (${auto ? 'automatique' : 'manuel'}, ${at})`,
  lastError: (message) => `Dernière erreur : ${message}`,
  entriesHead: 'Filtres et include locaux :',
  entry: (key, value, file) => `  ${key} = ${value}${file ? `  (${file})` : ''}`,
  allowHint: 'Vérifiez-les, puis lancez baocut projects git-allow pour les autoriser',
  initDone: (root) => `git initialisé dans ${root}`,
  nothingToAllow: "Ce dépôt n'a aucun filtre ni include local en attente d'autorisation",
  allowPrompt: 'Autoriser ces entrées ? BaoCut exécutera les commandes git qui les exécutent [y/N] ',
  notTtyAllow: 'Pas dans un terminal : vérifiez les entrées avec baocut projects git-status, puis relancez avec --yes',
  notAllowed: 'Non autorisé : les commits de BaoCut restent en pause pour ce dépôt',
  allowed: 'Autorisé : BaoCut refait des commits dans ce dépôt',
};
