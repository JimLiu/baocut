import { pluralForm } from '@baocut/protocol';
import { intlLocale } from '@baocut/protocol';
import type { AiToolId, AiToolGroup, CleanupKey, WriteLength, WriteStyle, WriteView, CoverText } from './ai-tools.ts';
type IntentArgs = { p: string; scope: string | null; edited: number | boolean; cut: number | boolean; count: number | null };
type ToolText = { name: string; desc: string; setup?: readonly string[]; why?: string };
const soonTail = 'Le Runtime n’a pas encore ce flux ni de superposition pour ajuster le cadrage ; aucun formulaire disponible ici.';
const scopeOf = (o: IntentArgs) => o.scope ? `${o.scope} de ${o.p}` : o.p;
import type { AiToolsMessages } from './ai-tools.ts';

export const fr: AiToolsMessages = {
  groups: {
    frame: "Cadre",
    transcript: "Transcription",
    translate: "Traduction",
    writing: "Écriture",
    publish: "Publication",
  } as Record<AiToolGroup, string>,
  tools: {
    crop: {
      name: "Recadrage intelligent",
      desc: "Changer le format en gardant locuteurs, tableaux blancs et sujets clés dans le cadre",
      why: `Le recadrage intelligent suit locuteurs, tableaux et sujets clés, puis recadre au nouveau format. ${soonTail}`,
    },
    shortscut: {
      name: "Découper en vidéos courtes",
      desc: "Choisir plusieurs segments et faire un court vertical de chacun",
      why: `Créer des courts = choisir des segments, recadrer chacun verticalement et ajuster le cadre segment par segment. ${soonTail}`,
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
  extraLength: (label: string) => `Durée : ${label}`,
  extraStyle: (style: string) => `Style : ${style}`,
  extraLanguage: (language: string) => `Écrivez en ${language}`,
  extraView: (view: string) => `Point de vue : ${view}`,
  extraPlatform: (platform: string) => `Publication sur : ${platform}. Suivez ses règles et rappelez-moi de vérifier à la fin`,
  extraIdea: (idea: string) => `Message unique de la couverture : ${idea}`,
  extraRatio: (ratio: string) => `Format ${ratio}`,
  extraCoverText: (label: string) => `Texte sur la couverture : ${label}`,

  titled: (title: string) => `« ${title} »`,
  thisVideo: "cette vidéo",

  sourceEdited: (n: number | null) => (n === null ? "source modifiée" : pluralForm('fr', n, { one: `${n} phrase modifiée dans la source`, other: `${n} phrases modifiées dans la source` })),
  sourceCut: (n: number | null) => (n === null ? "source coupée" : pluralForm('fr', n, { one: `${n} phrase coupée dans la source`, other: `${n} phrases coupées dans la source` })),
  sourceJoin: (parts: readonly string[]) => parts.join(", "),
  intents: {
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
};
