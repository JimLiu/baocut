import type { DoctorMessages } from './doctor-copy.ts';

export const ptBR: DoctorMessages = {
  help: [
    'baocut doctor',
    '',
    'Por que o BaoCut não inicia ou não consegue ler algo: qual baocut os terminais encontram, qual Runtime a CLI',
    'iniciaria e com qual diretório, se o armazenamento de credenciais responde e o Acesso Total ao Disco no',
    'macOS. Cada verificação é ok, warn, fail ou skip, com um comando de correção quando houver; next é a',
    'correção do primeiro problema. Somente leitura: nunca inicia um Runtime e nunca lê uma chave (a verificação',
    'das Chaves só pergunta se uma chave inventada existe). Pergunte ao usuário antes de executar as correções.',
    'A partir de uma cópia do repositório, também executa a autoverificação do Runtime, que inicia cada programa nativo uma vez e compara os builds com o código-fonte.',
    '',
    'Opções: --json',
  ].join('\n'),
  checkName: {
    entry: 'Linha de comando',
    runtime: 'Runtime',
    credentials: 'Credenciais',
    fullDiskAccess: 'Acesso Total ao Disco',
    build: 'Build',
  },
  remedyLabel: 'correção',

  entryApp: (found, version) => `Os terminais executam ${found}, a linha de comando do app BaoCut${version ? ` ${version}` : ''}`,
  entryOtherApp: (found, target, app) =>
    `Os terminais executam ${found} (${target}), não a linha de comando do app BaoCut em ${app}`,
  entryNoApp: (found, target) => `Os terminais executam ${found} (${target}); nenhum app BaoCut foi encontrado`,
  entryMissing: 'Os terminais não encontram o baocut. Instale-o pelo app BaoCut (não precisa de permissão de administrador).',
  entryMissingNoApp: 'Os terminais não encontram o baocut, e nenhum app BaoCut foi encontrado nos locais habituais',

  runtimeRunning: (version, pid, by) =>
    `Em execução: versão ${version}, processo ${pid}, iniciado ${by === 'cli' ? 'pela linha de comando' : 'pelo app BaoCut'}`,
  runtimeStopped: (entry) => `Não está em execução. O próximo comando o inicia em segundo plano com ${entry}`,
  runtimeUnreachable: (pid, reason) => `Há um Runtime em execução (processo ${pid}), mas ele não responde: ${reason}`,
  runtimeNoLaunch:
    'Não está em execução e não há Runtime para iniciar: instale o app BaoCut, execute do repositório ou defina BAOCUT_RUNTIME_ENTRY para a entrada do Runtime.',

  credentialsFile: (file) => `Esta versão guarda as chaves em um arquivo: ${file}`,
  credentialsKeychain: (platform) =>
    platform === 'win32' ? 'O Gerenciador de Credenciais do Windows responde' : 'As Chaves do macOS respondem',
  credentialsDenied:
    'As Chaves recusaram o acesso. Via SSH ou sem uma sessão iniciada na área de trabalho, o macOS pode mantê-las bloqueadas: execute o baocut em um terminal na área de trabalho ou desbloqueie as chaves “início de sessão”.',
  credentialsNoHelper: (file) =>
    `O auxiliar de credenciais está faltando${file ? ` (${file})` : ''}, então as chaves não podem ser lidas. Reinstale o app BaoCut.`,
  credentialsUnavailable: (reason) => `Não foi possível acessar o armazenamento de credenciais: ${reason}`,
  credentialsUnknown: 'BAOCUT_RUNTIME_ENTRY decide onde as chaves ficam; não verificado',
  credentialsTimedOut: (seconds) => `o auxiliar não respondeu em ${seconds} s`,

  fdaGranted: 'O Acesso Total ao Disco está ativado',
  fdaMissingApp:
    'O Acesso Total ao Disco está desativado para o BaoCut.app, então arquivos em locais protegidos (Mesa, Documentos, Transferências, outros discos) podem ficar ilegíveis. Ative o BaoCut em Ajustes do Sistema › Privacidade e Segurança › Acesso Total ao Disco e execute baocut doctor novamente.',
  fdaMissingCli: (app) =>
    `O Acesso Total ao Disco está desativado para o Runtime que a linha de comando iniciou; o macOS usa a permissão deste app: ${app ?? 'o app que executou o comando (seu terminal ou o app que hospeda o agente)'}. Ative esse app em Ajustes do Sistema › Privacidade e Segurança › Acesso Total ao Disco e reabra-o, ou pare este Runtime (baocut runtime stop) e abra o app BaoCut; depois execute baocut doctor novamente.`,
  fdaNotRunning: 'Verificado apenas com um Runtime em execução',
  buildOk: (count) => `Os programas nativos iniciam e os ${count} builds correspondem ao código-fonte`,
  buildNotSource: 'Verificado quando o Runtime roda a partir de uma cópia do repositório',
  buildFailed: (reason) => `A autoverificação do Runtime não terminou: ${reason}`,
  buildTimedOut: (seconds) => `sem resposta em ${seconds} s`,
  buildProblems: (count, first) =>
    count === 1 ? `A autoverificação do Runtime encontrou um problema: ${first}` : `A autoverificação do Runtime encontrou ${count} problemas; o primeiro: ${first}`,
  buildMore: (first, more) => `${first} (e mais ${more})`,
};
