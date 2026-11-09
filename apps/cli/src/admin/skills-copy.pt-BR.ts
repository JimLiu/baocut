import type { SkillsMessages } from './skills-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: SkillsMessages = {
  skillsHelp: `Uso:
  baocut skills add <folder>       Copiar uma pasta local de skill (com SKILL.md na raiz)
                                   para <BAOCUT_HOME>/skills, ativada por padrão
  baocut skills import <source>    Importar uma skill do GitHub: owner/repo, URL de repositório ou
                                   …/tree/<branch>/<folder>; desativada por padrão, revise antes de ativar
    --id <id>                      Para add e import: usar outro id (derivado do nome da pasta
                                   por padrão; recusado se o id existir, nunca sobrescrito)
  baocut skills enable|disable <id>
                                   Ativar/desativar uma skill: aplicado na próxima nova sessão de agente
  baocut skills remove <id>        Excluir uma skill adicionada ou importada (as integradas só podem ser desativadas)`,
  added: 'Adicionada', imported: 'Importada', turnedOn: 'Ativada', turnedOff: 'Desativada', reviewFirst: (id) => `Revise primeiro (baocut skills read ${id}) e ative com baocut skills enable ${id}`, takesEffectNextSession: 'Aplicado na próxima nova sessão de agente; sessões já em andamento não são afetadas', removed: (id, path) => `Excluída: ${id} (${path})`, localSource: (path, addedAt) => `pasta local ${path} (${addedAt})`, remoteSource: (url, ref, commit, importedAt) => `${url} (${ref}@${commit}, ${importedAt})`, changed: (verb, id, name, enabled, path, source) => `${verb} ${id} (${name}, ${enabled ? 'ativada' : 'desativada'}) → ${path}${source ? `\nOrigem: ${source}` : ''}`, idFormat: (flag, value) => `${flag} aceita um id de skill (minúsculas, separado por hífens, veja baocut skills): ${value}`,
  skillHelp: `Uso:
  baocut skill install [--dir <pasta>]… [--agent agents|claude] [--copy]
                                   Instala a skill do BaoCut para agentes externos (como usar o BaoCut). Por padrão em
                                   ~/.agents/skills/baocut (Codex e outros agentes) e ~/.claude/skills/baocut (Claude Code),
                                   como links para a skill dentro do app BaoCut, então ela atualiza com o app
    --dir <pasta>                  Instala em <pasta>/.agents/skills e <pasta>/.claude/skills: qualquer pasta, não só
                                   um projeto do BaoCut; repita para várias pastas
    --agent agents|claude          Só uma das duas: .agents/skills ou .claude/skills
    --copy                         Copia em vez de criar link (uma cópia não acompanha as atualizações: instale de novo)
  baocut skill status              A versão da skill no app, onde está instalada e se cada local está atualizado,
                                   e o comando baocut do seu terminal
  baocut skill remove [--dir <pasta>]… [--agent agents|claude] [--yes]
                                   Remove: de um link só sai o link; apagar uma cópia exige --yes.
                                   O que estiver em baocut/ e não for a skill do BaoCut nunca é substituído nem apagado`,
  installedAt: (path, linkTarget) => `Instalada em ${path}${linkTarget ? ` → ${linkTarget}` : ' (cópia)'}`,
  takesEffect: 'Vale em uma nova sessão do agente',
  removedAt: (path) => `Removida de ${path}`,
  removeCopies: (paths) =>
    `${paths.join(', ')} ${paths.length === 1 ? 'é uma cópia' : 'são cópias'}: remover apaga os arquivos, inclusive o que foi editado lá. Adicione --yes para apagar`,
  unknownAgent: (value) => `--agent aceita agents (.agents/skills) ou claude (.claude/skills): ${value}`,
  fixHint: 'Há instalações desatualizadas ou quebradas: baocut skill install (com o mesmo --dir) corrige',
  statusSkill: (version, source, bundled) => `Skill     ${version ?? '?'}  ${source}${bundled ? '' : ' (versão de desenvolvimento: gerada pelo Runtime)'}`,
  statusCli: (entry) => `CLI       ${entry ?? 'não incluída (versão de desenvolvimento)'}`,
  statusOnPath: (path, target, fromApp) => `Terminal  ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (deste app)' : ' (não é deste app)'}`,
  statusNotOnPath: (command) => `Terminal  baocut não está no PATH${command ? `; para usar em qualquer terminal: ${command}` : ''}`,
  appOutsideApplications: 'O BaoCut não está rodando da pasta Aplicativos: os links quebram se você mover ou apagar o app',
  globalHeading: 'Global',
  state: { none: 'Não instalada', current: 'Atualizada', stale: 'Desatualizada', broken: 'Link quebrado', foreign: 'Há outra coisa ali (não mexemos)' },
  mode: { link: 'Link', copy: 'Cópia' },

  cliHelp: `Uso:
  baocut cli install               Coloca o baocut no PATH, apontando para a linha de comando dentro do app BaoCut. macOS: um
                                   link em ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, com essa
                                   pasta adicionada ao PATH do seu usuário. Não precisa de permissão de administrador
  baocut cli status                Onde o baocut está, se aponta para este app e qual baocut o seu terminal encontra
  baocut cli remove                Remove o que o baocut cli install colocou. O que estiver nesse caminho e não tiver sido
                                   colocado pelo BaoCut nunca é substituído nem apagado`,
  cliStatusEntry: (path, target, state) => `Entrada   ${path}${target ? ` → ${target}` : ''} · ${state}`,
  cliStatusApp: (entry) => `App       ${entry ?? 'sem linha de comando incluída (versão de desenvolvimento): instale pelo app BaoCut'}`,
  cliStatusTerminal: (found) => `Terminal  ${found ?? 'baocut não encontrado'}`,
  cliStatusUnchecked: 'Terminal  não foi possível verificar o PATH do seu terminal: abra um novo terminal e rode baocut version',
  cliShadowed: (found, dir) => `Terminal  encontra primeiro ${found}. Para usar este, remova aquele ou coloque ${dir} antes no PATH`,
  cliPathHint: (dir, line, file) =>
    `${dir} ainda não está no PATH do seu terminal. Adicione esta linha ao arquivo ${file ?? 'de configuração do seu shell'} e abra um novo terminal:\n  ${line}`,
  cliInstalled: (path, target) => `Instalado: ${path} → ${target}`,
  cliWindowsPath: (dir) => `${dir} está no PATH do seu usuário: abra um novo terminal para usar o baocut`,
  cliRemoved: (path) => `Removido: ${path}`,
  cliNothingToRemove: (path) => `Nada para remover em ${path}`,
  cliInstallHint: 'baocut cli install coloca o baocut no PATH',
  cliFixHint: 'baocut cli install faz ele apontar para este app',
  cliState: {
    none: 'Não instalado',
    current: 'Aponta para este app',
    stale: 'Aponta para outro BaoCut',
    broken: 'Aponta para um local que não existe mais',
    foreign: 'Há outra coisa ali (não mexemos)',
    standalone: 'Aponta para o pacote independente de linha de comando, que o gerencia (baocut update; não mexemos)',
  },
};
