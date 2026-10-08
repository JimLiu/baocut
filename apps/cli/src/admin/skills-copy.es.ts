import type { SkillsMessages } from './skills-copy.ts';
import { pluralForm } from '@baocut/protocol';
export const es: SkillsMessages = {
 skillsHelp: `Uso:
  baocut skills add <folder>       Copiar una carpeta local de skill (con SKILL.md en la raíz)
                                   a <BAOCUT_HOME>/skills, activada por defecto
  baocut skills import <source>    Importar una skill de GitHub: owner/repo, URL de repositorio o
                                   …/tree/<branch>/<folder>; desactivada por defecto, revísala antes de activarla
    --id <id>                      Para add e import: usar otro ID (derivado del nombre de carpeta
                                   por defecto; se rechaza si existe, nunca se sobrescribe)
  baocut skills enable|disable <id>
                                   Activar / desactivar una skill: se aplica desde la siguiente sesión nueva del agente
  baocut skills remove <id>        Eliminar una skill añadida o importada (las integradas solo se pueden desactivar)`,
 added: 'Añadida', imported: 'Importada', turnedOn: 'Activada', turnedOff: 'Desactivada', reviewFirst: (id) => `Revísala primero (baocut skills read ${id}) y actívala con baocut skills enable ${id}`, takesEffectNextSession: 'Se aplica desde la siguiente sesión nueva del agente; las sesiones en curso no se ven afectadas', removed: (id, path) => `Eliminada ${id} (${path})`, localSource: (path, addedAt) => `carpeta local ${path} (${addedAt})`, remoteSource: (url, ref, commit, importedAt) => `${url} (${ref}@${commit}, ${importedAt})`, changed: (verb, id, name, enabled, path, source) => `${verb} ${id} (${name}, ${enabled ? 'activada' : 'desactivada'}) → ${path}${source ? `\nOrigen: ${source}` : ''}`, idFormat: (flag, value) => `${flag} acepta un ID de skill (minúsculas, separado por guiones, consulta baocut skills): ${value}`,
 skillHelp: `Uso:
  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <folder>] [--link] [--yes]
                                   Instalar la skill de BaoCut para agentes externos (cómo usar BaoCut) en baocut/
                                   de la carpeta de skills del agente: Claude Code ~/.claude/skills, Codex ~/.codex/skills,
                                   Cursor ~/.cursor/skills, Gemini CLI ~/.gemini/skills
    --dir <folder>                 Usar otra carpeta de skills (instala en baocut/ dentro de ella); obligatorio sin --agent
    --link                         Colocar la skill renderizada en <BAOCUT_HOME>/agent-skills/baocut y un enlace a ella en el
                                   agente: instalar de nuevo después (para cualquier agente) actualiza todos
    --yes                          Reemplazar el destino si existe (para un enlace, solo reemplaza el enlace, no la
                                   carpeta a la que apunta); sin él no se sobrescribe nada
  baocut skill path                Origen de la skill de BaoCut, dónde la instala cada agente y qué está
                                   instalado ahora (no necesita el Runtime)`,
 targetExists: (target, linkTarget) => `${target} ya existe (${linkTarget !== null ? `un enlace a ${linkTarget}` : 'una carpeta o archivo'}); no se cambió nada. Añade --yes para reemplazarlo`, installed: (target, files, linkTo) => `Skill de BaoCut instalada en ${target} (${files} ${pluralForm('es', files, { one: 'archivo', other: 'archivos' })}${linkTo ? `, vinculada a ${linkTo}` : ''})`, takesEffect: (host) => host ? `Se aplica en una sesión nueva de ${host}` : 'Se aplica en una sesión nueva', pathEscapes: (path) => `Una ruta de la skill de BaoCut apunta fuera de su carpeta: ${path}`, sourceLine: (dir) => `Origen    ${dir ?? 'no encontrado (BaoCut no está instalado y este no es el repositorio; puedes establecer BAOCUT_AGENT_SKILLS_DIR)'}`, notInstalled: 'Sin instalar', linkState: (target) => `Enlace → ${target}`, installedFolder: 'Instalada (carpeta)', isFile: 'Un archivo (no una carpeta de skill)',
};
