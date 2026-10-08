import type { AgentSkillsMessages } from './agent-skills.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: AgentSkillsMessages = {
  origin: { builtin: 'Integrada', personal: 'Minha', 'third-party': 'De terceiros' }, all: 'Todas', commit: (sha: string) => ` (${sha})`,
  bytes: (n: number) => pluralForm('pt-BR', n, { one: `${n} byte`, other: `${n} bytes` }),
  action: { load: 'carregar skills', toggle: 'alterar a opção', add: 'adicionar', import: 'importar', remove: 'remover', read: 'abrir o arquivo', send: 'enviar' },
  exists: (id: string | null) => `Já existe uma skill chamada “${id ?? 'esta'}” e ela não será sobrescrita. Remova a anterior primeiro ou renomeie a pasta e adicione novamente.`,
  invalid: (issue: string) => `Esta skill não é utilizável: ${issue}. A pasta raiz precisa de um SKILL.md que comece com name e description.`,
  tooLarge: (files: number, total: string, skillFile: string) => `Esta skill é grande demais: uma skill pode ter no máximo ${pluralForm('pt-BR', files, { one: `${files} arquivo`, other: `${files} arquivos` })}, totalizando ${total}, e o próprio SKILL.md pode ter no máximo ${skillFile}.`,
  githubNotFound: 'Não foi possível encontrar este repositório, branch ou pasta no GitHub (pode ser privado). Verifique o endereço.',
  folderNotFound: 'Não foi possível encontrar esta pasta. Pode ter sido movida ou excluída.',
  urlInvalid: 'O endereço não foi reconhecido. Use owner/repo ou https://github.com/owner/repo/tree/branch/folder.',
  network: 'Não é possível acessar o GitHub. Verifique a rede e tente novamente.',
  rateLimited: 'O limite de acesso anônimo do GitHub foi atingido por enquanto. Tente importar novamente mais tarde.',
  offline: 'O modo estritamente off-line está ativado, então não é possível importar do GitHub.',
  builtinNotRemovable: 'Skills integradas não podem ser removidas, mas podem ser desativadas.',
  notFound: 'Esta skill não existe mais; pode ter sido removida agora.', fileNotFound: 'Este arquivo não existe mais.',
  fileTooLarge: 'Este arquivo é grande demais para mostrar aqui. Você pode abrir na pasta.', fileNotText: 'Este não é um arquivo de texto, então não aparece aqui.',
  webNotAllowed: 'Não é possível fazer isso no navegador. Use o aplicativo de desktop BaoCut.', webReadOnly: 'Esta sessão do navegador é somente leitura, então nada pode ser alterado.',
  failed: (action: string, raw: string) => `Não foi possível ${action}: ${raw}`, sendFailed: (raw: string) => `Não foi possível enviar: ${raw}`,
};
