import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './drivers-claude.zh-Hans.ts';
import { zhHant } from './drivers-claude.zh-Hant.ts';
import { ja } from './drivers-claude.ja.ts';
import { ko } from './drivers-claude.ko.ts';
import { es } from './drivers-claude.es.ts';
import { fr } from './drivers-claude.fr.ts';
import { de } from './drivers-claude.de.ts';
import { nl } from './drivers-claude.nl.ts';
import { ptBR } from './drivers-claude.pt-BR.ts';
import { it } from './drivers-claude.it.ts';
import { ru } from './drivers-claude.ru.ts';
import { pl } from './drivers-claude.pl.ts';
import { tr } from './drivers-claude.tr.ts';
import { vi } from './drivers-claude.vi.ts';

/** Claude Code Driver：账号描述、探测结果与会话里的提示。 */
const en = {
  plan: 'Claude Pro or Max subscription',
  installHint: 'Install Claude Code',
  signedOut: "Claude Code isn't signed in. Run claude in a terminal and follow the prompts to sign in.",
  subscriptionPro: 'Claude Pro subscription',
  subscriptionMax: 'Claude Max subscription',
  subscriptionTeam: 'Claude Team subscription',
  subscriptionEnterprise: 'Claude Enterprise subscription',
  providerAnthropicAws: 'Anthropic (AWS)',
  providerAnthropicGoogleCloud: 'Anthropic (Google Cloud)',
  enterpriseGateway: 'Enterprise gateway',
  claudeAccount: 'Claude account',
  longLivedToken: 'Claude subscription (long-lived token)',
  apiKey: 'Anthropic API key',
  thirdPartyCloud: 'Third-party cloud',
  /** 模型表里来自用户设置 `env` 的模型的说明。 */
  fromSettings: (p: { key: string }) => `From Claude Code settings (env.${p.key})`,
  imageUnsupported: (p: { mimeType: string }) =>
    `Claude doesn't support this image format: ${p.mimeType} (supported: JPEG, PNG, GIF, WebP)`,
  defaultModel: 'default model',
  switchModelFailed: (p: { model: string; error: string }) => `Claude couldn't switch models (${p.model}): ${p.error}`,
  /** `model` 为空时说「当前模型」；`reason` 为空时不带括号里的原因。 */
  autoUnsupported: (p: { model: string; reason: string }) =>
    `${p.model ? `Model ${p.model}` : 'The current model'} doesn't support Claude's "auto" permission mode${p.reason ? ` (${p.reason})` : ''}. This turn runs as "ask each time" and will ask before acting.`,
  apiRetry: (p: { error: string; attempt: number; max: number }) => `Claude API error (${p.error}); retry ${p.attempt}/${p.max}`,
  turnFailed: (p: { subtype: string }) => `Claude Code turn failed (${p.subtype})`,
  /** 批准 ExitPlanMode 之后的提示；参数是访问模式的名字。 */
  exitedPlanMode: (p: { plan: string; edit: string }) =>
    `Claude Code left plan mode with the approved plan and will start making changes. While the access mode is still "${p.plan}", those changes will be declined. To let it proceed, change the access mode to "${p.edit}" or another level.`,
};

export type DriversClaudeMessages = typeof en;

export const DriversClaude = defineCatalog('driversClaude', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
