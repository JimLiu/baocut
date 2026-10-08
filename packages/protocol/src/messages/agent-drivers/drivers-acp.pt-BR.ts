import type { DriversAcpMessages } from './drivers-acp.ts';

export const ptBR: DriversAcpMessages = {
  copilotPlan: "Assinatura GitHub Copilot",
  copilotLoginHint: "execute copilot login em um terminal para entrar (ou /login no modo interativo do copilot)",
  copilotInstallHint: "Instalar GitHub Copilot CLI (npm install -g @github/copilot)",
  geminiPlan: "Conta Google",
  geminiLoginHint: "execute gemini em um terminal e escolha entrar com uma conta Google, ou adicione GEMINI_API_KEY=… em ~/.gemini/.env",
  geminiInstallHint: "Instalar Gemini CLI (brew install gemini-cli)",
  cursorPlan: "Assinatura Cursor",
  cursorInstallHint: "Instalar Cursor Agent com o script oficial",
  grokPlan: "Conta xAI",
  grokInstallHint: "Instalar Grok CLI com o script oficial",
  kimiPlan: "Conta Kimi",
  kimiInstallHint: "Instalar Kimi Code seguindo as instruções oficiais (https://github.com/MoonshotAI/kimi-code)",
  customNoCommand: (p: { id: string }) => `Agente ${p.id} não tem comando`,
  customInstallHint: (p: { command: string }) => `Verifique se ${p.command} está instalado e no PATH, ou adicione novamente com um caminho absoluto`,

  loginViaTerminal: (p: { command: string }) => `execute ${p.command} em um terminal para entrar`,
  loginPerInstructions: "siga as instruções para entrar",

  signedOut: (p: { name: string; login: string; detail: string }) =>
    `${p.name} não está conectado: ${p.login}.${p.detail ? ` (${p.detail})` : ""}`,
  probeTimeout: (p: { name: string; seconds: number }) => `${p.name} não respondeu em ${p.seconds} segundos`,
  acpModeFailed: (p: { name: string; error: string }) => `${p.name} não iniciou no modo ACP: ${p.error}`,
  exitCode: (p: { code: string }) => `código de saída ${p.code}`,

  exited: (p: { name: string; status: string; tail: string }) => `${p.name} encerrou (${p.status})${p.tail ? `: ${p.tail}` : ""}`,
  exitedBeforeInit: (p: { name: string }) => `${p.name} encerrou antes de inicializar`,
  initTimeout: (p: { name: string }) => `${p.name} não concluiu a inicialização ACP a tempo`,
  mcpHttpUnsupported: (p: { name: string }) =>
    `${p.name} não consegue conectar servidores MCP por HTTP; as ferramentas do BaoCut (ler e editar projetos, legendas etc.) não estão disponíveis nesta sessão.`,
  resumeUnsupported: (p: { name: string }) => `${p.name} não permite retomar sessões`,
  onlyAlwaysAllow: (p: { name: string }) =>
    `${p.name} ofereceu apenas “Permitir sempre” desta vez. O BaoCut não registra isso nas configurações por você, então a solicitação foi negada.`,
  modeSwitchFailed: (p: { name: string; mode: string; error: string }) => `${p.name} não conseguiu mudar o modo da sessão (${p.mode}): ${p.error}`,
  noAllowAllSwitch: (p: { name: string; configId: string }) =>
    `Esta sessão de ${p.name} não tem uma opção “permitir tudo” (${p.configId}), então continuará perguntando a cada ação em Acesso total.`,
  setOptionFailed: (p: { name: string; configId: string; value: string; error: string }) =>
    `${p.name} não conseguiu definir ${p.configId}=${p.value}: ${p.error}`,
  stillAskThisTurn: (p: { failure: string }) => `${p.failure}. Ainda perguntará a cada ação neste turno.`,
  noMatchingMode: (p: { name: string }) =>
    `${p.name} não tem um modo de sessão correspondente a este modo de acesso e usa seu próprio padrão. O BaoCut ainda verifica as ações que exigem aprovação conforme o modo de acesso.`,
  modelSwitchUnsupported: (p: { name: string }) => `${p.name} não pode trocar de modelo durante uma sessão; o modelo atual continua em uso.`,
};
