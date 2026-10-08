import type { RcExternalToolsMessages } from './rc-external-tools.ts';

export const ptBR: RcExternalToolsMessages = {
  manageOnlyInAppOrCli: "Ferramentas externas só podem ser gerenciadas no aplicativo desktop ou na CLI",
  videoNotOpen: "O vídeo não está aberto",

  toolUpdating: (p: { label: string }) => `${p.label} está sendo atualizado`,
  waitForUpdate: (p: { jobId: string }) => `Tente novamente após a tarefa de atualização ${p.jobId} terminar`,
  toolNotInstalled: (p: { label: string }) => `${p.label} não está instalado`,
  toolCannotRun: (p: { label: string; reason: string }) => `${p.label} não pode ser executado: ${p.reason}`,
  toolOutdated: (p: { label: string; reason: string }) => `${p.label} está desatualizado: ${p.reason}`,
  consentRevoked: (p: { label: string }) => `O consentimento para usar ${p.label} foi retirado`,
  consentRequired: (p: { label: string }) => `Usar ${p.label} exige primeiro o consentimento do usuário`,
  consentRemedy: (p: { name: string }) =>
    `Tente após o consentimento: externalTools.consent (baocut external-tools consent ${p.name}), ou durante a instalação (externalTools.install com consent: true)`,

  notExecutable: (p: { path: string }) => `${p.path} não é um arquivo executável`,
  notWindowsProgram: (p: { path: string }) =>
    `${p.path} não é um programa Windows (.exe): o BaoCut não executa ferramentas por interpretador de comandos`,
  cannotRunAs: (p: { path: string; label: string; reason: string }) => `${p.path} não pode executar como ${p.label}: ${p.reason}`,
  noVersion: "Não foi possível ler a versão",
  toolInUse: (p: { label: string }) => `${p.label} está sendo instalado ou usado por uma tarefa`,
  notDownloadedByBaocut: (p: { label: string; remedy: string }) => `O BaoCut não baixa ${p.label}: ${p.remedy}`,
  downloadNeedsConsent: (p: { label: string }) =>
    `Baixando ${p.label} exige consentimento: confirme primeiro origem, versão, tamanho e licença`,
  offlineStrictNoDownload: "Ferramentas externas não são baixadas no modo off-line estrito",
  cannotDownload: (p: { label: string; reason: string }) => `Não foi possível baixar ${p.label}: ${p.reason}`,
  manifestIncompleteRemedy: (p: { label: string }) =>
    `Espere o BaoCut atualizar o manifesto, ou instale ${p.label} manualmente e defina o caminho com externalTools.setPath`,
  updateManagedCopy: (p: { label: string }) => `A versão de ${p.label} usada foi baixada pelo BaoCut; não é atualizada pelo instalador`,
  updateUnknownInstall: (p: { path: string }) => `Não foi possível identificar como ${p.path} foi instalado`,
  updateNoRunnable: (p: { label: string }) => `Nenhuma cópia funcional de ${p.label} foi encontrada`,
  updateManagedRemedy: "Use externalTools.install para mudar à versão do manifesto",
  updateManualRemedy: "Atualize em um terminal pelo método de instalação, depois detecte novamente (externalTools.detect)",
  cannotUpdateFor: (p: { label: string }) => `O BaoCut não pode atualizar ${p.label} por você`,
  runInTerminalRemedy: (p: { command: string }) => `Execute ${p.command} em um terminal, depois detecte novamente (externalTools.detect)`,
  confirmUpdateCommand: (p: { label: string; command: string }) => `Atualizar ${p.label} exige confirmação desta comando: ${p.command}`,
  updateCommandChanged: (p: { label: string; command: string }) => `O comando para atualizar ${p.label} mudou. Confirme novamente: ${p.command}`,
  offlineStrictNoUpdate: "Ferramentas externas não são atualizadas no modo off-line estrito",
  unknownTool: (p: { name: string }) => `Não existe a ferramenta externa “${p.name}”`,
  notManaged: (p: { label: string; remedy: string }) => `O BaoCut não gerencia ${p.label}: ${p.remedy}`,
  endpointInvalid: "A fonte de download das ferramentas não é um endereço válido",
  endpointBadForm:
    "A fonte de ferramentas deve ser URL base http(s)://, sem credenciais, consulta ou fragmento",

  sourceEnvVar: (p: { name: string }) => `a variável de ambiente ${p.name}`,
  sourceUserPath: "o caminho definido",
  sourceManaged: "a cópia baixada pelo BaoCut",
  commandNotFound: (p: { command: string }) => `${p.command} não encontrado`,
  commandNotFoundIn: (p: { where: string; command: string }) => `${p.command} não encontrado em ${p.where}`,
  sourceNotExecutable: (p: { where: string }) => `${p.where} não é um arquivo executável`,
  sourceIsScript: (p: { where: string; batch: boolean }) =>
    `${p.where} aponta para um ${p.batch ? "script em lote" : "script"}, não para um programa Windows (.exe); o BaoCut não usa interpretador de comandos`,
  setExePathRemedy: (p: { command: string; canInstall: boolean }) =>
    `Defina o caminho para ${p.command}.exe com externalTools.setPath${p.canInstall ? ", ou baixe com externalTools.install" : ""}`,
  belowMinVersion: (p: { version: string; min: string }) => `${p.version} é inferior à versão mínima ${p.min}`,
  installOrUpdateRemedy: (p: { version: string; label: string }) =>
    `Baixar ${p.version} com externalTools.install, ou atualize ${p.label} no sistema`,
  updateTool: (p: { label: string }) => `Atualize ${p.label}`,

  diskFull: "O disco ficou cheio ao gravar o arquivo da ferramenta",
  downloadedCannotRun: (p: { label: string; reason: string }) => `O arquivo baixado de ${p.label} não pode ser executado: ${p.reason}`,
  updateStopped: "Atualização parada",
  updateExited: (p: { code: string }) => `O comando de atualização encerrou com ${p.code}`,
  updateTimedOut: (p: { minutes: number }) => `O comando não terminou em ${p.minutes} minutos e foi parado`,
  updateSignalled: (p: { signal: string }) => `O comando foi encerrado pelo sinal ${p.signal}`,
  updateCannotStart: (p: { reason: string }) => `O comando de atualização não pôde iniciar (${p.reason})`,
  updateFailedRemedy: (p: { command: string }) => `Veja a saída na tarefa ou execute ${p.command} em um terminal, depois detecte novamente`,

  remedyNoSpace: "O disco de Runtime Home está cheio. Libere espaço e instale novamente",
  remedyNetwork:
    "Rede inacessível ou download interrompido. Verifique a rede e reinstale (retoma o recebido), ou troque o espelho em “Fonte de download de ferramentas” nas Configurações › Geral",
  remedyIntegrity:
    "Um arquivo baixado não corresponde ao tamanho ou sha256 do manifesto (a fonte ou o espelho tem conteúdo incorreto). O arquivo inválido foi excluído; mude a fonte de download e instale novamente",
  remedySource:
    "A origem não tem o arquivo ou negou acesso. Verifique o espelho em “Fonte de download de ferramentas” nas Configurações › Geral (ou BAOCUT_TOOLS_ENDPOINT)",
  downloadFailed: (p: { file: string; reason: string }) => `Baixando ${p.file} falhou: ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `${p.file} não corresponde ao tamanho ou sha256 do manifesto`,
  sourceHttpStatus: (p: { file: string; status: number }) => `A origem retornou HTTP ${p.status} para ${p.file}`,
  largerThanManifest: (p: { file: string }) => `${p.file} é maior que o manifesto informa`,

  ytDlpLicense: "Unlicense (origem); o executável inclui componentes GPLv3+ e é GPLv3+ como um todo",
  ytDlpPurpose: "Importar de link: lê a página e baixa mídias e legendas",
  ytDlpMissingRemedy:
    "Baixe com externalTools.install (baocut external-tools install yt-dlp), ou instale e defina o caminho com externalTools.setPath",
  ffmpegPurpose: "Análise de mídias, transcodificação, exportação e mesclagem de áudio e vídeo após download",
  noReleaseForPlatform: (p: { platform: string }) => `Nenhum arquivo de versão para este computador (${p.platform})`,
  noTrustedSha: "O manifesto ainda não tem sha256 confiável deste arquivo; download indisponível",

  probeCannotStart: (p: { error: string }) => `Não foi possível iniciar: ${p.error}`,
  probeTimeout: (p: { command: string; seconds: number }) => `${p.command} não terminou em ${p.seconds} segundos`,
  probeCannotStartCode: (p: { code: string }) => `Não foi possível iniciar (${p.code})`,
  probeExited: (p: { code: string; detail: string }) => `Encerrou com ${p.code}${p.detail ? `: ${p.detail}` : ""}`,

  pipxMissing: (p: { label: string }) => `Esta sessão de ${p.label} foi instalado com pipx, mas pipx não está no PATH.`,
  brewMissing: (p: { label: string; brew: string }) => `Esta sessão de ${p.label} foi instalado com Homebrew, mas não foi possível encontrar ${p.brew} desse Homebrew.`,
  wingetMachineWide: (p: { label: string; dir: string }) =>
    `Esta sessão de ${p.label} foi instalado pelo winget para todos os usuários (${p.dir}) e precisa de administrador para atualizar; o BaoCut não eleva privilégios. Abra um terminal como administrador e execute este comando.`,
  wingetMissing: (p: { label: string }) => `Esta sessão de ${p.label} foi instalado com winget, mas winget não está no PATH.`,
  scoopGlobal: (p: { label: string; dir: string }) =>
    `Esta sessão de ${p.label} é uma instalação global do Scoop (${p.dir}) e precisa de administrador para atualizar; o BaoCut não eleva privilégios. Abra um terminal como administrador e execute este comando.`,
  scoopMissing: (p: { label: string; script: string }) => `Esta sessão de ${p.label} foi instalado com Scoop, mas o Scoop não foi encontrado (${p.script}).`,
  chocolateyAdmin:
    "Programas do Chocolatey precisam de administrador para atualizar; o BaoCut não eleva privilégios. Abra um terminal como administrador e execute este comando.",
  pythonScriptMissing: "O interpretador Python apontado por este script não existe mais.",
  pipAdmin: (p: { label: string; dir: string }) =>
    `Esta sessão de ${p.label} está instalado em ${p.dir}, que exige administrador para alterar; o BaoCut não eleva privilégios. Atualize pelo método de instalação.`,
  pythonLauncherMissing: "O interpretador Python apontado por este programa não existe mais.",
  pipAdminWin: (p: { label: string; dir: string }) =>
    `Esta sessão de ${p.label} está instalado em ${p.dir}, que exige administrador para alterar; o BaoCut não eleva privilégios. Abra um terminal como administrador e execute este comando.`,
  standaloneAdmin: (p: { label: string; dir: string }) =>
    `${p.dir}, onde está ${p.label}, exige administrador para alterar; o BaoCut não eleva privilégios.`,
  standaloneAdminWin: (p: { label: string; dir: string }) =>
    `${p.dir}, onde está ${p.label}, exige administrador para alterar; o BaoCut não eleva privilégios. Abra um terminal como administrador e execute este comando.`,
};
