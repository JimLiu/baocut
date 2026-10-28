import type { ProvidersAgentMessages } from './providers-agent.ts';
export const es: ProvidersAgentMessages = {
 codexUpgradeHint: 'Actualiza Codex CLI (por ejemplo, npm install -g @openai/codex@latest) y comprueba de nuevo', codexImageModel: 'Generación de imágenes de Codex (modelo elegido por Codex y tu cuenta)',
 codexImageNotes: 'Genera con la cuenta de Codex que ha iniciado sesión en este ordenador: un PNG cada vez, una tarea a la vez, normalmente en uno o dos minutos. No se pueden establecer tamaño ni semilla (las solicitudes que los incluyen se rechazan) y el tamaño en píxeles depende del resultado. Usa tu cuota de suscripción; se desconoce la cuota restante. Activarlo significa aceptar enviar prompts a tu cuenta de Codex.',
 codexImageNotesApiKey:
   "Codex ha iniciado sesión con una clave de API u otro método que no es ChatGPT, así que es posible que no pueda generar imágenes y el coste se carga a esa cuenta, no a una suscripción. BaoCut no lo elegirá automáticamente; elígelo tú para probar. Un PNG cada vez; no se pueden fijar el tamaño ni la semilla.",
 imagesOnly: (p) => `${p.label} solo puede generar imágenes`, onePngOnly: (p) => `${p.label} genera un PNG a la vez y no admite tamaño ni semilla`, unavailable: (p) => `${p.label} no está disponible: ${p.message}`, sessionNotStarted: (p) => `La sesión de ${p.label} no empezó: ${p.error}`,
 timedOut: (p) => `${p.label} no terminó en ${p.minutes} minutos y se interrumpió`, exited: (p) => `${p.label} terminó inesperadamente: ${p.message}`, notCompleted: (p) => `${p.label} no terminó esta generación: ${p.reason}`, turnInterrupted: 'el turno se interrumpió',
 noImage: (p) => `${p.label} no generó una imagen`, noImageReply: (p) => `${p.label} no generó una imagen: ${p.reply}`, unknownError: 'Error desconocido', processExited: 'El proceso terminó', turnNotStarted: (p) => `El turno no empezó: ${p.error}`,
  codexTextModel: "Modelo predeterminado del agente",
  codexTextNotes:
    "Escribe con la cuenta de Codex que ha iniciado sesión en este ordenador: una solicitud a la vez, cada una en una sesión nueva de Codex, así que es más lento que una API. No se pueden establecer la temperatura, la semilla ni la longitud de la salida. Usa la cuota de tu suscripción; la cuota restante es desconocida. Activarlo significa aceptar enviar las instrucciones, incluido el texto de transcripción que contengan, a tu cuenta de Codex.",
  codexTextNotesApiKey:
    "Codex ha iniciado sesión con una clave de API u otro método que no es ChatGPT, así que el coste se carga a esa cuenta, no a una suscripción. Una solicitud a la vez; no se pueden establecer la temperatura, la semilla ni la longitud de la salida.",
};
