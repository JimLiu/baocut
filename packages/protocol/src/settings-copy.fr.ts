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
  'downloads.cookieBrowsers': 'Connexion au site pour les téléchargements depuis un lien (Télécharger la vidéo, transcription depuis un lien, et download et transcribe de l’Agent) : all utilise tous les navigateurs ayant un magasin de cookies sur cet hôte, du plus récemment utilisé au plus ancien ; une liste d’ids de navigateurs (chrome, edge, firefox, safari, brave, chromium, opera, vivaldi, whale) les essaie dans cet ordre ; une liste vide télécharge anonymement. Développé selon les navigateurs détectés au début de chaque téléchargement',
  'models.downloadEndpoint':
    "Source des modèles locaux (URL de base de miroir, http(s)://) ; null utilise le hub public ; https://www.modelscope.cn télécharge depuis ModelScope. BAOCUT_MODELS_ENDPOINT a priorité",
  'models.dir':
    "Dossier des modèles locaux (chemin absolu) ; null utilise models dans le dossier de données. BAOCUT_MODELS_DIR a priorité. Changez avec models.setDir, pas settings set",
  'tools.downloadEndpoint':
    "Source des outils externes gérés (yt-dlp) (URL de base de miroir, http(s)://, fichiers à <base>/<tool>/<version>/<file>) ; null utilise la publication officielle. BAOCUT_TOOLS_ENDPOINT a priorité",
  'models.downloadMirrors':
    "Miroirs du dépôt de modèles que vous avez ajoutés (liste de { name, base } ; base est une URL http(s):// sans doublon). Simple liste de choix : les téléchargements utilisent models.downloadEndpoint",
  'tools.downloadMirrors':
    "Miroirs des pages de publication que vous avez ajoutés (liste de { name, base } ; base est une URL http(s):// sans doublon). Simple liste de choix : les téléchargements utilisent tools.downloadEndpoint",
  'fonts.autoDownload':
    "Télécharger automatiquement les polices nécessaires à la mise en page, absentes de cet ordinateur et présentes au catalogue (aperçu et export) ; sinon police de remplacement et notification",
  'fonts.cssEndpoint': "URL de base de l’API CSS des polices (miroir, https://) ; null utilise https://fonts.googleapis.com",
  'fonts.fileEndpoint': "URL de base des fichiers de police (miroir, https:// ; fichiers récupérés seulement sous cette URL) ; null utilise https://fonts.gstatic.com",
  'space.trashRetentionDays':
    "Jours de conservation dans la corbeille Space (1–3650) : éléments sans référence et vidéos supprimées plus anciens effacés définitivement périodiquement",
  'cache.maxSizeMiB': 'Taille maximale du cache du dossier de données, en Mio (256–1048576) : au-delà, les fichiers de cache les plus anciens (analyse des médias, copies de lecture) sont supprimés jusqu’à revenir à 90 %. L’index de recherche entre vidéos n’est jamais supprimé',
  'resources.capacity':
    "Avancé : capacité pour la planification { memoryMiB, gpuMemoryMiB, cpuThreads } ; null détecte une valeur automatiquement ; null global détecte tout (mémoire et CPU du système, mémoire GPU Apple silicon estimée depuis la mémoire unifiée)",
  'runtime.idleExitMinutes':
    "Minutes d’inactivité avant arrêt automatique d’un Runtime démarré par CLI (1–1440) : aucune connexion, tâche ni service externe ouvert. Application de bureau et Runtimes démarrés manuellement non concernés",
  'updates.autoCheck': "Rechercher automatiquement les mises à jour",
  'updates.autoDownload': "Télécharger les nouvelles versions en arrière-plan (sans installation automatique)",
  'diagnostics.enabled': "Envoyer des statistiques anonymes et résumés de performance (sans média, texte ni chemin)",
  'offline.strict': "Hors ligne strict : ne rien envoyer à un service en ligne",
  'semantic.channels': 'Canaux de l’index sémantique à créer : text (le parlé : transcriptions, sous-titres, traductions, chapitres) ; visual (une image clé toutes les 8 secondes ; demande un modèle multimodal et prend plus de temps) ; audio n’est pas encore disponible',
  'semantic.indexedProjects': 'Projets dont les vidéos ont un index sémantique : all, ou une liste d’ids de projet (les vidéos hors projet seulement avec all)',
  'semantic.pauseOnBattery': 'Mettre en pause la création de l’index sémantique sur batterie et reprendre sur secteur (toujours en pause quand le système bride ses performances à cause de la chaleur)',
  'semantic.translationMemory': 'Proposer d’anciennes traductions de phrases presque identiques lors de la traduction (nécessite le modèle de recherche de texte)',
  'semantic.glossaryCandidates': 'Proposer des termes de glossaire à partir de graphies presque identiques entre transcriptions (nécessite le modèle de recherche de texte)',
} satisfies Record<SettingKey, string>;
