import { createElement, Fragment, type ReactNode } from 'react';
import type { AgentCardMessages } from './agent-card-copy.ts';

export const ptBR: AgentCardMessages = {
  runFailed: (message: string) => `Não foi possível executar: ${message}`,
  stopFailed: (message: string) => `Não foi possível parar: ${message}`,

  loginCommand: "comando de login",
  installCommand: "Comando de instalação",
  upgradeCommand: "comando de atualização",
  linkLabel: "link",
  terminalLogin: (command: string) => `Executando ${command} em terminal · volte após entrar`,
  terminalRun: (command: string) => `Executando ${command} em terminal · volte ao concluir`,
  terminalCopied: (label: string) => `Não foi possível abrir terminal. Copiado ${label}; cole no terminal para executar.`,
  terminalManual: (command: string) => `Não foi possível abrir terminal. Execute ${command} em terminal.`,
  terminalFailed: (message: string) => `Não foi possível abrir terminal: ${message}`,
  enableFailed: (message: string) => `Não foi possível ativar: ${message}`,
  disableFailed: (message: string) => `Não foi possível desativar: ${message}`,
  recheckFailed: (message: string) => `Não foi possível verificar novamente: ${message}`,
  saveModelFailed: (message: string) => `Não foi possível salvar modelo padrão: ${message}`,
  saveEffortFailed: (message: string) => `Não foi possível salvar esforço padrão: ${message}`,
  refreshFailed: (message: string) => `Não foi possível atualizar modelos: ${message}`,
  setDefaultFailed: (message: string) => `Não foi possível definir como padrão: ${message}`,
  openFailed: (message: string) => `Não foi possível abrir: ${message}`,
  enabled: (name: string) => `Ativado ${name}`,
  disabled: (name: string) => `Desativado ${name} · novas sessões não listam mais`,

  defaultBadge: "Padrão",
  subInstalled: (version: string | null, account: string | null) =>
    ["Instalado neste computador", version ? `v${version}` : null, account].filter(Boolean).join(" · "),
  subMissing: (command: string, plan: string) => `${command} não encontrado neste computador · sua ${plan} existente é suficiente`,
  enable: (name: string) => `Ativar ${name}`,
  details: "Detalhes",
  install: "Instalar",
  checking: "Verificando…",
  gateTitle: (name: string, model: string) => `${name}: modelo padrão configurado ${model} exige versão mais recente`,
  gateBody: (version: string, model: string) =>
    `Este computador tem ${version}, cuja lista não inclui ${model}. Sessões em “Modelo padrão do agente” usam a configuração e são rejeitadas; sessões com modelo específico não mudam.`,
  gateUpgrade: "Atualiza só a ferramenta de linha de comando; conta e configurações próprias não mudam.",
  gateNoUpgrade: "Sem versão nova ainda. Escolha por enquanto um modelo da lista na sessão.",
  upgradeTo: (version: string) => `Atualizar para ${version}`,
  updateStrip: (latest: string, current: string) => `Versão ${latest} disponível (atual: ${current}). Pode usar sem atualizar.`,
  viewUpgrade: "Ver como atualizar",
  cancel: "Cancelar",

  defaultModel: "Modelo padrão",
  defaultModelDesc:
    "Novas sessões começam com ele; ainda podem trocar sob o campo. “Recomendado” basta para transcrever, traduzir e editar; não precisa do mais potente.",
  defaultModelOf: (name: string) => `${name}: modelo padrão`,
  defaultEffortOf: (name: string) => `${name}: esforço de raciocínio padrão`,
  modelsOf: (name: string, count: number) => `${name} modelos · ${count}`,
  modelsList: (list: string) => `${list}. Atualizado a cada verificação.`,
  modelsNone: "Não informou modelos; sessões usam o padrão do agente. Nova consulta na próxima verificação.",
  refreshing: "Atualizando…",
  refreshModels: "Atualizar modelos",
  refreshed: (name: string) => `Atualizada ${name}: lista de modelos`,
  nowDefault: (name: string) => `Novas sessões usam ${name}`,
  version: (version: string | null) => (version ? `Versão · v${version}` : "Versão"),
  versionDesc: (latest: string | null, min: string | null, source: string) =>
    `${latest ? `Você pode atualizar para ${latest}. ` : ""}${min ? `BaoCut exige ao menos ${min}. ` : ""}Atualiza só a ferramenta; conta e configurações próprias não mudam. ${source}`,
  account: "Conta",
  accountDesc: (signedOut: boolean, account: string | null, plan: string) =>
    `${signedOut ? "Não conectado ou login expirado" : (account ?? "Conectado")}. Usa sua própria ${plan}; sem cobrança extra do BaoCut. Login feito no terminal.`,
  loginInTerminal: "Abrir terminal para entrar",
  switchAccount: "Trocar conta…",
  location: "Local de instalação",
  locationDesc: "BaoCut chama este programa diretamente e nunca instala outra cópia.",
  realLocation: "Local real",
  setLocation: "Definir local manualmente",
  troubleshoot: "Diagnosticar",
  troubleshootDesc: "Verifica instalação, versão, login e modelos em sequência; indica onde parou.",
  setDefault: "Definir padrão",
  runChecks: "Executar verificações",


  sourceKnown: (label: string) =>
    `Instalado com “${label}”; atualize do mesmo modo. Outros métodos só instalam outra cópia.`,
  sourceUnknown: "Atualize pelo mesmo método de instalação.",
  scriptInstall:
    "Este comando baixa e executa script oficial. BaoCut não executa scripts da internet; copie e execute num terminal.",
  scriptUpgrade: "Este comando baixa e executa script oficial. Copie e execute num terminal.",
  copyUpgrade: "Copie o comando e execute no terminal; volte e verifique novamente.",
  runnableHint: "Clique ▶ à esquerda para executar aqui, saída abaixo. Ou copie e execute no terminal.",
  copyHint: "Copie o comando abaixo e execute no terminal.",
  installMethod: "Método de instalação",
  upgradeMethod: "Método de atualização",
  needs: (needs: string) => `Exige ${needs} neste computador.`,

  installIntro: (name: string, plan: string) =>
    `${name} é assistente de IA na linha de comando local, conectado com ${plan} que você já tem. BaoCut só chama: sem custo extra ou chave API no BaoCut.`,
  stepInstall: "Instalar neste computador",
  stepInstallOfficial: "Instalar neste computador seguindo as instruções oficiais",

  installOfficialBody: (command: ReactNode): ReactNode =>
    createElement(Fragment, null, "Instale pelas instruções oficiais. Depois, ", command, " deve executar no terminal."),
  stepLogin: "Entrar na sua conta",
  stepLoginBody:
    "Após instalar, execute abaixo no terminal e entre no navegador quando pedido. Janela própria, BaoCut não trata conta ou senha.",
  stepBack: "Voltar aqui",
  stepBackBody: "Pronto após detectar instalação e login.",
  detecting: "Verificando…",
  recheck: "Já instalei, verificar novamente",
  notDetected: "Instalado, mas não detectado?",
  notDetectedBody:
    "Busca PATH e locais comuns (Homebrew, npm global, ~/.local/bin). Gerenciadores nvm/asdf/mise podem instalar em outros; indique o local manualmente.",
  diagnosisOf: (name: string) => `Resultados de verificação de ${name}`,
};
