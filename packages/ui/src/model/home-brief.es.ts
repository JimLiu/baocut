import type { HomeBriefMessages } from './home-brief.ts';
export const es: HomeBriefMessages = {
 about: (minutes, seconds) => `Unos ${[minutes ? `${minutes} min` : '', seconds ? `${seconds} s` : ''].filter(Boolean).join(' ')}`,
 fromMaterials: 'Crea un vídeo con los materiales que adjunté.', materials: (paths) => `Materiales: ${paths.join(', ')}`,
 connectFirst: 'Primero conecta la IA', sayFirst: 'Di qué quieres crear o adjunta materiales',
 agentOffTitle: 'Todos los agentes de código instalados están desactivados',
 agentOffBody: 'Hay un agente de código instalado en este ordenador, pero está desactivado en Ajustes. Activa uno para empezar aquí mismo.',
 enableNamed: (name) => `Activar ${name}`, enableAgent: 'Activar agente',
 agentMissingTitle: 'Esto necesita un agente de código',
 agentMissingBody: 'Instala Claude Code o Codex CLI e inicia sesión con tu propia suscripción; después vuelve aquí para empezar.',
 connectAgent: 'Conectar agente', nameEmpty: 'Introduce un nombre de proyecto', nameInvalid: 'El nombre del proyecto no puede contener barras ni caracteres de control',
};
