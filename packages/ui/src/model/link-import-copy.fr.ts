import type { JobRecord } from '@baocut/protocol';
import type { ExternalToolStatus } from '@baocut/protocol';
import type { LinkImportMessages } from './link-import-copy.ts';

import type { LinkIssueText } from './link-import-copy.ts';
const endSentence = (text: string): string => /[.!?。！？]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
const joinSentences = (parts: readonly (string | null | undefined)[]): string => parts.filter((p): p is string => !!p?.trim()).map(endSentence).join(' ');

export const fr: LinkImportMessages = {
  title: (name: string | null) => (name ? `Import par lien · ${name}` : "Importer depuis un lien"),

  phase: {
    starting: "Préparation",
    probing: "Lecture du lien",
    downloading: "Téléchargement de la vidéo",
    validating: "Vérification de lecture du fichier",
    publishing: "Déplacement vers Téléchargements",
    applying: "Import vidéo",
    transcribing: "Démarrage de transcription",
  } as Partial<Record<JobRecord['phase'], string>>,
  phaseFallback: "Traitement",
  downloaded: (bytes: string) => `${bytes} téléchargés`,

  stageDownload: "Télécharger la vidéo",
  stageVideo: "Vérifier le média et créer la vidéo",
  stageSubs: "Générer les sous-titres",

  issue: {
    TOOL_NOT_INSTALLED: {
      title: "Configurer une fois, puis coller",
      body: "BaoCut nécessite yt-dlp pour lire ce site. Installez-le, puis relancez cet import.",
    },
    TOOL_CONSENT_REQUIRED: {
      title: "Votre accord est requis pour l’outil",
      body: "Outil déjà installé. BaoCut télécharge depuis les sites seulement après votre accord.",
    },
    TOOL_UNAVAILABLE: {
      title: "L’outil ne peut pas être exécuté",
      body: "Outil trouvé mais inutilisable. Réinstallez ou choisissez une copie fonctionnelle.",
    },
    TOOL_OUTDATED: {
      title: "L’outil doit être mis à jour",
      body: "Version trop ancienne, pouvant ne pas lire ce site. Mettez à jour puis réessayez.",
    },
    OFFLINE_STRICT: {
      title: "Liens non téléchargeables hors ligne strict",
      body: "BaoCut ne va pas en ligne dans ce mode. Téléchargez dans votre navigateur puis choisissez le fichier local.",
    },
    LINK_UNSUPPORTED: {
      title: "Source non encore prise en charge",
      body: "Site ou page non reconnu. Utilisez la page vidéo (pas playlist, direct ou recherche) ou un fichier local.",
    },
    LINK_LOGIN_REQUIRED: {
      title: "Cette vidéo nécessite une connexion",
      body: "Connectez-vous d’abord au site, revenez à Télécharger la vidéo, cochez ce navigateur dans « Connexion au site » et réessayez.",
    },
    LINK_COOKIES_UNAVAILABLE: {
      title: "Cookies de navigateur illisibles",
      body: "Vérifiez la connexion. Base verrouillée : fermez entièrement le navigateur, arrière-plan compris. Vérifiez trousseau et Accès complet au disque pour Safari. Sous Windows, cookies Chrome, Edge, Brave protégés par chiffrement lié à l’application illisibles ; cochez Firefox. Ou essayez un autre navigateur.",
    },
    LINK_TOOL_UPDATE_REQUIRED: {
      title: "yt-dlp doit être mis à jour",
      body: "Le site a changé son service vidéo. Mettez yt-dlp à jour selon son installation, vérifiez à nouveau et réessayez.",
    },
    LINK_UNAVAILABLE: {
      title: "Vidéo indisponible",
      body: "Peut-être supprimée, restriction géographique ou aucun format téléchargeable. Essayez un autre lien ou fichier local.",
    },
    LINK_NETWORK_ERROR: {
      title: "Connexion interrompue",
      body: "Vérifiez le réseau et réessayez ; téléchargements reçus repris.",
    },
    LINK_DISK_FULL: {
      title: "Espace disque insuffisant",
      body: "Disque Téléchargements plein. Libérez de l’espace puis réessayez.",
    },
    LINK_DOWNLOAD_FAILED: {
      title: "L’outil a signalé une erreur",
      body: "Site modifié ou limitation temporaire. Réessayez ; sinon vérifiez la mise à jour de l’outil ou utilisez un fichier local.",
    },
    LINK_DOWNLOAD_UNREADABLE: {
      title: "Fichier téléchargé inutilisable",
      body: "Fichier incomplet, sans audio ou indécodable ; contenu fictif possible. Retéléchargez, essayez un autre lien ou fichier local.",
    },
    LINK_DESTINATION_UNAVAILABLE: {
      title: "Écriture dans Téléchargements impossible",
      body: "Vérifiez existence et écriture du dossier ; choisissez un autre, puis relancez l’import.",
    },
    MEDIA_TOOL_UNAVAILABLE: {
      title: "Vérification du fichier impossible",
      body: "ffprobe requis (fourni avec ffmpeg), absent ici. Installez ffmpeg puis réessayez.",
    },
    LINK_SOURCE_EXPIRED: {
      title: "Lien original disparu",
      body: "Après redémarrage, le Runtime conserve seulement un lien masqué. Collez à nouveau le lien pour importer.",
    },
    INTERRUPTED: {
      title: "Import interrompu",
      body: "Runtime arrêté ou redémarré avant la fin ; réessayer reprend à l’étape d’arrêt.",
    },
  } as Readonly<Record<string, LinkIssueText>>,
  issueUnknownTitle: "Import inachevé",
  issueUnknownBody: (message: string | null, remedy: string | null) => joinSentences([message, remedy]) || "Une erreur s’est produite.",

  headingStopped: "Import arrêté",
  headingFailed: "Import inachevé",
  headingRunning: "Transformation du lien en vidéo modifiable",
  headingDownloaded: "Vidéo téléchargée",
  headingVideoFailed: "Fichier téléchargé mais vidéo non créée",
  headingCreatingVideo: "Fichier téléchargé, création vidéo",
  headingTranscribing: "Vidéo prête, génération de sous-titres",
  headingTranscribeFailed: "Vidéo prête, transcription à vérifier",
  headingReady: "Vidéo prête",
  headingSubsReady: "Sous-titres prêts",

  toolSource: {
    system: "Installé sur le système",
    user: "Choisi par vous",
    managed: "Téléchargé par BaoCut",
    env: "Défini par une variable d’environnement",
  } as Record<NonNullable<ExternalToolStatus['source']>, string>,
  factVersion: (version: string, size: string | null) => (size ? `Version ${version} · environ ${size}` : `Version ${version}`),
  factFrom: (host: string) => `Téléchargé depuis ${host}`,
  factLicense: (license: string) => `${license} : licence`,
  factIsolated: "Conservé dans le dossier BaoCut, exécuté après vérification d’empreinte ; système inchangé",
  factInstalledWith: (method: string) => `Installé avec ${method}`,

  cardChecking: "Vérification de l’outil de téléchargement…",
  cardCheckingBody: "Vérifie seulement la version locale, sans réseau.",
  cardUnknown: "Outil non enregistré",
  cardUnknownBody: "Ce Runtime ne connaît pas yt-dlp ; import par lien indisponible.",
  cardInstalling: "Préparation de l’outil…",
  cardInstallingBody: "Télécharger → vérifier → tester. « Prêt » à la fin.",
  cardUpdating: "Mise à jour de l’outil…",
  cardUpdatingBody: "Sortie sous la commande, version revérifiée à la fin.",
  cardBlockedWhy: "BaoCut ne peut pas le télécharger pour vous ici.",
  cardMissing: "Outil de téléchargement non installé",
  cardMissingBody: (why: string) => `${endSentence(why)} Installez yt-dlp vous-même puis « Vérifier à nouveau » ou choisissez son emplacement.`,
  cardInstall: "Configurer une fois, puis coller",
  cardInstallBody: "BaoCut nécessite yt-dlp pour les sites vidéo. Après accord, télécharge l’outil et mémorise le consentement ; plus de demande à l’import.",
  cardInstallAction: "Accepter et installer",
  cardOutdatedReason: (reason: string | null, version: string | null, minVersion: string | null) =>
    endSentence(reason ?? `Version ${version ?? "inconnu"} est plus ancien que ${minVersion ?? ""}`),
  cardOutdated: "L’outil doit être mis à jour",
  cardOutdatedBlocked: (reason: string, why: string) => `${reason} ${why}`,
  cardOutdatedRunnable: "Non téléchargé par BaoCut ; mettez à jour selon son installation avec la commande ci-dessous.",
  cardOutdatedManual: "Non téléchargé par BaoCut. Mettez à jour dans Terminal selon les instructions, puis « Vérifier à nouveau ».",
  cardOutdatedUpdate: (reason: string) => `${reason} Mettez à jour avant de démarrer.`,
  cardUpdateAction: "Accepter et mettre à jour",
  cardBroken: "L’outil ne peut pas être exécuté",
  cardBrokenBody: (reason: string | null, remedy: string | null) => joinSentences([reason, remedy]) || "Trouvé mais inexécutable.",
  cardReinstallAction: "Accepter et réinstaller",
  cardConsentRevoked: "Vous avez retiré le consentement à l’outil",
  cardConsent: "Votre accord est requis pour l’outil",
  cardConsentBody: "BaoCut l’utilise seulement après accord. Consentement conservé dans le Runtime, aucune nouvelle demande à l’import.",
  cardConsentAction: "Accepter et utiliser",
  cardReady: "Outil de téléchargement prêt",
  cardReadyBody: "BaoCut vérifie d’abord le lien et les informations vidéo, puis télécharge.",
};
