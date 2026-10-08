import {
  MODEL_SERVICE_CAPABILITIES,
  USAGE_PERIODS,

  type ModelBundleStatus,
  type ModelServiceCapability,
  type ProviderUnavailableReason,
  type ModelsDirInfo,
  type ProviderAccountStatus,
  type UsagePeriod,
  type UsageRow,
} from '@baocut/protocol';
const s = (n: number) => pluralForm('fr', n, { one: '', other: 's' });
import { pluralForm } from '@baocut/protocol';
import type { ModelsMessages } from './models-copy.ts';

export const fr: ModelsMessages = {

  help: `Utilisation :
  baocut models cancel <bundleId> [--discard]
                                   Arrêter l’installation (téléchargements conservés ; réinstaller pour reprendre) ;
                                   --discard les supprime aussi
  baocut models repair <bundleId> [--yes]
                                   Vérifier le sha256 de chaque fichier et retélécharger seulement ceux manquants ou endommagés
                                   (même confirmation que pour install)
  baocut models dir                Dossier des modèles locaux : emplacement, source, espace utilisé et libre, nombre de modèles reconnus
  baocut models dir --set <path> [--move|--switch]
                                   Changer de dossier : --move déplace les modèles existants (tâche en arrière-plan, annulée en cas
                                   d’échec) ; --switch change seulement l’emplacement (anciens fichiers conservés ; seuls les modèles
                                   déjà au nouvel emplacement sont utilisables) ; un des deux est requis si le dossier actuel a des modèles.
                                   Refusé si une tâche utilise un modèle local ; lecture seule si défini par BAOCUT_MODELS_DIR
  baocut models dir --reset [--move|--switch]
                                   Restaurer l’emplacement par défaut (<BAOCUT_HOME>/models), mêmes règles que --set
  baocut models configure <providerId> [options]
                                   Régler un fournisseur en ligne : du catalogue (openai, google, elevenlabs, anthropic, deepseek,
                                   qwen, etc. ; voir baocut models capabilities), ou un point d’accès compatible OpenAI custom:<name>.
                                   Le fournisseur Agent agent:codex a seulement un interrupteur (connexion Codex locale, sans clé)
    --enable | --disable           Activer (les autorisations permanentes lui envoient audio, texte ou prompts au besoin) ou désactiver
    --key-stdin                    Lire la clé API depuis stdin (clés dans les arguments refusées) : remplacer celle du premier
                                   compte, ou créer un compte si absent (pour plusieurs comptes, utiliser
                                   baocut models accounts)
    --endpoint <url>               URL de base d’un point d’accès personnalisé (requise la première fois) ; pour le catalogue,
                                   peut pointer vers un proxy ou une passerelle
    --model <id> ...               Modèles de transcription du point d’accès (répétable ; le premier est celui par défaut)
    --speech-model <id> ...        Modèles de synthèse vocale (/audio/speech ; répétable)
    --image-model <id> ...         Modèles de génération d’images (/images/generations ; répétable)
    --text-model <id> ...          Modèles de texte (/chat/completions ; répétable)
                                   Indiquer un type quelconque remplace tous les modèles déclarés
    --verify                       Vérifier une fois la nouvelle clé et le point d’accès auprès du fournisseur avant enregistrement
  baocut models accounts <providerId>
                                   Comptes du fournisseur : ordre, nom, clé masquée, activation et état (les appels utilisent le
                                   premier compte activé avec clé ; aucune bascule vers le suivant en cas d’erreur)
  baocut models accounts add <providerId> [--label <name>] [--region <region>] [--endpoint <url>] [--verify]
                                   Ajouter un compte ; clé lue depuis stdin ; --region accepte une région du catalogue (comme
                                   global ou cn) ; --verify vérifie d’abord auprès du fournisseur, sans enregistrer en cas d’échec.
                                   Ajouter un compte n’active pas le fournisseur
  baocut models accounts remove <providerId> <accountId|name>
                                   Retirer un compte et sa clé (après le dernier, le fournisseur reste
                                   mais sans clé utilisable)
  baocut models accounts use <providerId> <accountId|name>
                                   Rendre prioritaire : placer ce compte en tête
  baocut models usage [--period <${USAGE_PERIODS.join("|")}>] [--provider <id>]
                                   Appels, utilisation et dépenses des fournisseurs en ligne et Agents (30 derniers jours par défaut) :
                                   montants estimés selon les tarifs catalogue, déclarés par le fournisseur et coûts inconnus
                                   listés séparément, sans conversion monétaire ; ventilation par fournisseur, capacité, modèle
                                   et compte
  baocut models default <capability> <providerId|none> [modelId]
                                   Définir ou effacer le fournisseur et modèle par défaut d’une capacité (${MODEL_SERVICE_CAPABILITIES.join(", ")})
  baocut models remove <bundleId|providerId>
                                   Supprimer un paquet de modèle local (composants partagés conservés ; refusé si utilisé
                                   par une tâche) ; ou retirer un fournisseur en ligne : custom:<name> supprimé entièrement ;
                                   fournisseur du catalogue désactivé, tous ses comptes et clés supprimés
  baocut models refresh <providerId>
                                   Récupérer et mettre en cache les modèles (et voix) d’un fournisseur : modèles intégrés absents
                                   signalés indisponibles ; si la liste n’est pas récupérable, la liste intégrée reste utilisée
  baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]
                                   Afficher ou définir l’effort de raisonnement par défaut et la limite de concurrence
                                   par fournisseur (4 par défaut) ; default restaure la valeur d’origine`,
  byteProgressUnknown: (done: string) => `${done} reçus (taille totale inconnue)`,
  byteProgress: (done: string, total: string, percent: number) => `${done} / ${total} (${percent} %)`,
  bundleStates: {
    'not-installed': "Non installé",
    downloading: "Téléchargement",
    installed: "Installé",
    loading: "Chargement",
    ready: "Prêt",
    busy: "Occupé",
    unloading: "Déchargement",
    error: "Indisponible",
  } satisfies Record<ModelBundleStatus['state'], string>,
  installStates: {
    queued: "En file",
    downloading: "Téléchargement",
    verifying: "Vérification et publication",
    paused: "En pause",
  } satisfies Record<NonNullable<ModelBundleStatus['install']>['state'], string>,
  bundleState: (label: string, state: string, reason: string | null | undefined) => `${label} (${state}${reason ? ` / ${reason}` : ""})`,
  componentInstalled: "installé",
  componentMissing: "manquant",
  sharedWith: (bundles: readonly string[]) => `  partagé avec ${bundles.join(", ")}`,
  installTask: (jobId: string) => `  tâche ${jobId}`,
  resumeHint: (bundleId: string) => ` ; reprenez avec baocut models install ${bundleId}`,
  installLine: (state: string, progress: string, task: string, hint: string) => `  Installation : ${state}  ${progress}${task}${hint}`,
  checkPassed: "réussi",
  checkFailed: (code: string | null | undefined) => `échec${code ? ` (${code})` : ""}`,
  checkLine: (result: string, at: string, detail: string | null | undefined) => `  Vérification : ${result}  ${at}${detail ? `  ${detail}` : ""}`,
  remedyAppFileMissing: "Pour corriger : réinstallez BaoCut ; réparer le modèle n’aidera pas",
  remedyRepair: (bundleId: string) => `Pour corriger : baocut models repair ${bundleId} télécharge à nouveau uniquement les fichiers endommagés ; vérifiez ensuite`,
  remedyMaybeRepair: (bundleId: string) =>
    `Pour corriger : essayez d’abord baocut models repair ${bundleId} (seuls les fichiers endommagés seront téléchargés), puis vérifiez`,
  remedyOutOfMemory: "Pour corriger : fermez les applications gourmandes en mémoire ou choisissez un modèle plus petit, puis vérifiez",
  remedy: (text: string) => `Pour corriger : ${text}`,
  upToDate: (repair: boolean, bundleId: string) =>
    repair ? `${bundleId} : tous les fichiers sont intacts ; aucune réparation nécessaire` : `${bundleId} est déjà installé ; rien à télécharger`,
  planHeader: (repair: boolean, bundleId: string, source: string) => `${repair ? "Réparer" : "Installer"} ${bundleId} depuis ${source}`,
  planKeep: (component: string, repo: string) => `  ${component}  ${repo}  installés, conservés`,
  planDownload: (component: string, repo: string, files: number, size: string) =>
    `  ${component}  ${repo}  télécharger ${files} fichier${s(files)}, ${size}`,
  sizeUnknown: "taille inconnue",
  toDownloadEstimate: (estimate: string) => `À télécharger : taille inconnue, environ ${estimate}`,
  toDownload: (size: string) => `À télécharger : ${size}`,
  resumed: (size: string) => `Reprise : ${size} est déjà dans la zone temporaire et ne sera pas téléchargé à nouveau`,
  freeSpace: (size: string, short: boolean) => `Espace libre : ${size}${short ? " (insuffisant)" : ""}`,
  sizeAbout: (size: string) => `environ ${size}`,
  installPrompt: (repair: boolean, size: string) => `${repair ? "Réparer" : "Installer"} et télécharger ${size} ? [y/N] `,
  noSpace: (need: string, have: string) => `Espace disque : il faut ${need}, il reste seulement ${have}`,
  removed: (files: readonly string[]) => `Supprimé : ${files.join(", ")}`,
  nothingRemoved: "Aucun fichier supprimé",
  keptInUse: (repo: string, users: readonly string[]) => `Conservé : ${repo} : encore utilisé par ${users.join(", ")}`,
  keptOtherVersion: (repo: string) => `Conservé : ${repo} : le dossier contient une autre version qui ne fait pas partie de ce paquet de modèle`,
  dirSources: {
    default: "emplacement par défaut",
    setting: "dossier choisi dans Réglages",
    env: "variable d’environnement BAOCUT_MODELS_DIR (lecture seule : modifiez la variable et redémarrez BaoCut pour changer)",
  } satisfies Record<ModelsDirInfo['source'], string>,
  dirSource: (label: string) => `  Source : ${label}`,
  dirMissing: "  Ce dossier n’existe pas (un disque externe déconnecté peut en être la cause)",
  dirNotWritable: "  BaoCut ne peut pas écrire dans ce dossier",
  dirUsage: (used: string, free: string | null, models: number) =>
    `  ${used} utilisés${free ? ` · ${free} libres sur ce disque` : ""} · ${models} modèle${s(models)} trouvé`,
  dirDefault: (path: string) => `  Emplacement par défaut : ${path}`,
  dirMoving: (to: string | null | undefined, jobId: string) => `  Déplacement${to ? ` vers ${to}` : ""} (tâche ${jobId})`,
  dirEnvLocked: "Le dossier des modèles est défini par BAOCUT_MODELS_DIR : modifiez cette variable et redémarrez BaoCut pour le changer",
  dirProblemMissing: "Ce dossier n’existe pas : un disque externe déconnecté peut en être la cause ; connectez-le et réessayez",
  dirProblemNotWritable: "BaoCut ne peut pas écrire dans ce dossier : choisissez un emplacement accessible en écriture ou modifiez ses autorisations",
  dirProblemNested: "Les dossiers actuel et nouveau sont imbriqués : choisissez un dossier qui ne contient pas l’autre et n’est pas contenu par lui",
  dirProblemSame: "C’est déjà le dossier des modèles actuel",
  dirFound: (count: number, size: string) => `Trouvé : ${count} modèle téléchargé${s(count)} (${size}), prêt à utiliser`,
  dirEmpty: "Aucun modèle dans ce dossier ; les prochains téléchargements y seront enregistrés",
  dirFree: (size: string) => `${size} libres sur ce disque`,
  moveSameVolume: "Même disque : le déplacement ne fait que renommer, sans espace supplémentaire",
  moveSize: (size: string, fits: boolean) => `déplacement de ${size}${fits ? "" : ", ce qui ne tient pas"}`,
  dirCurrentHas: (size: string, move: string) => `Le dossier actuel contient ${size} de modèles : ${move}`,
  moveOrSwitch: "Utilisez un seul choix entre --move et --switch",
  accountStates: {
    unknown: "Non vérifié",
    ok: "OK",
    'invalid-key': "Clé invalide",
    'rate-limited': "Limite de débit atteinte",
    'quota-exhausted': "Quota épuisé",
  } satisfies Record<ProviderAccountStatus['state'], string>,
  rateLimitedUntil: (label: string, until: string) => `${label} (jusqu’à ${until})`,
  noAccounts: "Aucun compte : baocut models accounts add <providerId> lit la clé depuis l’entrée standard",
  accountEnabled: "activé",
  accountDisabled: "désactivé",
  accountKeyUnreadable: "clé illisible",
  accountRegion: (region: string) => `région ${region}`,
  accountEndpoint: (endpoint: string) => `endpoint ${endpoint}`,
  accountLastUsed: (at: string) => `dernière utilisation ${at}`,
  accountCurrent: "utilisé",
  accountChoice: (accountId: string, label: string) => `${accountId} (${label})`,
  noAccountChoices: "aucun compte",
  listSep: ", ",
  accountAmbiguous: (count: number, ref: string, choices: string) => `${count} comptes portent le nom « ${ref} » ; utilisez un accountId : ${choices}`,
  accountNotFound: (ref: string, choices: string) => `Compte inconnu : ${ref} (choix : ${choices})`,
  usagePeriods: { today: "Aujourd’hui", '7d': "7 derniers jours", '30d': "30 derniers jours", all: "Depuis le début" } satisfies Record<UsagePeriod, string>,
  unitTokens: (input: string, output: string) => `entrée ${input} / sortie ${output} tokens`,
  unitCached: (cached: string) => `${cached} en cache`,
  unitAudio: (minutes: string) => `${minutes} min d’audio`,
  unitChars: (chars: string) => `${chars} caractères`,
  unitImages: (images: number) => `${images} image${s(images)}`,
  clauseSep: ", ",
  costKinds: {
    reported: "déclaré par le fournisseur",
    estimated: "estimé selon les prix catalogue",
    mixed: "déclaré et estimé",
    unknown: "coût inconnu",
  } satisfies Record<UsageRow['costKind'], string>,
  rowCalls: (calls: number, failed: number) => `${calls} appel${s(calls)}${failed > 0 ? ` (${failed} en échec)` : ""}`,
  costApprox: (money: string, kind: string) => `≈ ${money} (${kind})`,
  usageHeader: (scope: string | undefined, period: string, from: string, to: string) =>
    `Utilisation (${scope ? `${scope}, ` : ""}${period} : ${from} vers ${to})`,
  noCalls: "  Aucun appel",
  totalCalls: (calls: number, failed: number) => `  ${calls} appel${s(calls)}${failed > 0 ? ` (${failed} en échec)` : ""}`,
  usageUnits: (units: string) => `  Utilisation : ${units}`,
  spentEstimated: (money: string) => `  Dépenses ≈ ${money} (estimées selon les prix catalogue)`,
  spentReported: (money: string) => `  Dépenses ${money} (déclarées par le fournisseur)`,
  unknownCostCalls: (calls: number) => `  Coût inconnu pour ${calls} autre appel${s(calls)}`,
  noBilledCalls: "  Aucun appel facturé",
  byProvider: "Par fournisseur",
  byCapability: "Par capacité",
  byModel: "Par modèle",
  byAccount: "Par compte",

  usageRepair: "Utilisation : baocut models repair <bundleId> [--yes]",
  usageCancel: "Utilisation : baocut models cancel <bundleId> [--discard]",
  usageConfigure: "Utilisation : baocut models configure <providerId> [--enable|--disable] [--key-stdin] [--endpoint <url>] …",
  usageDefault: "Utilisation : baocut models default <capability> <providerId|none> [modelId]",
  usageRemove: "Utilisation : baocut models remove <bundleId|providerId>",
  usageRefresh: "Utilisation : baocut models refresh <providerId>",
  usageParameters: "Utilisation : baocut models parameters generateText [--effort <level|default>] [--concurrency <n|default>]",
  usageAccounts:
    "Utilisation : baocut models accounts <providerId> | add <providerId> [--label <name>] [--region <region>] [--verify] | remove <providerId> <account> | use <providerId> <account>",
  usageDir: "Utilisation : baocut models dir [--set <path> [--move|--switch] | --reset [--move|--switch]]",
  cancelledDiscarded: "Arrêté et partie téléchargée supprimée",
  cancelledKept: "Arrêté (partie téléchargée conservée ; relancez install pour reprendre)",
  unknownCapability: (capability: string, choices: readonly string[]) => `Capacité inconnue : ${capability} (choisissez parmi ${choices.join(", ")})`,
  clearDefaultNoModel: "N’indiquez pas de modèle pour effacer la valeur par défaut",
  defaultSet: (label: string, provider: string, model: string) => `${label} par défaut : ${provider} / ${model}`,
  defaultCleared: (label: string) => `${label} : valeur par défaut effacée`,
  customProviderDeleted: (id: string) => `Supprimé : ${id} (les valeurs par défaut qui y font référence sont conservées et signalées indisponibles)`,
  providerRemoved: (id: string) =>
    `Supprimé : ${id} : désactivé, tous ses comptes et clés supprimés (les valeurs par défaut qui y font référence sont conservées et signalées indisponibles)`,
  providerRefreshFailed: (id: string, error: string | undefined) =>
    `Impossible d’actualiser ${id} : ${error ?? "motif inconnu"} ; liste intégrée des modèles toujours utilisée`,
  providerRefreshed: (id: string, models: number, voices: number | undefined, at: string) =>
    `Actualisé : ${id} : ${models} modèle${s(models)}${voices !== undefined ? `, ${voices} voix` : ""} (${at})`,
  periodChoices: (periods: readonly string[]) => `--period doit être une valeur parmi ${periods.join(", ")}`,
  enableDisableConflict: "Utilisez un seul choix entre --enable et --disable",
  saved: (description: string) => `Enregistré : ${description}`,
  verifiedAndSaved: "Vérifié et enregistré",
  savedPlain: "Enregistré",
  providerNotEnabled: (id: string) => `${id} n’est pas encore activé : baocut models configure ${id} --enable`,
  accountRemoved: (name: string) => `Compte supprimé : ${name}`,
  accountPreferred: (name: string) => `Défini comme préféré : ${name}`,
  providerHasNoAccounts: (id: string) => `${id} n’a aucun compte`,
  noSuchProvider: (id: string) => `Fournisseur inconnu : ${id}`,
  alreadyRepairing: (jobId: string) => `Réparation déjà en cours (tâche ${jobId}) ; affichage de la progression`,
  nothingToRepair: "Aucun fichier à réparer",
  notTtyConfirmDownload: "Hors d’un terminal : ajoutez --yes une fois le téléchargement confirmé par l’utilisateur",
  notDownloaded: "Non téléchargé",
  nothingToDownload: "Rien à télécharger",
  repairDone: "Réparation terminée",
  repairPartialKept: (bundleId: string) => `La partie téléchargée est conservée : exécutez baocut models repair ${bundleId} pour reprendre`,
  setResetConflict: (usage: string) => `Utilisez un seul choix entre --set et --reset. ${usage}`,
  dirHasModels: "Le dossier actuel contient des modèles : ajoutez --move pour les déplacer, ou --switch pour changer uniquement l’emplacement (anciens fichiers conservés)",
  dirChanged: (dir: string, oldFilesKept: boolean) => `Dossier des modèles remplacé par ${dir}${oldFilesKept ? " (fichiers conservés à l’ancien emplacement)" : ""}`,
  modelsMoved: (dir: string) => `Modèles déplacés vers ${dir}`,
  dirRolledBack: "Changement annulé : le dossier initial des modèles est inchangé",
  pasteKeyHint: "Collez la clé API, appuyez sur Entrée, puis sur Ctrl-D pour terminer :",
  noKeyOnStdin: "Aucune clé API sur l’entrée standard",
  keyHasWhitespace: "La clé API ne doit contenir ni espace ni saut de ligne : fournissez uniquement la clé sur l’entrée standard",
  positiveInteger: (option: string) => `${option} doit être un entier positif`,
  effortChoices: (efforts: readonly string[]) => `--effort doit être une valeur parmi ${efforts.join(", ")}`,
  capabilityLabels: {
    transcribe: "Transcription",
    synthesizeSpeech: "Synthèse vocale",
    generateImage: "Génération d’images",
    generateText: "Génération de texte",
    separateAudio: "Séparation vocale",
  } satisfies Record<ModelServiceCapability, string>,
  unavailableLabels: {
    'not-configured': "non activé",
    'missing-credential': "clé API manquante",
    'not-installed': "non installé",
    'signed-out': "déconnecté",
    outdated: "version trop ancienne",
    'not-paired': "non jumelé",
    'not-connected': "connexion impossible",
    unsupported: "non pris en charge",
    resource: "désactivé après des erreurs répétées",
  } satisfies Record<ProviderUnavailableReason, string>,
  unavailable: "indisponible",
  capabilityState: (label: string, available: boolean, reason: string) => `${label} ${available ? "disponible" : `indisponible (${reason})`}`,
  capabilitySep: ", ",
  configEnabled: "activé",
  configDisabled: "désactivé",
  keyState: (set: boolean) => `clé ${set ? "défini" : "non défini"}`,
  configEndpoint: (url: string) => `endpoint ${url}`,
  modelListRefreshed: (at: string) => `liste des modèles actualisée ${at}`,
  lastRefreshFailed: (at: string) => `dernière actualisation en échec (${at}) ; liste intégrée utilisée`,
  textParameters: (effort: string | null | undefined, concurrency: number) =>
    `Effort de raisonnement par défaut : ${effort ?? "celui du modèle"} · concurrence par fournisseur ${concurrency}`,
  markDefault: "par défaut",
  markDeclared: "déclaré par l’utilisateur",
  wordTimestampsNative: "horodatage des mots",
  wordTimestampsEstimated: "durée des mots estimée selon leur longueur",
  maxInputMegabytes: (mb: string) => `≤ ${mb} Mo par appel`,
  maxDurationMinutes: (minutes: number) => `≤ ${minutes} min par appel`,
  voiceCount: (count: number, defaultVoice: string | null | undefined) =>
    `${count} voix (par défaut ${defaultVoice ?? "aucun"})`,
  noPresetVoices: "aucune voix prédéfinie ; une voix doit être indiquée",
  acceptsCustomVoices: "accepte des voix personnalisées",
  maxInputChars: (count: number) => `≤ ${count} caractères par appel`,
  acceptsInstructions: "accepte des instructions de style",
  sizeCount: (count: number, defaultSize: string | null | undefined) =>
    `${count} taille${s(count)}${defaultSize ? ` (par défaut ${defaultSize})` : ""}`,
  aspectRatios: (ratios: string) => `formats ${ratios}`,
  maxImageCount: (count: number) => `≤ ${count} images par appel`,
  sizeAndSeedFixed: "taille et graine non configurables",
  contextTokens: (count: number) => `contexte ${count} tokens`,
  maxOutputTokens: (count: number | undefined) => `sortie ≤ ${count} tokens`,
  efforts: (efforts: string, defaultEffort: string | null | undefined) =>
    `effort de raisonnement ${efforts}${defaultEffort ? ` (par défaut ${defaultEffort})` : ""}`,
  structuredOutput: "sortie structurée",
  subscription: "inclus dans un abonnement, quota inconnu",
  modelName: (id: string, label: string) => `${id} (${label})`,
};
