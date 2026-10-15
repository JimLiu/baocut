import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const it: SettingsNavMessages = {
  category: {
    asr: { label: "Riconoscimento vocale", description: "Trasforma il parlato in trascrizioni e sottotitoli e distingui i parlanti." },
    tts: { label: "Sintesi vocale", description: "Genera voce, clona voci e crea doppiaggi per i video." },
    llm: { label: "Generazione di testo", description: "Migliora le trascrizioni, traduci i sottotitoli e genera testo." },
    image: { label: "Generazione di immagini", description: "Genera le immagini e le copertine necessarie per i tuoi video." },
    sep: { label: "Separazione delle sorgenti", description: "Separa voci, accompagnamento e suono di sottofondo." },
    music: { label: 'Generazione di musica', description: 'Genera canzoni e musiche di sottofondo per i tuoi video su questo computer.' },
    vision: { label: "Comprensione visiva", description: "Riconosci persone, parlanti e contenuti sullo schermo per aiutare il ritaglio intelligente." },
  },
  page: { models: "Modelli", voices: "Le mie voci" },
  onlyPage: {
    local: "Questa categoria ha solo modelli locali eseguiti su questo computer; nessun provider API la offre ancora.",
    cloud: "La generazione di testo usa solo modelli di provider API. Gli agenti di codice vengono configurati in «Provider degli agenti».",
  },
  section: {
    general: "Generali",
    shortcuts: "Scorciatoie",
    fonts: "Font",
    downloader: 'Download dei video',
    semantic: 'Indice semantico',
    agent: "Provider degli agenti",
    skills: "Skill",
    providers: "Provider API",
    usage: "Utilizzo",
    glossary: "Glossario",
    privacy: "Privacy e permessi",
    diagnostics: "Diagnostica",
    about: "Informazioni",
  },
  group: { preferences: "Preferenze", agents: "Agente", app: "App" },
};
