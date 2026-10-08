import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const ptBR: SettingsNavMessages = {
  category: {
    asr: { label: "Reconhecimento de fala", description: "Transforme fala em transcrições e legendas e diferencie os falantes." },
    tts: { label: "Síntese de fala", description: "Gere fala, clone vozes e crie dublagens para vídeos." },
    llm: { label: "Geração de texto", description: "Melhore transcrições, traduza legendas e gere texto." },
    image: { label: "Geração de imagens", description: "Gere as imagens e capas de que seus vídeos precisam." },
    sep: { label: "Separação de fontes", description: "Separe vocais, acompanhamento e som de fundo." },
    vision: { label: "Compreensão visual", description: "Reconheça pessoas, falantes e o conteúdo da tela para ajudar no recorte inteligente." },
  },
  page: { local: "Modelos locais", cloud: "Modelos de nuvem", voices: "Minhas vozes" },
  onlyPage: {
    local: "Esta categoria só tem modelos locais que executam neste computador; ainda não há modelos de nuvem.",
    cloud: "A geração de texto só tem modelos de nuvem. Agentes de código são configurados em “Agente”.",
  },
  section: {
    general: "Geral",
    shortcuts: "Atalhos",
    fonts: "Fontes",
    agent: "Provedores de agentes",
    skills: "Skills",
    glossary: "Glossário",
    privacy: "Privacidade e permissões",
    diagnostics: "Diagnóstico",
    about: "Sobre",
  },
  group: { preferences: "Preferências", agents: "Agente", app: "Aplicativo" },
};
