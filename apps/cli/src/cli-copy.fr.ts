import type { CliMessages } from './cli-copy.ts';

export const fr: CliMessages = {

  helpTagline:
    "baocut — transcrire, traduire, monter, doubler et exporter des vidéos avec BaoCut. Exécutez d’abord `baocut status` pour voir les capacités de cet ordinateur.",
  helpFlows: "Flux (renvoient un traitement ; attendent sa fin par défaut)",
  helpObjects: "Objets",
  helpAdmin: "Administration locale (pour les personnes ; les Agents demandent d’abord à l’utilisateur)",
  helpMore: "Plus",
  helpMoreHelp: "paramètres, effet et exemples",
  helpMoreSpec: "catalogue lisible par machine (JSON)",
  helpMoreStatus: "capacités actuelles de cet ordinateur",
  helpGlobalFlags: "--json --project <dir> --yes --max-bytes <n> --result-file <file> --no-start",
  helpJobFlags: "traitements : --no-wait --timeout <s> --progress jsonl",
  helpAdminVerbs: "Administration locale",
  helpGroupMore: (noun: string) => `baocut help ${noun} <command> pour les paramètres et exemples.`,
  helpFlagsPlaceholder: "[options]",
  effectLabel: (effect: string) => `effet : ${effect}`,
  effectQuery: "requête (lecture seule)",
  effectMutation: "mutation (modifie l’état)",
  effectJob: "traitement (renvoie un traitement ; attend sa fin par défaut)",
  effectDestructive: "destructif (irréversible ; nécessite --yes)",
  helpParameters: "Réglages",
  helpNoParameters: "(aucun)",
  helpRequired: "obligatoire",
  helpRepeatable: "répétable",
  helpPositionalNote: (positional: string, flag: string) =>
    `${positional} peut être indiqué comme argument positionnel ou via ${flag}, pas les deux.`,
  helpExamples: "Exemples",
  helpCommonFlags: "Options communes",

  nextLabel: "suite",
  errorLabel: "erreur",
  runtimeStartedNote: "(Runtime BaoCut démarré en arrière-plan ; il se ferme automatiquement lorsqu’il est inactif)",
  spilledNote: (maxBytes: number) =>
    `Le résultat dépasse ${maxBytes} octets : le résultat complet est dans le fichier path (JSON). coverage liste ses clés principales et les longueurs des tableaux, summary ses champs courts. Lisez le fichier, précisez la requête avec les options de continueWith.paging, ou relancez avec --max-bytes continueWith.maxBytes.`,
  resultFileWritten:
    "Le résultat complet est dans le fichier path (JSON), conformément à --result-file. coverage liste ses clés principales et les longueurs des tableaux, summary ses champs courts.",

  unknownCommand: (command: string) => `Commande inconnue : ${command}. Exécutez baocut --help pour voir les commandes.`,
  unknownFlag: (flag: string, command: string) => `Option inconnue ${flag} pour baocut ${command}. Voir baocut help ${command}.`,
  missingValue: (flag: string) => `${flag} nécessite une valeur.`,
  noValueExpected: (flag: string) => `${flag} est une option sans valeur.`,
  duplicateFlag: (flag: string) => `${flag} a été indiqué plusieurs fois.`,
  badNumber: (flag: string, value: string) => `${flag} nécessite un nombre, reçu « ${value} ».`,
  badInteger: (flag: string, value: string) => `${flag} nécessite un entier, reçu « ${value} ».`,
  badBoolean: (flag: string, value: string) => `${flag} nécessite true ou false, reçu « ${value} ».`,
  badChoice: (flag: string, value: string, choices: readonly string[]) => `${flag} doit être une valeur parmi ${choices.join(", ")} ; reçu « ${value} ».`,
  badValue: (flag: string, value: string) => `« ${value} » n’est pas une valeur valide pour ${flag}.`,
  badJson: (flag: string, reason: string) => `${flag} nécessite du JSON (valeur littérale, @file ou - pour stdin) : ${reason}`,
  expectedObject: (flag: string) => `${flag} nécessite un objet JSON.`,
  readFileFailed: (flag: string, file: string, reason: string) => `Impossible de lire ${file} pour ${flag} : ${reason}`,
  stdinTwice: (flag: string) => `L’entrée standard ne peut être lue qu’une fois (${flag} l’a demandée à nouveau).`,
  noPositional: (command: string, value: string) => `baocut ${command} n’accepte aucun argument positionnel (reçu « ${value} ») ; utilisez les options.`,
  tooManyPositionals: (command: string, extra: string) => `baocut ${command} accepte un seul argument positionnel ; en trop : ${extra}`,
  positionalAndFlag: (field: string, flag: string) => `${field} a été indiqué comme argument positionnel et via ${flag} ; choisissez une seule forme.`,
  missingRequired: (names: string, command: string) => `Manquant : ${names}. Voir baocut help ${command}.`,
  dryRunUnsupported: (command: string) => `baocut ${command} ne dispose pas de --dry-run.`,
  projectNotDirectory: (value: string) => `--project ${value} n’est pas un dossier.`,
  confirmationRequired: (command: string, summary: string) =>
    `baocut ${command} est irréversible et n’a pas été exécuté. Son effet serait : ${summary} Relancez avec --yes après accord de l’utilisateur.`,
  confirmationNext: (command: string) => `baocut ${command} … --yes (après accord de l’utilisateur)`,
  unknownSpec: (name: string) => `Aucun outil nommé ${name}. baocut spec liste tout le catalogue.`,
  unknownEditOp: (op: string) => `edits apply n’a aucune opération nommée ${op}. baocut edits ops les liste.`,
  catalogUnavailable: (command: string) =>
    `L’instantané du catalogue hors ligne manque et aucun Runtime n’est en cours. Générez-le avec \`${command}\` (dans le dépôt), ou démarrez le Runtime avec baocut runtime ensure.`,
  runtimeUsage: "Utilisation : baocut runtime ensure | status | stop",
  installConfirmationRequired: (bundleId: string, size: string, source: string) =>
    `L’installation du modèle local ${bundleId} télécharge ${size} depuis ${source} ; rien n’a été téléchargé. Indiquez la taille à l’utilisateur et relancez avec --yes après son accord.`,
  sizeEstimated: " (estimation)",

  metaHelp: {
    help: "baocut help [<command>]\n\nSans commande : aperçu sur un écran. Avec une commande (`help videos`, `help videos inspect`, `help runtime`) : paramètres, effet et exemples. Utilise le catalogue du Runtime actif, sinon l’instantané hors ligne ; ne démarre jamais de Runtime.",
    spec: "baocut spec [<name>]\n\nCatalogue lisible par machine en JSON brut (sans enveloppe), avec sa version d’interface. <name> peut être un nom d’outil (videos_inspect), un nom à points (videos.inspect), une commande (videos inspect) ou edits.<operation> pour une opération de edits apply. Utilise le catalogue du Runtime actif, sinon l’instantané hors ligne ; ne démarre jamais de Runtime.",
    version:
      "baocut version\n\nVersions de cette CLI et du Runtime s’il est actif, avec les deux versions d’interface des outils et leur correspondance. JSON brut ; ne démarre jamais de Runtime.",
    status:
      "baocut status [--full] [--no-start]\n\nCapacités actuelles de cet ordinateur : Runtime, capacités avec leur valeur par défaut et disponibilité, paquets de modèles locaux et outils externes, avec des commandes pour corriger ce qui manque. Capacités et paquets sont résumés ; --full ajoute chaque fournisseur avec ses modèles, paramètres et limites, et les détails des paquets. Démarre le Runtime s’il est arrêté ; --no-start renvoie plutôt running: false.",
    runtime: [
      "baocut runtime ensure | status | stop",
      "",
      "Le Runtime BaoCut utilisé par cette CLI (un par BAOCUT_HOME).",
      "  ensure   trouver le Runtime actif ou en démarrer un en arrière-plan ; un Runtime démarré par la CLI se ferme automatiquement",
      "           après runtime.idleExitMinutes d’inactivité (aucune connexion, aucun traitement ni service ouvert)",
      "  status   état, initiateur, connexions, traitements actifs, services ouverts et arrêt sur inactivité ; ne démarre jamais de Runtime",
      "  stop     arrêter le Runtime démarré par la CLI. RUNTIME_NOT_OWNED si l’application de bureau ou une autre personne l’a démarré,",
      "           RUNTIME_IN_USE si l’application de bureau, une autre CLI ou un traitement inachevé l’utilise (code de sortie 1)",
      "",
      "Options : --json  --no-start (ensure : échec avec code de sortie 3 au lieu d’un démarrage)",
    ].join("\n"),
  } as Record<'help' | 'spec' | 'version' | 'status' | 'runtime', string>,

  runtimeNotRunning: (home: string) => `Aucun Runtime BaoCut actif pour ${home}, et --no-start a été indiqué.`,
  runtimeNoEntry:
    "Aucun Runtime BaoCut actif et démarrage impossible : installez l’application BaoCut, exécutez depuis le dépôt ou définissez BAOCUT_RUNTIME_ENTRY sur le point d’entrée du Runtime.",
  runtimeStartFailed: (reason: string, log: string) => `Impossible de démarrer le Runtime BaoCut (${reason}). Voir ${log}.`,
  runtimeStartTimeout: (seconds: number, log: string) => `Le Runtime BaoCut n’est pas devenu prêt dans les ${seconds} s. Voir ${log}.`,
  exitedWith: (code: number | null) => `il s’est arrêté avec le code ${code ?? "inconnu"}`,
  runtimeConnectFailed: (reason: string) => `Impossible de se connecter au Runtime BaoCut : ${reason}`,
  runtimeLost: (reason: string) => `Connexion au Runtime BaoCut perdue : ${reason}`,
  protocolMismatch: (reason: string) =>
    `Cette CLI et le Runtime BaoCut utilisent des versions de protocole différentes : ${reason}. Mettez à jour le plus ancien.`,
  interfaceMismatch: (cli: string, runtime: string, update: 'cli' | 'runtime') =>
    `Cette CLI utilise la version d’interface des outils ${cli}, le Runtime utilise ${runtime}. ${update === 'cli' ? "Mettez la CLI à jour." : "Mettez l’application BaoCut à jour (ou redémarrez le Runtime depuis le même dépôt que la CLI)."}`,

  jobCancelling: (jobId: string) => `Annulation de ${jobId}… (appuyez à nouveau sur Ctrl-C pour arrêter immédiatement l’attente)`,
  jobCancelFailed: (reason: string) => `Impossible d’annuler le traitement : ${reason}`,
  jobEnded: (state: string) => `Le traitement s’est terminé : ${state}.`,
  statusFullNext:
    "baocut status --full liste tous les fournisseurs et modèles de chaque capacité ; pour une seule capacité, exécutez baocut models capabilities --capability <capability> ; pour les détails des paquets, baocut models list.",
  waitTimeout: (seconds: number, jobId: string) => `Attente arrêtée après ${seconds} s ; le traitement ${jobId} continue.`,

  noRuntimeClient: "Cette commande ne se connecte pas au Runtime",
};
