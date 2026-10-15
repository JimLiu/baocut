import type { SettingsNavMessages } from './settings-nav-copy.ts';

export const ptBR: SettingsNavMessages = {
  category: {
    asr: { label: "Reconhecimento de fala", description: "Transforme fala em transcrições e legendas e diferencie os falantes." },
    tts: { label: "Síntese de fala", description: "Gere fala, clone vozes e crie dublagens para vídeos." },
    llm: { label: "Geração de texto", description: "Melhore transcrições, traduza legendas e gere texto." },
    image: { label: "Geração de imagens", description: "Gere as imagens e capas de que seus vídeos precisam." },
    sep: { label: "Separação de fontes", description: "Separe vocais, acompanhamento e som de fundo." },
    music: { label: 'Geração de música', description: 'Gere músicas e trilhas de fundo para seus vídeos neste computador.' },
    vision: { label: "Compreensão visual", description: "Reconheça pessoas, falantes e o conteúdo da tela para ajudar no recorte inteligente." },
  },
  page: { models: "Modelos", voices: "Minhas vozes" },
  onlyPage: {
    local: "Esta categoria só tem modelos locais que executam neste computador; nenhum provedor de API a oferece ainda.",
    cloud: "A geração de texto só usa modelos de provedores de API. Agentes de código são configurados em “Agente”.",
  },
  section: {
    general: "Geral",
    shortcuts: "Atalhos",
    fonts: "Fontes",
    downloader: 'Download de vídeos',
    semantic: 'Índice semântico',
    agent: "Provedores de agentes",
    skills: "Skills",
    providers: "Provedores de API",
    usage: "Uso",
    glossary: "Glossário",
    privacy: "Privacidade e permissões",
    diagnostics: "Diagnóstico",
    about: "Sobre",
  },
  group: { preferences: "Preferências", agents: "Agente", app: "Aplicativo" },
};
