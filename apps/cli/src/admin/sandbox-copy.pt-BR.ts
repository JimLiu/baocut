import type { SandboxMessages } from './sandbox-copy.ts';

export const ptBR: SandboxMessages = {
  help: `Uso:
  baocut sandbox create <pasta> [--link-accounts-from <home>]
                                   Prepara uma pasta de Runtime separada para desenvolvimento e testes: a pasta com uma pasta
                                   projects dentro, um bin/baocut que roda a CLI desta cópia do repositório nessa pasta, e
                                   env.sh / env.ps1 que mudam um shell para ela. Rode de novo para atualizar esses arquivos.
                                   Só a partir de uma cópia do repositório; nunca a ~/.baocut padrão
    --link-accounts-from <home>    Também vincula, só para leitura, as contas de modelos dessa pasta (normalmente ~/.baocut),
                                   como baocut models accounts link --from. As chamadas usam suas contas reais e são cobradas`,
  defaultHome: (dir) => `${dir} é a pasta de Runtime padrão, com seus dados reais; escolha outra pasta para o sandbox`,
  needsSourceCli:
    'baocut sandbox create só roda a partir de uma cópia do repositório (node apps/cli/src/main.ts sandbox create …). Esta CLI inicia o Runtime do app BaoCut, que guarda as chaves nas chaves do sistema, compartilhadas por todas as pastas: um sandbox ali poderia sobrescrever ou apagar suas chaves reais',
  unknownStore: (entry) => `BAOCUT_RUNTIME_ENTRY aponta para ${entry}, e não se sabe onde esse Runtime guarda as chaves. Remova-a antes de criar um sandbox`,
  notEmpty: (dir) => `${dir} já tem arquivos e não é uma pasta do BaoCut; escolha uma pasta nova ou vazia`,
  notFolder: (dir) => `${dir} não é uma pasta`,
  created: (dir) => `Sandbox pronto: ${dir}`,
  refreshed: (dir) => `Sandbox atualizado: ${dir}`,
  projects: (dir) => `  Projetos  ${dir}`,
  cli: (file) => `  baocut    ${file} (roda a CLI desta cópia)`,
  useHeader: 'Para usá-lo em um shell:',
  useShell: (file) => `  ${file}`,
  usePowerShell: (file) => `  ${file}   (PowerShell)`,
  useNote:
    'Depois, o baocut nesse shell e os agentes iniciados a partir dele usam o sandbox; os outros shells continuam usando ~/.baocut. O Runtime dele guarda as chaves em um arquivo dentro do sandbox',
  linkFailed: (dir) => `O sandbox em ${dir} está pronto; não foi possível vincular as contas:`,
};
