import type { DriversClaudeMessages } from './drivers-claude.ts';

export const ptBR: DriversClaudeMessages = {
  plan: 'Assinatura Claude Pro ou Max', installHint: 'Instalar Claude Code',
  signedOut: 'Claude Code não está conectado. Execute claude em um terminal e siga as instruções para entrar.',
  subscriptionPro: 'Assinatura Claude Pro', subscriptionMax: 'Assinatura Claude Max', subscriptionTeam: 'Assinatura Claude Team', subscriptionEnterprise: 'Assinatura Claude Enterprise',
  providerAnthropicAws: 'Anthropic (AWS)', providerAnthropicGoogleCloud: 'Anthropic (Google Cloud)', enterpriseGateway: 'Gateway empresarial', claudeAccount: 'Conta Claude',
  longLivedToken: 'Assinatura Claude (token de longa duração)', apiKey: 'Chave de API Anthropic', thirdPartyCloud: 'Nuvem de terceiros',
  fromSettings: (p) => `Das configurações do Claude Code (env.${p.key})`,
  imageUnsupported: (p) => `Claude não oferece suporte a este formato de imagem: ${p.mimeType} (suportados: JPEG, PNG, GIF, WebP)`,
  defaultModel: 'modelo padrão',
  switchModelFailed: (p) => `Claude não pôde trocar de modelo (${p.model}): ${p.error}`,
  autoUnsupported: (p) => `${p.model ? `O modelo ${p.model}` : 'O modelo atual'} não oferece suporte ao modo de permissões “auto” do Claude${p.reason ? ` (${p.reason})` : ''}. Este turno executa como “perguntar sempre” e perguntará antes de agir.`,
  apiRetry: (p) => `Erro na API Claude (${p.error}); tentativa ${p.attempt}/${p.max}`,
  turnFailed: (p) => `O turno do Claude Code falhou (${p.subtype})`,
  exitedPlanMode: (p) => `Claude Code saiu do modo de planejamento com o plano aprovado e começará a fazer alterações. Enquanto o modo de acesso ainda for “${p.plan}”, essas alterações serão recusadas. Para permitir a execução, altere o modo de acesso para “${p.edit}” ou outro nível.`,
};
