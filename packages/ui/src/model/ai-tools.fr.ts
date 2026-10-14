import { pluralForm } from '@baocut/protocol';
import { intlLocale } from '@baocut/protocol';
import type { AiToolId, AiToolGroup, CleanupKey, WriteLength, WriteStyle, WriteView, CoverText } from './ai-tools.ts';
type IntentArgs = { p: string; scope: string | null; edited: number | boolean; cut: number | boolean; count: number | null };
type ToolText = { name: string; desc: string; setup?: readonly string[]; why?: string };
const soonTail = 'Le Runtime n’a pas encore ce flux ni de superposition pour ajuster le cadrage ; aucun formulaire disponible ici.';
const scopeOf = (o: IntentArgs) => o.scope ? `${o.scope} de ${o.p}` : o.p;
import type { AiToolsMessages } from './ai-tools.ts';

export const fr: AiToolsMessages = {
  shorts: {
    lengths: { auto: 'Automatique', short: '15–30 s', medium: '30–60 s', long: '60–90 s', extended: '1–3 min', custom: 'Personnalisé' },
    ratioSource: 'Garder l’original',
    focus: {
      auto: { label: 'Automatique', sub: 'Repère de quel côté se trouve la personne qui parle et cadre sur elle ; sinon, centré' },
      manual: { label: 'Je le règle', sub: 'Vous placez ensuite le cadre de chaque vidéo courte' },
      speaker: { label: 'Suivre la personne qui parle', sub: 'Le cadre suit la personne qui parle' },
    },
    speakerOff: 'Cette version n’a pas encore de modèle de personnes et de locuteurs',
    tracks: { both: 'Original + traduction', source: 'Original seul', translation: 'Traduction seule' },
    styles: {
      shorts: { label: 'Sous-titres pour vidéos courtes', sub: 'Préréglage intégré qui évite les boutons des plateformes' },
      video: { label: 'Garder le style de cette vidéo', sub: 'Même taille et position ; les boutons des plateformes peuvent les masquer' },
    },
    focusPrompt: { auto: 'automatique : prends des images réparties sur le segment, regarde de quel côté de l’image se trouve la personne qui parle et place le recadrage sur elle ; si tu ne trouves personne, centre-le', manual: 'centré pour l’instant ; j’ajusterai chacune moi-même' },
    countN: (n) => `${n}`,
    autoHint: {
      both: 'Automatique : l’agent trouve les sujets les plus forts qui tiennent seuls et décide du nombre de vidéos courtes et de la durée de chacune, sans remplissage ni sujet coupé en deux.',
      count: 'Automatique : une vidéo courte par sujet assez fort pour tenir seul, sans remplissage.',
      length: 'Automatique : chaque vidéo courte va de son accroche d’ouverture jusqu’à la chute de son sujet, sans être étirée ni raccourcie pour tenir une durée.',
    },
    lineCount: (count, len) =>
      `${count === null ? 'Décidez du nombre de vidéos courtes selon les sujets trouvés' : `Faites ${count === 1 ? '1 vidéo courte' : `${count} vidéos courtes`}`}, ${len ? `de ${len.min} à ${len.max} secondes chacune` : 'chacune aussi longue que son sujet l’exige, de l’accroche d’ouverture jusqu’à la chute'}, qui commencent et finissent sur des limites de phrase`,
    lineFrame: (ratio, focus) => (ratio ? `Format ${ratio}, cadrage ${focus}` : 'Format : garder l’original, sans recadrer'),
    lineSubtitles: (tracks, style) => `Sous-titres : ${tracks}, ${style}`,
    lineSkipDone: 'Ignorez les passages déjà découpés en vidéos courtes',
    lineTopic: (topic) => `Ne cherchez que dans les passages qui parlent de « ${topic} » : trouvez-les d’abord avec speech_relevant, puis choisissez parmi eux`,
    lineDirect: 'Créez les vidéos dès qu’elles sont trouvées ; inutile de me demander avant',
  },
  groups: {
    frame: "Cadre",
    transcript: "Transcription",
    translate: "Traduction",
    writing: "Écriture",
    publish: "Publication",
    sound: "Son",
  } as Record<AiToolGroup, string>,
  tools: {
    crop: {
      name: "Recadrage intelligent",
      desc: "Changer le format en gardant locuteurs, tableaux blancs et sujets clés dans le cadre",
      why: `Le recadrage intelligent suit locuteurs, tableaux et sujets clés, puis recadre au nouveau format. ${soonTail}`,
    },
    shortscut: {
      name: "Découper en vidéos courtes",
      desc: 'Trouver les meilleurs sujets de cette vidéo et faire de chacun une vidéo courte',
      setup: ['Trouve les sujets qui méritent le plus d’être publiés seuls et découpe chacun en une vidéo courte complète.'],
    },
    polish: {
      name: "Améliorer la transcription",
      desc: "Corriger fautes, ponctuation et paragraphes sans réécrire vos mots",
      setup: [
        "Corriger les fautes évidentes, ajouter la ponctuation et diviser par sujet.",
        "Vos mots ne sont ni réécrits ni supprimés ; seules erreurs évidentes corrigées.",
      ],
    },
    chapters: {
      name: "Générer des chapitres",
      desc: "Découpe une longue vidéo en chapitres titrés",
      setup: ["Regrouper les paragraphes par sujet en chapitres titrés.", "Export et page de partage utilisent les mêmes chapitres."],
    },
    speakers: {
      name: "Identifier les intervenants",
      desc: "Identifier les locuteurs, nommer sous-titres et transcription",
    },
    retranscribe: {
      name: "Retranscrire",
      desc: "Relancer avec un autre modèle, seulement un chapitre ou segment si souhaité",
      setup: [
        "Relancer avec un autre modèle vocal et remplacer les données des mots de cette plage.",
        "Transcription, sous-titres et traductions hors plage inchangés.",
      ],
    },
    cleanup: {
      name: "Trouver des coupes",
      desc: "Trouver tics de langage, pauses et mauvaises prises ; vérifier avant coupe",
      setup: [
        "Chercher tics de langage, pauses d’au moins 0,8 s et débuts répétés.",
        "Liste de coupes proposées à confirmer avant toute coupe.",
      ],
    },
    translate: {
      name: "Traduire les sous-titres",
      desc: "Traduire chaque phrase et aligner les horaires avec les données des mots",
    },
    stale: {
      name: "Actualiser les traductions obsolètes",
      desc: "Retraduire seulement les phrases modifiées ou coupées à la source",
      setup: [
        "Retraduire seulement les sources modifiées : phrases éditées ou partiellement coupées.",
        "Traduire depuis la source coupée ; traductions des phrases entièrement coupées aussi retirées. Rien d’autre ne change.",
      ],
    },
    dub: {
      name: "Traduire le doublage",
      desc: "Choisir une langue, faire parler la vidéo comme le locuteur original ou natif ; les défauts suffisent",
    },
    summary: {
      name: "Rédiger un résumé",
      desc: "Texte et points clés horodatés ; cliquez l’horaire pour y aller",
    },
    blog: {
      name: "Rédiger un article de blog",
      desc: "Réécrire en article, du point de vue auteur ou spectateur",
    },
    title: {
      name: "Proposer des titres",
      desc: "Plusieurs candidats sous différents angles, puis choisir",
    },
    desc: {
      name: "Rédiger une description",
      desc: "Description de publication avec chapitres horodatés et tags",
    },
    cover: {
      name: "Créer une miniature",
      desc: "Créer plusieurs couvertures depuis les images clés, puis choisir",
    },
    soundtrack: {
      name: "Générer une bande-son",
      desc: "Créer sur cet ordinateur une musique de fond aussi longue que cette vidéo et l’ajouter à sa piste musicale",
    },
  } as Record<AiToolId, ToolText>,
  unknownTool: (id: string) => `Outil IA inconnu : ${id}`,
  cleanup: {
    fillers: {
      label: "Tics de langage",
      sub: "Mots comme « euh », « hum », « genre » et « vous voyez »",
      off: "tics de langage",
    },
    pauses: {
      label: "Pauses longues ≥ 0,8 s",
      sub: "Trouvés avec les horaires des mots",
      off: "longues pauses",
    },
    repeats: {
      label: "Débuts répétés",
      sub: "Phrase commencée deux fois ; seconde conservée",
      off: "débuts répétés",
    },
  } as Record<CleanupKey, { label: string; sub: string; off: string }>,

  cleanupOff: (offs: readonly string[]) => `Ne cherchez pas ${new Intl.ListFormat(intlLocale(), { type: "conjunction" }).format(offs)}`,
  lengths: { short: "Court", medium: "Moyen", long: "Long" } as Record<WriteLength, string>,
  styles: {
    plain: "Simple",
    pop: "Vulgarisation",
    sharp: "Piquant",
    light: "Détendu",
    pro: "Professionnel",
    custom: "Personnalisé…",
  } as Record<WriteStyle, string>,
  views: {
    auto: "Automatique",
    author: "Je suis l’auteur",
    viewer: "Je suis spectateur",
  } as Record<WriteView, string>,
  coverText: {
    none: "Aucun texte",
    phrase: "Une courte phrase",
    'phrase-sub': "Une phrase et une ligne de petit texte",
  } as Record<CoverText, string>,
  viewName: { author: "auteur", viewer: "spectateur" } as Record<'author' | 'viewer', string>,
  extraScope: (scope: string) => `Concentrez-vous sur ${scope}`,
  extraTopic: (topic: string) => `N’écrivez que sur « ${topic} » : trouvez d’abord avec speech_relevant les passages qui en parlent, puis écrivez à partir de ceux-ci`,
  extraLength: (label: string) => `Durée : ${label}`,
  extraStyle: (style: string) => `Style : ${style}`,
  extraLanguage: (language: string) => `Écrivez en ${language}`,
  extraView: (view: string) => `Point de vue : ${view}`,
  extraPlatform: (platform: string) => `Publication sur : ${platform}. Suivez ses règles et rappelez-moi de vérifier à la fin`,
  extraFrames: 'Là où une image est utile, prenez des images clés de la vidéo et insérez-les dans l’article, chacune avec une légende',
  extraIdea: (idea: string) => `Message unique de la couverture : ${idea}`,
  extraRatio: (ratio: string) => `Format ${ratio}`,
  extraCoverText: (label: string) => `Texte sur la couverture : ${label}`,

  titled: (title: string) => `« ${title} »`,
  thisVideo: "cette vidéo",

  sourceEdited: (n: number | null) => (n === null ? "source modifiée" : pluralForm('fr', n, { one: `${n} phrase modifiée dans la source`, other: `${n} phrases modifiées dans la source` })),
  sourceCut: (n: number | null) => (n === null ? "source coupée" : pluralForm('fr', n, { one: `${n} phrase coupée dans la source`, other: `${n} phrases coupées dans la source` })),
  sourceJoin: (parts: readonly string[]) => parts.join(", "),
  retranslateOne: (o) => `Retraduis la phrase ${o.time ? `à ${o.time} ` : ''}de ${o.p} (« ${o.text} ») vers la langue : ${o.language}. Ne modifie que la traduction de cette phrase ; garde le minutage, le style des sous-titres et toutes les autres phrases exactement tels quels.`,
  retranslateStale: (o) => `Dans la traduction (${o.language}) de ${o.p}, des phrases sont obsolètes ou pas encore traduites (${o.count}). Retraduis uniquement ces phrases et garde tout le reste exactement tel quel.`,
  intents: {
    shortscut: (o) => `Trouvez dans ${o.scope ? `${o.scope} de ${o.p}` : o.p} les sujets qui méritent le plus d’être publiés seuls et découpez chacun en une vidéo courte complète : chacune est une nouvelle vidéo qui référence le même métrage source, et la vidéo d’origine et sa timeline restent telles quelles.`,
    stale: (o: IntentArgs & { why: string }) =>
      `Des traductions de ${o.p} sont obsolètes${o.why ? ` (${o.why})` : " car la source a été modifiée"}. Retraduisez seulement ces phrases${o.cut ? " ; retraduisez les phrases coupées depuis la source coupée et retirez les traductions des phrases entièrement coupées" : ""}. Laissez tout le reste inchangé.`,
    polish: (o: IntentArgs) =>
      `Améliorez la transcription de ${scopeOf(o)} : corrigez fautes et ponctuation, divisez par sujet, sans réécrire mes mots.`,
    chapters: (o: IntentArgs) => `Divisez ${o.p} en chapitres par sujet avec un titre court.`,
    speakers: (o: IntentArgs) => `Identifiez les locuteurs dans ${scopeOf(o)}. Montrez-moi les résultats à confirmer avant écriture dans la vidéo.`,
    retranscribe: (o: IntentArgs) => `Retranscrivez ${scopeOf(o)} avec un autre modèle vocal ; laissez toute la partie hors plage inchangée.`,
    cleanup: (o: IntentArgs) =>
      `Trouvez tics de langage, longues pauses et débuts répétés dans ${scopeOf(o)}. Listez-les d’abord ; je confirmerai avant toute coupe.`,
    summary: (o: IntentArgs) => `Écrivez un résumé des points clés horodatés depuis la transcription de ${o.p}.`,
    blog: (o: IntentArgs) => `Réécrivez ${o.p} en article de blog prêt à publier.`,
    title: (o: IntentArgs & { count: number }) =>
      `Proposez ${o.count} titres candidats pour ${o.p}, sous des angles différents, avec une raison chacun, et recommandez-en un.`,
    desc: (o: IntentArgs) => `Écrivez une description de ${o.p} pour publication, avec chapitres horodatés et une ligne de tags.`,
    cover: (o: IntentArgs & { count: number }) =>
      `Créez ${o.count} couvertures candidates pour ${o.p} : choisissez les images clés, une approche différente par candidat, et vérifiez en petit format avant de me montrer.`,
  },

  endSentence: (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`),
  joinPrompt: (head: string, extra: readonly string[]) => [head, ...extra].join(" "),
  groupSub: { writing: 'Pour les lecteurs : savoir de quoi parle la vidéo sans la regarder', publish: 'Pour qui publie la vidéo : donner envie de cliquer, puis tenir la promesse' },
  laterNote: 'Traduire les sous-titres est encore dans le panneau Sous-titres et Traduire le doublage dans le panneau Audio ; ils arriveront ici plus tard. Le recadrage intelligent arrive bientôt.',
  effect: {
    shortscut: 'Crée de nouvelles vidéos enfants ; la vidéo d’origine et sa timeline restent telles quelles',
    polish: 'Modifie la transcription : appliqué à la fin, annulable en une étape',
    chapters: 'Modifie les chapitres : appliqué à la fin, annulable en une étape',
    speakers: 'Vous confirmez d’abord le résultat ; il n’est écrit dans la vidéo qu’une fois appliqué',
    retranscribe: 'Remplace la transcription de cette plage : appliqué à la fin, annulable en une étape',
    cleanup: 'Propose seulement des coupes ; rien n’est coupé avant votre confirmation',
    stale: 'Retraduit seulement les phrases obsolètes ; le reste ne change pas',
    summary: 'Ne modifie pas la vidéo : le résultat est à lire et à copier',
    blog: 'Ne modifie pas la vidéo : le résultat est à lire et à copier',
    title: 'Ne modifie pas la vidéo : choisissez-en un à utiliser',
    desc: 'Ne modifie pas la vidéo : le résultat est à lire et à copier',
    cover: 'Ne modifie pas la vidéo : choisissez-en une à utiliser',
  },
  standMarkdown: (language) => (language ? `Écris en Markdown, en ${language}.` : 'Écris en Markdown, dans la même langue que la transcription.'),
  standLanguage: (language) => (language ? `Écris en ${language}.` : 'Écris dans la même langue que la transcription.'),
  standing: {
    summary: ['Commence par la conclusion, puis liste les points clés, chacun avec son code temporel (mm:ss).', 'Longueur modérée : trois à cinq paragraphes.'],
    blog: ['Choisis le point de vue selon la source de la vidéo : en tant qu’auteur si c’est ma vidéo, en tant que spectateur si c’est celle de quelqu’un d’autre.', 'Style simple, sans ton marketing.'],
    title: ['Mets chaque proposition sur sa propre ligne.'],
    desc: ['Inclus les codes temporels des chapitres et une ligne de tags.'],
    cover: ['Le texte de la couverture est dans la langue de la transcription.'],
    polish: ['Ne réécris pas mes formulations et ne supprime rien ; corrige seulement les erreurs évidentes.'],
    chapters: ['Regroupe par sujet, avec un titre court pour chaque chapitre.'],
  },
  sessionNew: 'Nouvelle session',
  sessionNewSub: 'Prend cette vidéo comme contexte ; une tâche par session, sans renvoyer un long historique',
  sessionCurrent: (title) => `Continuer « ${title} »`,
  sessionUntitled: 'la session de cette vidéo',
  sessionCurrentSub: (messages) =>
    messages === null
      ? 'Renvoie l’historique de la session, ce qui coûte plus cher une fois le cache du prompt expiré'
      : `${messages <= 1 ? `${messages} message` : `${messages} messages`} jusqu’ici · renvoie l’historique, ce qui coûte plus cher une fois le cache du prompt expiré`,
  hintNew: 'Démarre une nouvelle session avec cette vidéo comme contexte. Suivez-la là-bas ; toute modification de la vidéo par l’agent peut être annulée.',
  hintCurrent: 'Envoie à la session actuelle de cette vidéo, avec la vidéo comme contexte. Suivez-la là-bas ; toute modification de la vidéo par l’agent peut être annulée.',
};
