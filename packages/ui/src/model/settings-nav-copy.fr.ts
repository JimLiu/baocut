import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const fr: SettingsNavMessages = {
  category: {
    asr: { label: "Reconnaissance vocale", description: "Transformer la parole en transcriptions et sous-titres, distinguer les locuteurs." },
    tts: { label: "Synthèse vocale", description: "Synthétiser, cloner les voix et doubler les vidéos." },
    llm: { label: "Génération de texte", description: "Améliorer les transcriptions, traduire les sous-titres et générer du texte." },
    image: { label: "Génération d’images", description: "Générer images et couvertures vidéo." },
    sep: { label: "Séparation de sources", description: "Séparer voix, accompagnement et fond sonore." },
    vision: { label: "Compréhension visuelle", description: "Reconnaître personnes, locuteurs et contenu pour le recadrage intelligent." },
  },
  page: { local: "Modèles locaux", cloud: "Modèles cloud", voices: "Mes voix" },
  onlyPage: {
    local: "Catégorie avec modèles locaux seulement, sans cloud pour l’instant.",
    cloud: "Texte : modèles cloud seulement. Agents de code configurés sous « Agent ».",
  },
  section: {
    general: "Général",
    shortcuts: "Raccourcis",
    fonts: "Polices",
    agent: "Fournisseurs d’Agents",
    skills: "Skills",
    glossary: "Glossaire",
    privacy: "Confidentialité et autorisations",
    diagnostics: "Diagnostic",
    about: "À propos",
  },
  group: { preferences: "Préférences", agents: "Agent", app: "Application" },
};
