import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './providers-agent.zh-Hans.ts';
import { zhHant } from './providers-agent.zh-Hant.ts';
import { ja } from './providers-agent.ja.ts';
import { ko } from './providers-agent.ko.ts';
import { es } from './providers-agent.es.ts';
import { fr } from './providers-agent.fr.ts';
import { de } from './providers-agent.de.ts';
import { nl } from './providers-agent.nl.ts';
import { ptBR } from './providers-agent.pt-BR.ts';
import { it } from './providers-agent.it.ts';
import { ru } from './providers-agent.ru.ts';
import { pl } from './providers-agent.pl.ts';
import { tr } from './providers-agent.tr.ts';
import { vi } from './providers-agent.vi.ts';

/** 用本机 Agent 生成图片的 Provider（`agent:codex`）的说明与错误（`packages/providers`）。`label` 是 Agent 的名字。 */
const en = {
  codexUpgradeHint: 'Update the Codex CLI (for example, npm install -g @openai/codex@latest), then check again',
  codexImageModel: 'Codex image generation (model chosen by Codex and your account)',
  codexImageNotes:
    "Generates with the Codex account signed in on this computer: one PNG each time, one task at a time, usually in a minute or two. Size and seed can't be set (requests that include them are rejected), and the pixel size depends on the result. It uses your subscription quota; the remaining quota is unknown. Turning it on means agreeing to send prompts to your Codex account.",
  imagesOnly: (p: { label: string }) => `${p.label} can only generate images`,
  onePngOnly: (p: { label: string }) => `${p.label} generates one PNG at a time and doesn't accept size or seed`,
  unavailable: (p: { label: string; message: string }) => `${p.label} isn't available: ${p.message}`,
  sessionNotStarted: (p: { label: string; error: string }) => `${p.label}'s session didn't start: ${p.error}`,
  timedOut: (p: { label: string; minutes: number }) => `${p.label} didn't finish within ${p.minutes} minutes and was interrupted`,
  exited: (p: { label: string; message: string }) => `${p.label} exited unexpectedly: ${p.message}`,
  notCompleted: (p: { label: string; reason: string }) => `${p.label} didn't finish this generation: ${p.reason}`,
  turnInterrupted: 'the turn was interrupted',
  noImage: (p: { label: string }) => `${p.label} didn't generate an image`,
  noImageReply: (p: { label: string; reply: string }) => `${p.label} didn't generate an image: ${p.reply}`,
  unknownError: 'Unknown error',
  processExited: 'The process exited',
  turnNotStarted: (p: { error: string }) => `The turn didn't start: ${p.error}`,
};

export type ProvidersAgentMessages = typeof en;

export const ProvidersAgent = defineCatalog('providersAgent', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
