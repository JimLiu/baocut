import type { ProvidersAgentMessages } from './providers-agent.ts';
export const es: ProvidersAgentMessages = {
 codexUpgradeHint: 'Actualiza Codex CLI (por ejemplo, npm install -g @openai/codex@latest) y comprueba de nuevo', codexImageModel: 'Generación de imágenes de Codex (modelo elegido por Codex y tu cuenta)',
 codexImageNotes: 'Genera con la cuenta de Codex que ha iniciado sesión en este ordenador: un PNG cada vez, una tarea a la vez, normalmente en uno o dos minutos. No se pueden establecer tamaño ni semilla (las solicitudes que los incluyen se rechazan) y el tamaño en píxeles depende del resultado. Usa tu cuota de suscripción; se desconoce la cuota restante. Activarlo significa aceptar enviar prompts a tu cuenta de Codex.',
 imagesOnly: (p) => `${p.label} solo puede generar imágenes`, onePngOnly: (p) => `${p.label} genera un PNG a la vez y no admite tamaño ni semilla`, unavailable: (p) => `${p.label} no está disponible: ${p.message}`, sessionNotStarted: (p) => `La sesión de ${p.label} no empezó: ${p.error}`,
 timedOut: (p) => `${p.label} no terminó en ${p.minutes} minutos y se interrumpió`, exited: (p) => `${p.label} terminó inesperadamente: ${p.message}`, notCompleted: (p) => `${p.label} no terminó esta generación: ${p.reason}`, turnInterrupted: 'el turno se interrumpió',
 noImage: (p) => `${p.label} no generó una imagen`, noImageReply: (p) => `${p.label} no generó una imagen: ${p.reply}`, unknownError: 'Error desconocido', processExited: 'El proceso terminó', turnNotStarted: (p) => `El turno no empezó: ${p.error}`,
};
