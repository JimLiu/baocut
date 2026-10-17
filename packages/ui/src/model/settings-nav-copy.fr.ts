import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const fr: SettingsNavMessages = {
  category: {
    asr: { label: "Reconnaissance vocale", description: "Transformer la parole en transcriptions et sous-titres, distinguer les locuteurs." },
    tts: { label: "Synthèse vocale", description: "Synthétiser, cloner les voix et doubler les vidéos." },
    llm: { label: "Génération de texte", description: "Améliorer les transcriptions, traduire les sous-titres et générer du texte." },
    image: { label: "Génération d’images", description: "Générer images et couvertures vidéo." },
    sep: { label: "Séparation de sources", description: "Séparer voix, accompagnement et fond sonore." },
    music: { label: 'Génération de musique', description: 'Générer des chansons et des musiques de fond pour vos vidéos sur cet ordinateur.' },
    vision: { label: "Compréhension visuelle", description: "Reconnaître personnes, locuteurs et contenu pour le recadrage intelligent." },
  },
  page: { models: "Modèles", voices: "Mes voix" },
  onlyPage: {
    local: "Catégorie avec modèles locaux seulement ; aucun fournisseur d’API ne la propose encore.",
    cloud: "Texte : modèles des fournisseurs d’API seulement. Agents de code configurés sous « Agent ».",
  },
  section: {
    general: "Général",
    shortcuts: "Raccourcis",
    fonts: "Polices",
    downloader: 'Téléchargement de vidéos',
    semantic: 'Index sémantique',
    agent: "Fournisseurs d’Agents",
    providers: "Fournisseurs d’API",
    usage: "Utilisation",
    glossary: "Glossaire",
    privacy: "Confidentialité et autorisations",
    diagnostics: "Diagnostic",
    about: "À propos",
  },
  group: { preferences: "Préférences", agents: "Agent", app: "Application" },
};
