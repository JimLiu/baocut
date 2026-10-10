import type { HelpGuidesMessages } from './help-guides.ts';

import type { HelpGuide } from './help-guides.ts';
type GuideId = 'import' | 'subtitle' | 'translate' | 'export' | 'workspace' | 'style' | 'elements' | 'reframe' | 'aitools' | 'agent' | 'missing' | 'model';
type GuideText = Pick<HelpGuide, 'title' | 'short' | 'summary' | 'keywords' | 'steps' | 'tip'> & { cta?: string };

export const fr: HelpGuidesMessages = {
  guides: {
    import: {
      title: "Créer une vidéo et importer des médias",
      short: "Créer et importer",
      summary: "Créez une vidéo dans Space, puis ajoutez des médias à la bibliothèque et à la timeline.",
      keywords: "nouveau créer fichier média bibliothèque importer glisser déposer audio image vidéo",
      steps: [
        [
          "Créer une vidéo",
          "Ouvrez « Space » à gauche, cliquez « Nouveau » → « Nouvelle vidéo vide », choisissez un projet, puis un format sur Home et « Créer une vidéo vide ». Avec un fichier vidéo ou audio, cliquez « Nouvelle vidéo depuis un fichier » ; Home propose sous-titrage ou transcription et traduction. Sans projet, ouvrez d’abord un dossier dans Home ou demandez à l’Agent d’en créer un.",
        ],
        [
          "Importer des médias dans la bibliothèque",
          "À droite de l’éditeur, ouvrez « Vidéo », « Audio » ou « Images », cliquez « Importer » et choisissez les fichiers, ou glissez-les dans le cadre. L’import copie seulement les fichiers dans le dossier vidéo, sans modifier les originaux.",
        ],
        [
          "Placer sur la timeline",
          "Cliquez « + » à droite d’un média pour le placer à la tête de lecture. Vous pouvez aussi le glisser sur une ligne de la timeline, ou glisser directement un fichier local.",
        ],
      ],
      tip: "Import et placement sont deux étapes : un média nouvellement importé reste dans la bibliothèque, sans apparaître dans l’image.",
      cta: "Nouvelle vidéo depuis un fichier",
    },
    subtitle: {
      title: "Sous-titrer et corriger ligne par ligne",
      short: "Ajouter des sous-titres",
      summary: "Importez des sous-titres ou faites transcrire par l’Agent, puis écoutez et corrigez.",
      keywords: "transcrire transcription reconnaissance srt vtt webvtt ass faute scinder fusionner rechercher remplacer sous-titres",
      steps: [
        [
          "Obtenir les sous-titres",
          "Ouvrez « Sous-titres » à droite. Avec des médias, cliquez « Générer des sous-titres » pour transcrire localement ou via cloud connecté ; affichage automatique à la fin. « Réglages de transcription » change langue, modèle et indications. Pour un fichier, « Importer un fichier de sous-titres » accepte SRT, WebVTT et ASS. Pour les locuteurs, « Outils › Transcrire » → « Autres options » → « Identifier les locuteurs ». MOSS Transcribe le fait toujours ; les autres modèles locaux nécessitent « Diarisation des locuteurs », proposé au téléchargement à la première activation.",
        ],
        [
          "Cliquer et modifier une ligne",
          "Cliquez l’horaire pour déplacer la tête de lecture, le texte pour modifier. Enter scinde en deux, Backspace au début fusionne avec la précédente, Shift+Enter ajoute une ligne interne, Esc abandonne.",
        ],
        [
          "Réécouter, puis corriger partout",
          "Après le champ texte, Space lance la lecture pour comparer. Le haut du panneau compte les lignes trop rapides. Pour une erreur répétée, utilisez Rechercher et remplacer (⌘F / Ctrl+F).",
        ],
      ],
      tip: "Seules les transcriptions de « Générer des sous-titres » apparaissent automatiquement. Celles de l’Agent sont d’abord enregistrées ; revenez à « Sous-titres » et cliquez « Générer des sous-titres ». Plusieurs pistes : choisissez dans l’en-tête du panneau celle à modifier.",
      cta: "Ouvrir Sous-titres",
    },
    translate: {
      title: "Ajouter une traduction bilingue",
      short: "Traduction et bilingue",
      summary: "Dans Sous-titres, choisissez langue cible et modèle de texte ; traduction affichée sur une nouvelle piste.",
      keywords: "traduire traduction anglais chinois bilingue langue source côte à côte glossaire modèle texte",
      steps: [
        [
          "Corriger d’abord la source",
          "La traduction suit chaque phrase ; corrigez noms, termes et erreurs évidentes avant. Les sous-titres doivent provenir d’une transcription : les fichiers importés n’ont pas d’horaires de mots et ne sont pas traduisibles directement.",
        ],
        [
          "Cliquer « + Traduire en… » sur la barre",
          "Ouvrez « Sous-titres », cliquez « + Traduire en… », choisissez langue et modèle, ajoutez style ou glossaire au besoin, puis démarrez en bas. Sans modèle, connectez d’abord un service dans « Modèles › Génération de texte » ; facturation au token.",
        ],
        [
          "Vérifier traduction et mise en page bilingue",
          "Traduction affichée automatiquement, annulable depuis le reçu. Dans « Liste », « Source + traduction » compare chaque ligne ; cliquez pour réécrire. Sélectionnez un sous-titre ; « Bilingue » dans « Propriétés des sous-titres » règle ordre et espacement.",
        ],
      ],
      tip: "Traduction seule : désactivez « Affichage bilingue » avant, ou « × » sur la source dans la barre ; source non supprimée. Après modification, traductions marquées « Obsolète » ; les réécrire efface la marque. « Actualiser les traductions obsolètes » sur bureau ou /refresh en session les fait retraduire par l’Agent.",
      cta: "Ouvrir Sous-titres",
    },
    export: {
      title: "Exporter vidéo, sous-titres ou transcription",
      short: "Exporter",
      summary: "Choisissez le livrable nécessaire ; vidéo et audio peuvent aussi exporter des chapitres ou segments.",
      keywords:
        "exporter enregistrer télécharger mp4 wav mp3 m4a srt vtt ass json markdown transcription chapitre segment volume projet premiere davinci resolve paquet portable",
      steps: [
        [
          "Cliquer « Exporter » dans la barre vidéo",
          "Cliquez « Exporter » à droite de la barre. Cinq pages : Vidéo (MP4), Audio (WAV, MP3, M4A), Sous-titres (SRT, VTT, ASS, JSON), Transcription (Markdown ou texte), Fichier projet (XML Premiere Pro / DaVinci Resolve ou paquet portable BaoCut).",
        ],
        [
          "Choisir la plage et confirmer les réglages",
          "Vidéo et audio : totalité, chapitres, segments ou plage personnalisée. Sous-titres, transcriptions et projets : séquence entière. Confirmez résolution, taille, incrustation et normalisation sur Vidéo. Cochez deux pistes sur Sous-titres pour un fichier bilingue.",
        ],
        [
          "Démarrer et attendre la fin",
          "Fichiers dans exports/ du projet par défaut, ou « Choisir un emplacement ». Fermez la fenêtre et travaillez ; progression sur « Exporter » et dans « Tâches en arrière-plan ». À la fin, « Afficher dans le dossier » ; sinon motif et solution dans la fenêtre.",
        ],
      ],
      tip: "Fichier de sous-titres et vidéo sous-titrée sont deux livrables : le premier chargé dans un logiciel, la seconde lisible et partageable directement.",
    },
    workspace: {
      title: "Découvrir l’éditeur",
      short: null,
      summary: "Voir l’aperçu, repérer sur la timeline, modifier à droite.",
      keywords: "scène canevas aperçu timeline panneau inspecteur propriétés piste lecture introuvable",
      steps: [
        [
          "Au milieu : l’aperçu",
          "Image à la tête de lecture, taille et fréquence affichées au-dessus. Contrôles dessous : lecture, images, annuler/rétablir, scinder.",
        ],
        [
          "En bas : la timeline",
          "Cliquez pour déplacer la tête de lecture. Glissez un clip pour son horaire ou sa piste, ses bords pour raccourcir. Clic droit : scinder, copier, désactiver ou supprimer.",
        ],
        [
          "À droite : contenu et propriétés",
          "Barre verticale : Transcription, Sous-titres, Éléments, Texte, Images, Vidéo, Audio, Marque, Inspecteur. Sélectionner un clip ouvre ses propriétés ; sans sélection, « Propriétés de la vidéo ».",
        ],
      ],
      tip: "Erreur ? Annulez (⌘Z / Ctrl+Z). « Versions » ouvre l’historique et l’annulation d’une modification isolée.",
    },
    style: {
      title: "Changer l’aspect des sous-titres",
      short: null,
      summary: "Sélectionnez un sous-titre ; modifiez position, style et horaires dans Inspecteur.",
      keywords: "style police taille couleur contour fond ombre lueur position bilingue espacement ponctuation",
      steps: [
        [
          "Sélectionner un sous-titre",
          "Cliquez sur la timeline ; « Propriétés des sous-titres » s’ouvre. Changement du style partagé par tous les sous-titres qui l’utilisent.",
        ],
        [
          "Ajuster position et texte",
          "« Position » : placement et largeur. « Style de texte » : police, taille, couleur, alignement, fond, contour, lueur et ombre. L’image suit le glisser, enregistrement au relâchement.",
        ],
        [
          "Ajuster les horaires",
          "« Plus tôt » et « Plus tard » dans « Affichage » règlent apparition avant parole et disparition après ; « Ponctuation » remplace virgules et points par des espaces.",
        ],
      ],
      tip: "Avec source et traduction, « Bilingue » dans les propriétés règle ordre et espacement. En cas de problème, annulez (⌘Z / Ctrl+Z).",
      cta: "Ouvrir les propriétés des sous-titres",
    },
    elements: {
      title: "Ajouter texte, stickers et formes",
      short: null,
      summary: "Ajoutez à droite puis réglez position et style dans Inspecteur.",
      keywords: "éléments sticker forme visualiseur barre progression minuterie compte à rebours onde texte zone titre bandeau préréglage",
      steps: [
        [
          "Choisir un élément",
          "« Éléments » organise stickers, formes et visualiseurs, avec recherche ; progression, minuteries et ondes incluses. Cliquez pour ajouter à la timeline : généralement à la tête de lecture, certaines progressions couvrent toute la vidéo.",
        ],
        ["Ajouter du texte", "Dans « Texte », cliquez « Ajouter une zone de texte » ou un préréglage Simple, Titre ou Bandeau inférieur."],
        [
          "Ajuster horaires et position",
          "Un élément occupe une plage de la timeline ; glissez pour changer l’horaire. Ses propriétés apparaissent à droite ; « Géométrie » règle position, taille, rotation et retournement par valeurs.",
        ],
      ],
      tip: "Sélection : propriétés à droite. Esc désélectionne ; Inspecteur revient aux « Propriétés de la vidéo ».",
    },
    reframe: {
      title: "Passer de paysage à portrait",
      short: null,
      summary: "Changez le format dans les propriétés vidéo ; clips redimensionnés avec le canevas.",
      keywords: "portrait paysage vertical horizontal format 9:16 1:1 4:3 16:9 canevas cadrage",
      steps: [
        ["Ouvrir les propriétés vidéo", "Esc désélectionne, puis « Inspecteur » à droite affiche « Propriétés de la vidéo »."],
        [
          "Choisir un autre format",
          "« Format » : 16:9, 9:16, 1:1, 4:3. Petit côté inchangé ; clips déplacés et redimensionnés proportionnellement, plein canevas conservé, clips verrouillés immobiles.",
        ],
        ["Ajuster le cadrage de chaque clip", "Sélectionnez le clip et ajustez position et taille dans « Géométrie »."],
      ],
      tip: "Changer le format est une modification annulable (⌘Z / Ctrl+Z). Aucun recadrage intelligent trouvant seul les sujets ; ajustez manuellement.",
    },
    aitools: {
      title: "Faire organiser la transcription par l’Agent",
      short: null,
      summary:
        "Amélioration, chapitres, locuteurs, coupes, traduction, doublage et écriture partent de / ou d’un bouton de panneau, vers l’Agent par défaut.",
      keywords:
        "IA outils slash améliorer paragraphe chapitre locuteur tic pause retranscrire obsolète traduction doublage résumé blog titre description couverture",
      steps: [
        [
          "Taper / dans une session",
          "Tapez / au début (ou « Utiliser un outil » sous « + ») : Améliorer la transcription, Générer les chapitres, Identifier les locuteurs, Retranscrire, Trouver les coupes, Traduire les sous-titres, Actualiser les traductions obsolètes, Traduire le doublage, Écrire un résumé, Écrire un article de blog, Proposer des titres, Écrire une description, Créer une couverture, Exporter. Choisissez, ajoutez vos exigences et envoyez ; l’Agent démarre. Pour une vidéo Space, session en bas à droite ; outils indisponibles sur le web.",
        ],
        [
          "Ou ouvrir l’onglet Outils IA",
          "L’onglet « Outils IA » du rail droit de l’éditeur regroupe les outils : polir la transcription, générer des chapitres, identifier les intervenants, retranscrire et trouver des coupes, puis écrire un résumé, un article de blog, des titres, une description ou une couverture ; « Trouver des coupes » dans la barre du mode coupe ouvre la même page. Choisissez-en un pour ouvrir sa page, puis la portée et les options. La zone de texte en dessous rédige la demande d’après elles, avec le skill de l’outil attaché ; vous pouvez la modifier. Dans la ligne « Session », choisissez une nouvelle session ou la session en cours, puis cliquez sur « Confier à l’Agent ». Traduire les sous-titres se trouve dans « + Traduire en… » du panneau Sous-titres, et traduire le doublage dans le panneau Audio et le menu de la piste de doublage ; pour ces deux-là, on choisit un modèle sur la page de réglages et on démarre directement.",
        ],
        [
          "Vérifier les résultats",
          "Chaque modification de l’Agent affiche une carte annulable. Améliorez avant les chapitres pour les regrouper par paragraphe. Écriture et publication servent à lire, choisir et copier ; transcription inchangée. Après édition source, « Actualiser les traductions obsolètes » retraduit les lignes marquées « Obsolète ».",
        ],
      ],
      tip: "Pour une opération hors liste, demandez en une phrase. Recadrage intelligent et courts indisponibles dans cette version.",
    },
    agent: {
      title: "Faire travailler l’Agent sur la vidéo",
      short: null,
      summary: "Dites quoi faire, regardez ses étapes puis vérifiez.",
      keywords: "IA assistant Agent session discussion automatique approbation permission annuler codex claude",
      steps: [
        [
          "Connecter d’abord un Agent",
          "Ouvrez « Réglages › Agent ». BaoCut détecte Claude Code et Codex. Si absent, suivez installation et connexion sur la carte, puis détectez à nouveau.",
        ],
        [
          "Exprimer votre demande en session",
          "Démarrez dans Home ou ouvrez une vidéo Space : session flottante développée en bas à droite. Minimisée, elle devient une icône ; cliquez pour rouvrir. Précisez portée et contenu à conserver, ex. « Corrigez les fautes de sous-titres de cette interview, mais gardez le ton oral. »",
        ],
        [
          "Suivre le travail et vérifier",
          "Chaque étape de l’Agent peut être développée. Selon le mode d’accès, il demande autorisation ou refus avant commandes et modifications ; chaque modification vidéo affiche une carte annulable.",
        ],
      ],
      tip: "L’Agent utilise seulement les vidéos du dossier de session (projet ou dossier de travail propre). Au message, la vidéo ouverte avec sélection et tête de lecture est jointe ; retirez la référence au-dessus du champ si nécessaire.",
      cta: "Ouvrir les réglages Agent",
    },
    missing: {
      title: "Pourquoi les sous-titres sont-ils invisibles ?",
      short: null,
      summary: "Vérifiez timeline, position de lecture, puis interrupteurs de piste.",
      keywords: "invisible absent masqué désactivé vide sous-titres transcription",
      steps: [
        [
          "Vérifier leur présence sur la timeline",
          "Agent et CLI enregistrent seulement une transcription, sans changer la timeline. Si « Sous-titres » indique « Aucun sous-titre », cliquez « Générer des sous-titres », importez un fichier ou demandez à l’Agent de les placer.",
        ],
        [
          "Aller à une phrase parlée",
          "Cliquez l’horaire d’une ligne dans Sous-titres. Les pauses sans parole n’ont pas de sous-titres.",
        ],
        [
          "Vérifier piste et clips",
          "Dans l’en-tête, œil désactivé = piste absente de l’aperçu. Clips désactivés aussi ignorés ; clic droit → « Activer ce clip ».",
        ],
      ],
      tip: "Toujours invisible ? Vérifiez position et couleur dans « Propriétés des sous-titres » ; texte peut-être hors cadre ou trop proche du fond.",
      cta: "Vérifier Sous-titres",
    },
    model: {
      title: "Transcription ou génération non démarrée ?",
      short: null,
      summary: "Lisez le motif dans Tâches en arrière-plan et ajoutez le service manquant.",
      keywords: "échec erreur transcription synthèse vocale génération image modèle service composant réseau tâche",
      steps: [
        [
          "Ouvrir Tâches en arrière-plan",
          "« Tâches en arrière-plan » liste tout : éditeur, flux Home, Agent ou CLI. Cliquez « Détails » ; en cas d’échec, titre du cadre rouge = motif.",
        ],
        [
          "Compléter ce que les détails indiquent",
          "Les détails proposent installer un composant, configurer un cloud, choisir un défaut ou vérifier l’Agent selon le motif.",
        ],
        [
          "Revenir et réessayer",
          "Après correction, recliquez « Générer des sous-titres » ou demandez à l’Agent de resoumettre. Sans service, il indique d’abord quoi activer.",
        ],
      ],
      tip: "Transcription, synthèse et images nécessitent un service de modèle. Aide lisible hors ligne ; cloud nécessitant réseau.",
      cta: "Voir les modèles",
    },
  } as Record<GuideId, GuideText>,
};
