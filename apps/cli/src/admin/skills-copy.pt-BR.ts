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
  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <folder>] [--link] [--yes]
                                   Instalar a skill do BaoCut para agentes externos (como usar o BaoCut) em baocut/
                                   na pasta de skills do host: Claude Code ~/.claude/skills, Codex ~/.codex/skills,
                                   Cursor ~/.cursor/skills, Gemini CLI ~/.gemini/skills
    --dir <folder>                 Usar outra pasta de skills (instala em baocut/ dentro dela); obrigatório sem --agent
    --link                         Colocar a skill renderizada em <BAOCUT_HOME>/agent-skills/baocut e um link no
                                   host: instalar novamente (para qualquer host) atualiza todas
    --yes                          Substituir o destino existente (para um link, só o link é substituído, não a pasta
                                   para a qual aponta); sem esta opção, nada é sobrescrito
  baocut skill path                Origem da skill do BaoCut, onde cada host a instala e o que está
                                   instalado agora (não precisa do Runtime)`, targetExists: (target, linkTarget) => `${target} já existe (${linkTarget !== null ? `um link para ${linkTarget}` : 'uma pasta ou arquivo'}); nada mudou. Adicione --yes para substituir`, installed: (target, files, linkTo) => `Skill do BaoCut instalada em ${target} (${files} ${pluralForm('pt-BR', files, { one: 'arquivo', other: 'arquivos' })}${linkTo ? `, vinculada a ${linkTo}` : ''})`, takesEffect: (host) => host ? `Aplicado em uma nova sessão de ${host}` : 'Aplicado em uma nova sessão', pathEscapes: (path) => `Um caminho na skill do BaoCut aponta para fora da pasta: ${path}`, sourceLine: (dir) => `Origem    ${dir ?? 'não encontrada (o BaoCut não está instalado e este não é o repositório; defina BAOCUT_AGENT_SKILLS_DIR)'}`, notInstalled: 'Não instalada', linkState: (target) => `Link → ${target}`, installedFolder: 'Instalada (pasta)', isFile: 'Um arquivo (não uma pasta de skill)',
};
