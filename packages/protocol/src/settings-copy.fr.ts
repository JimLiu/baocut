import type { SettingKey } from './settings.ts';
import { LOCALES } from './i18n.ts';
import type { SettingDescriptionMessages } from './settings-copy.ts';

export const fr: SettingDescriptionMessages = {
  'agent.defaultDriver': "Agent des nouvelles sessions ; null utilise celui intégré par défaut (codex). Fixé à la création de la session",
  'agent.defaultModel': "Modèle des nouvelles sessions ; null utilise le modèle recommandé (Sonnet pour Claude Code, un modèle -sol pour Codex), __agent-default__ ne transmet aucun modèle et suit la configuration CLI de l’Agent",
  'agent.defaultEffort': "Effort de raisonnement des nouvelles sessions ; null utilise le défaut de l’Agent",
  'agent.defaultAccessMode':
    "Pour les sessions sans changement de mode : ask, autoAcceptEdits, auto, fullAccess ou plan (anciennes valeurs controlled et authorized traitées comme ask et fullAccess)",
  'ui.language': `Langue de l’interface : system suit le système (anglais sans langue correspondante), ou code de langue (${LOCALES.join(", ")}). Le texte du Runtime destiné aux personnes l’utilise aussi`,
  'captions.maxLineLength': "Longueur cible des lignes automatiques (caractères) : cjk pour chinois, japonais et coréen, other pour le reste",
  'transcribe.afterComplete': "Après transcription : open-video ouvre la vidéo, notify notifie seulement, nothing ne fait rien",
  'downloads.directory':
    "Emplacement par défaut pour résultats sans vidéo, médias téléchargés par lien et fichiers de downloads_save (chemin absolu) ; null utilise ~/Downloads de cet hôte, indépendamment du projet",
  'models.downloadEndpoint':
    "Source des modèles locaux (URL de base de miroir, http(s)://) ; null utilise le hub public. BAOCUT_MODELS_ENDPOINT a priorité",
  'models.dir':
    "Dossier des modèles locaux (chemin absolu) ; null utilise models dans le dossier de données. BAOCUT_MODELS_DIR a priorité. Changez avec models.setDir, pas settings set",
  'tools.downloadEndpoint':
    "Source des outils externes gérés (yt-dlp) (URL de base de miroir, http(s)://, fichiers à <base>/<tool>/<version>/<file>) ; null utilise la publication officielle. BAOCUT_TOOLS_ENDPOINT a priorité",
  'fonts.autoDownload':
    "Télécharger automatiquement les polices nécessaires à la mise en page, absentes de cet ordinateur et présentes au catalogue (aperçu et export) ; sinon police de remplacement et notification",
  'fonts.cssEndpoint': "URL de base de l’API CSS des polices (miroir, https://) ; null utilise https://fonts.googleapis.com",
  'fonts.fileEndpoint': "URL de base des fichiers de police (miroir, https:// ; fichiers récupérés seulement sous cette URL) ; null utilise https://fonts.gstatic.com",
  'space.trashRetentionDays':
    "Jours de conservation dans la corbeille Space (1–3650) : éléments sans référence et vidéos supprimées plus anciens effacés définitivement périodiquement",
  'resources.capacity':
    "Avancé : capacité pour la planification { memoryMiB, gpuMemoryMiB, cpuThreads } ; null détecte une valeur automatiquement ; null global détecte tout (mémoire et CPU du système, mémoire GPU Apple silicon estimée depuis la mémoire unifiée)",
  'runtime.idleExitMinutes':
    "Minutes d’inactivité avant arrêt automatique d’un Runtime démarré par CLI (1–1440) : aucune connexion, tâche ni service externe ouvert. Application de bureau et Runtimes démarrés manuellement non concernés",
  'updates.autoCheck': "Rechercher automatiquement les mises à jour",
  'updates.autoDownload': "Télécharger les nouvelles versions en arrière-plan (sans installation automatique)",
  'diagnostics.enabled': "Envoyer des statistiques anonymes et résumés de performance (sans média, texte ni chemin)",
  'offline.strict': "Hors ligne strict : ne rien envoyer à un service en ligne",
} satisfies Record<SettingKey, string>;
