import type { ChatMessages } from './chat-copy.ts';
export const es: ChatMessages = {
 help: `Uso:
  baocut chat <message> [options]  Enviar un mensaje e imprimir la respuesta
    --project <dir>                Conversar en esta carpeta de proyecto (el proyecto se identifica
                                   mediante .bcut/project.json, que se escribe si falta)
    --conversation <id>            Continuar una sesión existente
    --template <id>                Adjuntar una plantilla de escena (una escena de baocut templates): el Runtime añade la
                                   guía de briefing y el cuerpo de la plantilla al mensaje; no se pueden adjuntar ejemplos;
                                   envía el prompt de un ejemplo (baocut templates show <id>) como mensaje en su lugar
    --skill <id>                   Elegir una skill (de baocut skills, incluso una desactivada):
                                   el Runtime añade el cuerpo de su SKILL.md al mensaje
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   Cambiar el modo de acceso de esta sesión (las acciones posteriores lo siguen); si se omite, la sesión conserva
                                   su modo o usa agent.defaultAccessMode (auto por defecto) si el modo nunca se cambió
    --yes                          Aprobar solicitudes automáticamente (solo esta sesión)`,
 missingMessage: 'Falta el texto del mensaje', templateIsExample: (title, id) => `«${title}» es un ejemplo y no se puede adjuntar: obtén su prompt con baocut templates show ${id} y envíalo como mensaje`, sessionCreated: (id, cwd) => `Sesión ${id}  carpeta de trabajo ${cwd}`, disconnected: (reason) => `Se perdió la conexión con el Runtime: ${reason}`, sessionDeleted: 'La sesión se eliminó', stopping: 'Deteniendo…', chatTemplate: (id) => `Plantilla: ${id}`, chatSkill: (id) => `Skill: ${id}`, chatMode: (mode) => `Modo de acceso: ${mode}`,
 taskEnded: (status, error) => `Tarea: ${status}${error ? ` — ${error}` : ''}`, taskStatus: { completed: 'Completado', stopped: 'Detenido', failed: 'Fallido' }, taskFailed: 'La tarea falló', toolCallFinished: (title, status, exitCode) => `▸ ${title} — ${status}${exitCode !== null ? ` (código de salida ${exitCode})` : ''}`, approvalNeeded: (what) => `Se necesita aprobación — ${what}`, approvalReason: (isTool, reason) => `${isTool ? 'Contenido' : 'Motivo'}: ${reason}`, approvalMode: (mode) => `Modo actual: ${mode}`, autoApproved: 'Aprobado automáticamente (--yes)', declinedNotTty: 'No se ejecuta en un terminal: denegado (añade --yes para aprobar automáticamente)', approvalQuestion: '¿Aprobar? [y] sí / [s] sesión / [N] no ',
};
