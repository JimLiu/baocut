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
  baocut skill install [--dir <carpeta>]… [--agent agents|claude] [--copy]
                                   Instala la skill de BaoCut para agentes externos (cómo usar BaoCut). Por defecto en
                                   ~/.agents/skills/baocut (Codex y otros agentes) y ~/.claude/skills/baocut (Claude Code),
                                   como enlaces a la skill dentro de la app de BaoCut, así se actualiza con la app
    --dir <carpeta>                Instala en <carpeta>/.agents/skills y <carpeta>/.claude/skills: cualquier carpeta,
                                   no solo un proyecto de BaoCut; repítelo para varias
    --agent agents|claude          Solo una de las dos: .agents/skills o .claude/skills
    --copy                         Copia en vez de enlazar (una copia no sigue las actualizaciones: vuelve a instalar)
  baocut skill status              La versión de la skill en la app, dónde está instalada y si cada una está al día,
                                   y el comando baocut de tu terminal
  baocut skill remove [--dir <carpeta>]… [--agent agents|claude] [--yes]
                                   La quita: de un enlace solo se quita el enlace; borrar una copia requiere --yes.
                                   Lo que haya en baocut/ que no sea la skill de BaoCut nunca se reemplaza ni se borra`,
  installedAt: (path, linkTarget) => `Instalada en ${path}${linkTarget ? ` → ${linkTarget}` : ' (copia)'}`,
  takesEffect: 'Se aplica en una sesión nueva del agente',
  removedAt: (path) => `Quitada de ${path}`,
  removeCopies: (paths) =>
    `${paths.join(', ')} ${paths.length === 1 ? 'es una copia' : 'son copias'}: al quitarla se borran los archivos, también lo que se haya editado allí. Añade --yes para borrar`,
  unknownAgent: (value) => `--agent acepta agents (.agents/skills) o claude (.claude/skills): ${value}`,
  fixHint: 'Hay instalaciones desactualizadas o rotas: baocut skill install (con el mismo --dir) las arregla',
  statusSkill: (version, source, bundled) => `Skill     ${version ?? '?'}  ${source}${bundled ? '' : ' (versión de desarrollo: la genera el Runtime)'}`,
  statusCli: (entry) => `CLI       ${entry ?? 'no incluida (versión de desarrollo)'}`,
  statusOnPath: (path, target, fromApp) => `Terminal  ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (de esta app)' : ' (no es de esta app)'}`,
  statusNotOnPath: (command) => `Terminal  baocut no está en el PATH${command ? `; para usarlo en cualquier terminal: ${command}` : ''}`,
  statusAddToPath: (dir) => `Terminal  baocut no está en el PATH; para usarlo en cualquier terminal, añade ${dir} al PATH de tu usuario`,
  appOutsideApplications: 'BaoCut no se está ejecutando desde la carpeta Aplicaciones: los enlaces se rompen si mueves o borras la app',
  globalHeading: 'Global',
  state: { none: 'Sin instalar', current: 'Al día', stale: 'Desactualizada', broken: 'Enlace roto', foreign: 'Hay otra cosa (no se toca)' },
  mode: { link: 'Enlace', copy: 'Copia' },
};
