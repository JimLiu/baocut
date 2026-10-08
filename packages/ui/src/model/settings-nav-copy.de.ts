import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const de: SettingsNavMessages = {
  category: {
    asr: { label: "Spracherkennung", description: "Sprache in Transkripte und Untertitel umwandeln und Sprecher unterscheiden." },
    tts: { label: "Sprachsynthese", description: "Sprache erzeugen, Stimmen klonen und Videos vertonen." },
    llm: { label: "Texterzeugung", description: "Transkripte überarbeiten, Untertitel übersetzen und Text erzeugen." },
    image: { label: "Bilderzeugung", description: "Bilder und Titelbilder für Videos erzeugen." },
    sep: { label: "Quellentrennung", description: "Stimmen, Begleitung und Hintergrundgeräusche trennen." },
    vision: { label: "Bildverständnis", description: "Personen, Sprecher und Bildinhalte für intelligentes Zuschneiden erkennen." },
  },
  page: { local: "Lokale Modelle", cloud: "Cloud-Modelle", voices: "Meine Stimmen" },
  onlyPage: {
    local: "Diese Kategorie enthält nur lokale Modelle auf diesem Computer; noch keine Cloud-Modelle.",
    cloud: "Texterzeugung hat nur Cloud-Modelle. Coding-Agenten unter „Agent“ einrichten.",
  },
  section: {
    general: "Allgemein",
    shortcuts: "Tastenkürzel",
    fonts: "Schriften",
    agent: "Agentenanbieter",
    skills: "Skills",
    glossary: "Glossar",
    privacy: "Datenschutz und Berechtigungen",
    diagnostics: "Diagnose",
    about: "Über",
  },
  group: { preferences: "Voreinstellungen", agents: "Agent", app: "App" },
};
