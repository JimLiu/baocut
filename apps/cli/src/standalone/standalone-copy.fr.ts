import type { StandaloneMessages } from './standalone-copy.ts';

export const fr: StandaloneMessages = {
  cliHelp: `Utilisation :
  baocut cli install               Installe ce paquet de ligne de commande pour votre utilisateur et met baocut dans le PATH.
                                   Le paquet est copié dans ~/.local/share/baocut/versions/<version> (Windows :
                                   %LOCALAPPDATA%\\BaoCut\\cli\\versions\\<version>) sauf s’il s’y trouve déjà. macOS : un
                                   lien dans ~/.local/bin/baocut. Windows : %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, avec ce
                                   dossier ajouté au PATH de votre utilisateur. Aucun droit administrateur nécessaire
  baocut cli status                Où se trouve baocut, vers quelle version installée il pointe et quel baocut votre
                                   terminal trouve
  baocut cli remove                Retire ce que baocut cli install a placé ; les versions installées restent. Ce qui se
                                   trouve à cet emplacement sans y avoir été mis par BaoCut n’est jamais remplacé ni supprimé`,
  help: `baocut update [--check | --rollback]

Met à jour le paquet autonome de ligne de commande : lit le même flux de mises à jour que l’app BaoCut, télécharge le
paquet de ligne de commande de la dernière version, vérifie sa taille et son sha256 (et sur macOS sa signature et sa
notarisation), l’installe à côté de la version actuelle et fait pointer baocut vers lui. La version précédente est
conservée pour --rollback ; les plus anciennes qu’aucun Runtime n’utilise plus sont supprimées.
  --check      Indique seulement si une version plus récente est disponible
  --rollback   Revient à la version précédente
Un Runtime déjà en cours d’exécution garde l’ancienne version jusqu’à son arrêt (baocut runtime stop).
Seul le paquet autonome se met à jour ainsi : l’app BaoCut se met à jour elle-même, une installation Homebrew avec brew upgrade.
Définissez BAOCUT_UPDATE_APPCAST pour lire un autre flux (une URL ou un fichier local, pour les tests).`,
  version: (version, build) => `${version} (build ${build})`,
  state: {
    none: 'Non installé',
    current: 'Pointe vers la version actuelle',
    stale: 'Pointe vers un autre BaoCut',
    broken: 'Pointe vers un emplacement qui n’existe plus',
    foreign: 'Autre chose s’y trouve (laissé tel quel)',
  },
  statusPackage: (version, root) => `Paquet    ${version}  ${root}`,
  statusVersions: (versions, root) => `Versions  ${versions.join(', ')}  ${root}`,
  statusNoVersions: (root) => `Rien n’est encore installé dans ${root} : baocut cli install y copie ce paquet`,
  currentMark: ' (actuelle)',
  previousMark: ' (précédente)',
  copied: (dest, from) => `Paquet copié dans ${dest} ; ${from} n’est plus nécessaire`,
  versionsKept: (dir) => `Les versions installées restent dans ${dir} : supprimez ce dossier pour les retirer`,
  entryTaken: (path) =>
    `${path} n’a pas été placé là par BaoCut, il est donc laissé tel quel. Déplacez-le ou supprimez-le vous-même, puis relancez baocut cli install`,
  pathFailed: (dir) =>
    `Impossible d’ajouter ${dir} au PATH de votre utilisateur : ajoutez-le dans Propriétés système → Variables d’environnement`,
  copyFailed: (from, dest, detail) => `Impossible de copier ${from} vers ${dest}${detail ? ` : ${detail}` : ''}`,
  updateUsage: (token) => `baocut update accepte --check ou --rollback (l’un des deux) : ${token}`,
  updateUnavailable:
    'baocut update met à jour le paquet autonome de ligne de commande. Ce baocut appartient à l’app BaoCut, qui se met à jour elle-même (BaoCut → Rechercher des mises à jour), ou à Homebrew (brew upgrade --cask baocut)',
  upToDate: (current) => `À jour : ${current}`,
  available: (latest, current) => `${latest} est disponible (vous avez ${current})`,
  downloading: (version, build, megabytes) => `Téléchargement de ${version} (build ${build}), ${megabytes} Mo…`,
  updated: (from, to) => `Mis à jour : ${from} → ${to}`,
  rolledBack: (from, to) => `Retour de ${from} à ${to}`,
  rollbackHint: 'Pour revenir en arrière : baocut update --rollback',
  entrySwitched: (path) => `${path} pointe maintenant vers cette version`,
  entryNotInstalled: (path) => `${path} n’est pas installé : baocut cli install met baocut dans le PATH`,
  entryLeftAlone: (path) =>
    `${path} pointe vers autre chose que ce paquet et a été laissé tel quel : baocut cli install le fait pointer ici`,
  removedVersions: (versions) => `Anciennes versions supprimées : ${versions.join(', ')}`,
  runtimeStillRunning: (pid) =>
    `Un Runtime (pid ${pid}) utilise encore la version avec laquelle il a démarré ; une fois qu’il s’arrête, la commande suivante lance la nouvelle (baocut runtime stop l’arrête tout de suite)`,
  systemTooOld: (required, system) => `La nouvelle version nécessite macOS ${required} ; ce Mac est sous ${system}`,
  feedFailed: (url, detail) => `Impossible de lire le flux de mises à jour ${url} : ${detail}`,
  feedMissing: (url) =>
    `Le flux de mises à jour ${url} ne contient pas encore de paquet de ligne de commande : réessayez après la prochaine version`,
  downloadFailed: (url, detail) => `Impossible de télécharger ${url} : ${detail}`,
  verifyFailed: (detail) => `Le paquet téléchargé n’a pas passé les vérifications et n’a pas été installé : ${detail}`,
  unsignedBuild:
    'Ce paquet n’est pas signé, il ne peut donc pas vérifier la signature d’une mise à jour. Téléchargez plutôt le paquet autonome depuis la page des versions de BaoCut',
  noPrevious: (dir) => `Aucune version précédente vers laquelle revenir dans ${dir}`,
  inProgress: (pid) => `Un autre baocut update (pid ${pid}) est en cours : attendez qu’il se termine`,
};
