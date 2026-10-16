import type { OnboardingMessages } from './onboarding-copy.ts';

export const fr: OnboardingMessages = {
  dialogLabel: 'Bienvenue dans BaoCut',
  stepsLabel: 'Étapes de configuration',
  step: {
    agent: 'Connecter un Agent',
    asr: 'Reconnaissance vocale',
    tts: 'Synthèse vocale',
    semantic: 'Recherche sémantique',
    image: 'Génération d’images',
    music: 'Génération de musique',
  },
  title: {
    agent: 'Bienvenue dans BaoCut',
    asr: 'Télécharger des modèles de reconnaissance vocale',
    tts: 'Télécharger des modèles de synthèse vocale',
    semantic: 'Installer la recherche sémantique',
    image: 'Télécharger des modèles de génération d’images',
    music: 'Télécharger des modèles de génération de musique',
  },
  lead: {
    agent:
      'Décrivez la vidéo que vous voulez, et un Agent transcrit, sous-titre, traduit, double et monte pour vous. BaoCut utilise les Agents de cet ordinateur (comme Claude Code ou Codex) avec votre propre compte, sans frais supplémentaires.',
    asr: 'Transcrire, sous-titrer et monter une vidéo face caméra commencent toujours par convertir la parole en texte. Les modèles tournent sur cet ordinateur et fonctionnent hors ligne.',
    tts: 'Les modèles de synthèse vocale lisent du texte à voix haute, clonent une voix à partir d’un enregistrement et doublent les vidéos traduites. Choisissez-en un ou deux pour commencer ; téléchargez les autres plus tard dans Réglages › Synthèse vocale.',
    semantic:
      'Retrouve ce qui a été dit et montré selon le sens : la recherche Space, le choix de matière par thème, l’association d’images et la mémoire de traduction s’en servent. Une fois installée, vos vidéos existantes sont indexées en arrière-plan.',
    image: 'Générez des images à partir d’une phrase sur cet ordinateur, pour des couvertures et des illustrations. Les modèles sont volumineux et la génération est lente.',
    music:
      'Générez de la musique de fond et des chansons à partir d’un style ou de paroles sur cet ordinateur, prêtes à ajouter à la piste musicale d’une vidéo. La génération est lente : comptez quelques minutes pour 30 secondes.',
  },
  where: {
    tts: {
      title: 'À utiliser dans Outils › Générer la voix',
      body: 'Écrivez un texte, ou choisissez un document ou des sous-titres dans Space, puis choisissez un modèle et une voix. Les modèles pas encore téléchargés peuvent aussi y être téléchargés.',
    },
    image: { title: 'À utiliser dans Outils › Générer une image', body: 'Décrivez l’image en une phrase. Les Agents s’en servent aussi pour créer des couvertures.' },
    music: {
      title: 'À utiliser dans Outils › Générer de la musique',
      body: 'Choisissez un style et écrivez des paroles. La musique est enregistrée dans Space et peut être ajoutée à vos vidéos.',
    },
  },
  diarizes: 'Distingue les locuteurs pendant la transcription',
  needsDiarization: (pack) => `Pour distinguer les locuteurs, téléchargez aussi « ${pack} »`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': '9 voix prédéfinies · décrivez un style de parole en une phrase',
    'qwen3-tts-0.6b-base': 'Clone une voix à partir d’un enregistrement de 3 secondes',
    voxcpm2: 'Clone une voix à partir d’un enregistrement · décrivez un style · 30 langues et le cantonais',
    'qwen-image-2.1-turbo': 'Distillé · 8 étapes fixes · plus de deux fois plus rapide que le modèle de base',
    'qwen-image-2.1': 'Modèle de base · plus lent, plus d’étapes',
    'yue2-3b': 'Génère à partir d’un style ou de paroles · quelques minutes pour 30 secondes',
  },
  recommended: 'Recommandé',
  installed: 'Installé',
  missingParts: 'Composants manquants',
  planLine: (parts) => `Téléchargés ensemble : ${parts}`,
  downloading: (name) => `Téléchargement de ${name}`,
  inBackground: 'Téléchargement en arrière-plan',
  bgNote: 'Avant le téléchargement, vous verrez sa provenance et son emplacement d’enregistrement. Il ne démarre qu’après votre confirmation et s’exécute en arrière-plan : inutile d’attendre.',
  asrAlt: 'Vous ne voulez rien télécharger ? Vous pouvez aussi ajouter plus tard une reconnaissance vocale dans le cloud dans Réglages › Fournisseurs d’API.',
  unsupported: 'Cet ordinateur ne peut pas exécuter ces modèles. Vous pouvez passer cette étape.',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: 'Agents de cet ordinateur',
  agentChecking: 'Recherche des Agents sur cet ordinateur…',
  agentMissingBody: 'Cochez ceux que vous voulez et BaoCut les installe en arrière-plan. Une fois installés, connectez-vous une fois avec votre compte existant.',
  agentNote:
    'Les Agents cochés apparaissent dans le menu Agent des nouvelles sessions. L’installation se fait en arrière-plan : inutile d’attendre. Choisissez l’Agent par défaut ou ajoutez-en d’autres dans Réglages › Fournisseurs d’Agents.',
  agentInstalled: 'Installé sur cet ordinateur',
  agentFix: (problem) => `${problem} · À corriger dans Réglages › Fournisseurs d’Agents`,
  agentManual: 'À installer dans un terminal en suivant les instructions officielles · Voir Réglages › Fournisseurs d’Agents',
  agentNotInstalled: (plan) => (plan ? `Non installé · Connexion après l’installation : ${plan}` : 'Non installé'),
  agentWillInstall: (method, command, login) =>
    `Sera installé en arrière-plan avec ${method} (${command}) · Ensuite, exécutez ${login} dans un terminal pour vous connecter`,
  agentInstalling: (method, login) => `Installation en arrière-plan avec ${method} · Ensuite, exécutez ${login} dans un terminal pour vous connecter`,
  agentInstallingLabel: (name) => `Installation de ${name}`,
  agentInstallFailed: 'Installation impossible · Détails dans Tâches en arrière-plan',

  next: 'Suivant',
  finish: 'Terminé',
  skip: 'Ignorer',
  exit: 'Quitter la configuration',
  install: (n) => `Installer ${n} en arrière-plan et continuer`,
  download: (size, last) => `Télécharger${size ? ` ${size}` : ''} en arrière-plan et ${last ? 'terminer' : 'continuer'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return kind === 'install' ? `Installation de ${name}${tail}` : kind === 'download' ? `Téléchargement de ${name}${tail}` : `Préparation de ${name}${tail}`;
    },
    many: (kind, n) =>
      kind === 'install' ? `${n} installations en arrière-plan` : kind === 'download' ? `${n} téléchargements en arrière-plan` : `${n} tâches en arrière-plan`,
    idle: (kind) =>
      kind === 'install' ? 'Installations en arrière-plan' : kind === 'download' ? 'Téléchargements en arrière-plan' : 'Téléchargements et installations en arrière-plan',
    done: (kind, n) => {
      const s = n > 1 ? 's' : '';
      return kind === 'install' ? `${n} installé${s}` : kind === 'download' ? `${n} téléchargé${s}` : `${n} terminé${s}`;
    },
    failed: (kind, n) => {
      const s = n > 1 ? 's' : '';
      return kind === 'install' ? `${n} non installé${s}` : kind === 'download' ? `${n} non téléchargé${s}` : `${n} inachevé${s}`;
    },
  },
  closedToast: (models, agents) => {
    const parts = [
      ...(models ? [models === 1 ? '1 modèle est en cours de téléchargement' : `${models} modèles sont en cours de téléchargement`] : []),
      ...(agents ? [agents === 1 ? '1 Agent est en cours d’installation' : `${agents} Agents sont en cours d’installation`] : []),
    ];
    return `${parts.join(' et ')} en arrière-plan. ${models + agents === 1 ? 'Il sera prêt à l’emploi une fois terminé.' : 'Ils seront prêts à l’emploi une fois terminés.'}`;
  },
  viewTasks: 'Voir les tâches en arrière-plan',
};
