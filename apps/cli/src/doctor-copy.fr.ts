import type { DoctorMessages } from './doctor-copy.ts';

export const fr: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'Pourquoi BaoCut ne démarre pas ou ne peut pas lire quelque chose : quel baocut les terminaux trouvent, quel',
    'Runtime la CLI démarrerait et avec quel dossier, si le stockage des identifiants répond, et l’Accès complet',
    'au disque sur macOS. Chaque vérification vaut ok, warn, fail ou skip, avec une commande de correction quand',
    'il y en a une ; next est la correction du premier problème. Lecture seule : ne démarre jamais de Runtime et',
    'ne lit aucune clé (la vérification du trousseau demande seulement si une clé inventée existe). Demandez à',
    'l’utilisateur avant d’exécuter les corrections.',
    'Depuis une copie du dépôt, il lance aussi l’autovérification du Runtime, qui démarre une fois chaque programme natif et compare les compilations aux sources.',
    '',
    'Options : --json',
  ].join('\n'),
  checkName: {
    entry: 'Ligne de commande',
    runtime: 'Runtime',
    credentials: 'Identifiants',
    fullDiskAccess: 'Accès complet au disque',
    build: 'Compilation',
  },
  remedyLabel: 'correctif',

  entryApp: (found, version) => `Les terminaux exécutent ${found}, la ligne de commande de l’app BaoCut${version ? ` ${version}` : ''}`,
  entryOtherApp: (found, target, app) =>
    `Les terminaux exécutent ${found} (${target}), pas la ligne de commande de l’app BaoCut située à ${app}`,
  entryNoApp: (found, target) => `Les terminaux exécutent ${found} (${target}) ; aucune app BaoCut trouvée`,
  entryMissing: 'Les terminaux ne trouvent pas baocut. Installez-le depuis l’app BaoCut (aucun droit administrateur nécessaire).',
  entryMissingNoApp: 'Les terminaux ne trouvent pas baocut, et aucune app BaoCut n’a été trouvée aux emplacements habituels',
  entryStandalone: (found, version) => `Les terminaux utilisent ${found}, le paquet autonome de ligne de commande BaoCut ${version}`,
  entryOtherStandalone: (found, target, own) => `Les terminaux utilisent ${found} (${target}), pas un paquet autonome de ligne de commande BaoCut comme ${own}`,
  entryMissingStandalone: 'Les terminaux ne trouvent pas baocut. Installez ce paquet de ligne de commande avec cli install (sans droits d’administrateur).',

  runtimeRunning: (version, pid, by) =>
    `Actif : version ${version}, processus ${pid}, démarré par ${by === 'cli' ? 'la ligne de commande' : 'l’app BaoCut'}`,
  runtimeStopped: (entry) => `Inactif. La prochaine commande le démarre en arrière-plan avec ${entry}`,
  runtimeUnreachable: (pid, reason) => `Un Runtime est actif (processus ${pid}) mais ne répond pas : ${reason}`,
  runtimeNoLaunch:
    'Inactif, et aucun Runtime à démarrer : installez l’app BaoCut, exécutez depuis le dépôt ou définissez BAOCUT_RUNTIME_ENTRY sur le point d’entrée du Runtime.',

  credentialsFile: (file) => `Cette version garde les clés dans un fichier : ${file}`,
  credentialsKeychain: (platform) =>
    platform === 'win32' ? 'Le Gestionnaire d’identification Windows répond' : 'Le trousseau macOS répond',
  credentialsDenied:
    'Le trousseau a refusé l’accès. Via SSH ou sans session ouverte sur le bureau, macOS peut le garder verrouillé : lancez baocut dans un terminal sur le bureau, ou déverrouillez le trousseau « session ».',
  credentialsNoHelper: (file) =>
    `L’assistant d’identification est absent${file ? ` (${file})` : ''} : impossible de lire les clés. Réinstallez l’app BaoCut.`,
  credentialsUnavailable: (reason) => `Impossible d’accéder au stockage des identifiants : ${reason}`,
  credentialsUnknown: 'BAOCUT_RUNTIME_ENTRY détermine où les clés sont gardées ; non vérifié',
  credentialsTimedOut: (seconds) => `l’assistant n’a pas répondu en ${seconds} s`,

  fdaGranted: 'L’Accès complet au disque est activé',
  fdaMissingApp:
    'L’Accès complet au disque est désactivé pour BaoCut.app : les fichiers des emplacements protégés (Bureau, Documents, Téléchargements, autres disques) peuvent être illisibles. Activez BaoCut dans Réglages Système › Confidentialité et sécurité › Accès complet au disque, puis relancez baocut doctor.',
  fdaMissingCli: (app) =>
    `L’Accès complet au disque est désactivé pour le Runtime démarré par la ligne de commande ; macOS l’attribue à ${app ?? 'l’app qui a lancé la commande (votre terminal, ou l’app qui héberge l’agent)'}. Activez cette app dans Réglages Système › Confidentialité et sécurité › Accès complet au disque et rouvrez-la, ou arrêtez ce Runtime (baocut runtime stop) et ouvrez l’app BaoCut ; puis relancez baocut doctor.`,
  fdaMissingOwn: (app) =>
    `L’Accès complet au disque est désactivé pour le Runtime démarré par la ligne de commande. Il s’exécute seul en tant que ${app}, donc macOS l’attribue à ${app}, et non à votre terminal : activez ${app} dans Réglages Système › Confidentialité et sécurité › Accès complet au disque, arrêtez ce Runtime (baocut runtime stop), puis relancez baocut doctor.`,
  fdaNotRunning: 'Vérifié seulement quand un Runtime est actif',
  buildOk: (count) => `Les programmes natifs démarrent et les ${count} compilations correspondent aux sources`,
  buildNotSource: 'Vérifié quand le Runtime s’exécute depuis une copie du dépôt',
  buildFailed: (reason) => `L’autovérification du Runtime ne s’est pas terminée : ${reason}`,
  buildTimedOut: (seconds) => `pas de réponse en ${seconds} s`,
  buildProblems: (count, first) =>
    count === 1 ? `L’autovérification du Runtime a trouvé un problème : ${first}` : `L’autovérification du Runtime a trouvé ${count} problèmes, le premier : ${first}`,
  buildMore: (first, more) => `${first} (et ${more} de plus)`,
};
