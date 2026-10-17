import type { SettingsNavMessages } from './settings-nav-copy.ts';
export const es: SettingsNavMessages = {
 category: {
 asr: { label: 'Reconocimiento de voz', description: 'Convierte la voz en transcripciones y subtítulos, y distingue a los hablantes.' },
 tts: { label: 'Síntesis de voz', description: 'Genera voz, clona voces y crea doblajes para vídeos.' },
 llm: { label: 'Generación de texto', description: 'Mejora transcripciones, traduce subtítulos y genera texto.' },
 image: { label: 'Generación de imágenes', description: 'Genera las imágenes y portadas que necesitan tus vídeos.' },
 sep: { label: 'Separación de fuentes', description: 'Separa voces, acompañamiento y sonido de fondo.' },
 music: { label: 'Generación de música', description: 'Genera canciones y música de fondo para tus vídeos en este equipo.' },
 vision: { label: 'Comprensión visual', description: 'Reconoce personas, hablantes y lo que hay en pantalla para ayudar con el recorte inteligente.' },
 },
 page: { models: 'Modelos', voices: 'Mis voces' },
 onlyPage: { local: 'Esta categoría solo tiene modelos locales que se ejecutan en este ordenador; aún no la ofrece ningún proveedor de API.', cloud: 'La generación de texto solo usa modelos de proveedores de API. Los agentes de código se configuran en «Agente».' },
 section: { general: 'General', shortcuts: 'Atajos', fonts: 'Fuentes', downloader: 'Descarga de vídeos', semantic: 'Índice semántico', agent: 'Proveedores de agentes', providers: 'Proveedores de API', usage: 'Uso', glossary: 'Glosario', privacy: 'Privacidad y permisos', diagnostics: 'Diagnóstico', about: 'Acerca de' },
 group: { preferences: 'Preferencias', agents: 'Agente', app: 'Aplicación' },
};
