import type { SettingsNavMessages } from './settings-nav-copy.ts';
export const es: SettingsNavMessages = {
 category: {
 asr: { label: 'Reconocimiento de voz', description: 'Convierte la voz en transcripciones y subtítulos, y distingue a los hablantes.' },
 tts: { label: 'Síntesis de voz', description: 'Genera voz, clona voces y crea doblajes para vídeos.' },
 llm: { label: 'Generación de texto', description: 'Mejora transcripciones, traduce subtítulos y genera texto.' },
 image: { label: 'Generación de imágenes', description: 'Genera las imágenes y portadas que necesitan tus vídeos.' },
 sep: { label: 'Separación de fuentes', description: 'Separa voces, acompañamiento y sonido de fondo.' },
 vision: { label: 'Comprensión visual', description: 'Reconoce personas, hablantes y lo que hay en pantalla para ayudar con el recorte inteligente.' },
 },
 page: { local: 'Modelos locales', cloud: 'Modelos en la nube', voices: 'Mis voces' },
 onlyPage: { local: 'Esta categoría solo tiene modelos locales que se ejecutan en este ordenador; aún no hay modelos en la nube.', cloud: 'La generación de texto solo tiene modelos en la nube. Los agentes de código se configuran en «Agente».' },
 section: { general: 'General', shortcuts: 'Atajos', fonts: 'Fuentes', agent: 'Proveedores de agentes', skills: 'Skills', glossary: 'Glosario', privacy: 'Privacidad y permisos', diagnostics: 'Diagnóstico', about: 'Acerca de' },
 group: { preferences: 'Preferencias', agents: 'Agente', app: 'Aplicación' },
};
