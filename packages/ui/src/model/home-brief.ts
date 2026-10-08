import { defineMessages, templateUnfilledText, type DriverId, type DriverInfo } from '@baocut/protocol';
import type { HomeTemplate } from './home-templates.ts';
import { kindOfFileName } from './space.ts';
import { zhHans } from './home-brief.zh-Hans.ts';
import { zhHant } from './home-brief.zh-Hant.ts';
import { ja } from './home-brief.ja.ts';
import { ko } from './home-brief.ko.ts';
import { es } from './home-brief.es.ts';
import { fr } from './home-brief.fr.ts';
import { de } from './home-brief.de.ts';
import { nl } from './home-brief.nl.ts';
import { ptBR } from './home-brief.pt-BR.ts';
import { it } from './home-brief.it.ts';
import { ru } from './home-brief.ru.ts';
import { pl } from './home-brief.pl.ts';
import { tr } from './home-brief.tr.ts';
import { vi } from './home-brief.vi.ts';

/** 起始页简报的文案（英文是键与类型的来源，译文在 `home-brief.zh-Hans.ts`）。 */
const en = {
  about: (minutes: number, seconds: number) =>
    `About ${[minutes ? `${minutes} min` : '', seconds ? `${seconds} sec` : ''].filter(Boolean).join(' ')}`,
  fromMaterials: 'Make a video from the materials I attached.',
  materials: (paths: readonly string[]) => `Materials: ${paths.join(', ')}`,
  connectFirst: 'Connect AI first',
  sayFirst: 'Say what you want to make, or attach materials',
  agentOffTitle: 'All installed coding agents are turned off',
  agentOffBody: 'A coding agent is installed on this computer but turned off in Settings. Turn one on to start right here.',
  enableNamed: (name: string) => `Turn on ${name}`,
  enableAgent: 'Turn on Agent',
  agentMissingTitle: 'This needs a coding agent',
  agentMissingBody: 'Install Claude Code or Codex CLI and sign in with your own subscription, then come back here to start.',
  connectAgent: 'Connect Agent',
  nameEmpty: 'Enter a project name',
  nameInvalid: 'The project name can’t contain slashes or control characters',
};
export type HomeBriefMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * Home 起始页交给 Agent 的那段话（产品设计 §3.2.1；原型 designs/baocut/app/model-newproject.js
 * `homePrompt`、`canStart`、`aiGate`、`gateGuide`）。画幅与时长不在起始页设：Agent 从用户的话里看出来，没说的按内容决定。
 * 场景模板（model/home-templates.ts）发送时以 `conversations.send` 的 `template` 交给 Runtime，
 * 模板的默认画幅与时长、提示词正文与简报引导都由 Runtime 拼（模板包规范 §5.2），不写进这段话，也不代替用户要讲的内容。
 */

/** 模板卡片上的时长：「约 1 分钟」「约 1 分钟 30 秒」「约 45 秒」；没写（或不是正数）时为 null。 */
export function lengthLabel(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return M.about(minutes, rest);
}

export interface HomeBriefOptions {
  /** 随消息附上的图片张数。 */
  images: number;
  /** 交给 Agent 的本机素材路径（视频、音频、文档）。 */
  materials: readonly string[];
}

/**
 * 发给 Agent 的正文：用户自己的话（没写、只附了材料时补一句，挂没挂模板都一样：规范 §5.2 的 `text` 照常必填）、材料行。
 * 挂着的场景模板不写进来：它随 `conversations.send` 的 `template` 走，会话里的消息另带模板标记。
 * 材料按本机绝对路径写进正文：Agent 用 BaoCut 的导入工具按路径把文件收进项目（项目外的路径要先经你同意）。
 * 没填的待填项 `{{label}}` 写成「[label]」（规范 §5.5）：不拦发送，Agent 把它当作简报缺项先问。
 */
export function homeBrief(text: string, options: HomeBriefOptions): string {
  const own = templateUnfilledText(text).trim();
  const attached = options.images + options.materials.length;
  const parts = [
    own || (attached ? M.fromMaterials : ''),
    options.materials.length ? M.materials(options.materials) : '',
  ];
  return parts.filter(Boolean).join('\n');
}

/** 起始页能不能开始：Agent 可用，并且写了话或附了材料。只选模板不算——模板不代替你要讲的内容。 */
export function canStartHome(input: { text: string; images: number; materials: number; gate: HomeGate | null }): {
  ok: boolean;
  why: string | null;
} {
  if (input.gate && !input.gate.ok) return { ok: false, why: M.connectFirst };
  if (input.text.trim() || input.images || input.materials) return { ok: true, why: null };
  return { ok: false, why: M.sayFirst };
}

/**
 * 有没有一个 Agent 能用（原型 `aiGate`）：有一个就绪就行。
 * 都不行时分两种：装好了只是在设置里停用了（`disabled` 只在探测就绪、偏好停用时出现）→ 启用它；
 * 其余（没装、版本旧、没登录、出错）→ 去设置 › Agent 连接。
 */
export type HomeGate =
  | { ok: true }
  | { ok: false; reason: 'agent-off'; enable: { id: DriverId; name: string } | null }
  | { ok: false; reason: 'agent-missing' };

/**
 * `drivers` 为 null（还没拿到列表）时不下结论；已有一个就绪就算能用。都不就绪、但还有 Driver 在首次探测（`checking`）时
 * 也不下结论：它可能就是能用的那个，不先闪一下「装 Agent」的指引卡。
 */
export function homeGate(
  drivers: readonly Pick<DriverInfo, 'id' | 'name' | 'state'>[] | null,
  checking: readonly DriverId[],
): HomeGate | null {
  if (!drivers) return null;
  if (drivers.some((d) => d.state === 'ready')) return { ok: true };
  if (checking.length) return null;
  const off = drivers.find((d) => d.state === 'disabled');
  if (off) return { ok: false, reason: 'agent-off', enable: { id: off.id, name: off.name } };
  return { ok: false, reason: 'agent-missing' };
}

export interface GateGuide {
  title: string;
  body: string;
  /** 主按钮：启用那个停用的 Agent，或去设置 › Agent。 */
  action: string;
  enable: { id: DriverId; name: string } | null;
}

/** Agent 用不了时起始页下面那张指引卡（原型 `gateGuide` 的 agent-off / agent-missing）。 */
export function gateGuide(gate: HomeGate | null): GateGuide | null {
  if (!gate || gate.ok) return null;
  if (gate.reason === 'agent-off') {
    return {
      title: M.agentOffTitle,
      body: M.agentOffBody,
      action: gate.enable ? M.enableNamed(gate.enable.name) : M.enableAgent,
      enable: gate.enable,
    };
  }
  return {
    title: M.agentMissingTitle,
    body: M.agentMissingBody,
    action: M.connectAgent,
    enable: null,
  };
}

/** 起始页上还没发出去的设置：选的模板，以及交给 Agent 的本机素材。 */
export interface HomeBriefState {
  /** 挂着的场景模板的 id（模板目录里的，model/home-templates.ts）。作品示例不挂：它的提示词直接放进输入框。 */
  template: string | null;
  materials: readonly HomeMaterial[];
}

export const EMPTY_HOME_BRIEF: HomeBriefState = { template: null, materials: [] };

/** 挂上或摘掉场景模板（原型 page-new.jsx `pickScene`）；素材不动。 */
export function pickTemplate(state: HomeBriefState, template: Pick<HomeTemplate, 'id'> | null): HomeBriefState {
  return { ...state, template: template ? template.id : null };
}

/** 交给 Agent 的一份本机素材。 */
export interface HomeMaterial {
  path: string;
  name: string;
  kind: 'media' | 'image' | 'document';
}

/** 一次最多带几份素材（原型 `AgentHero` 同样是 8 份）。 */
export const MAX_HOME_MATERIALS = 8;

export function materialOf(path: string): HomeMaterial {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const kind = kindOfFileName(name);
  return { path, name, kind: kind === 'video-file' || kind === 'audio' ? 'media' : kind === 'image' ? 'image' : 'document' };
}

/** 并进新的素材：同一路径只留一份，超过上限的不收，并说退回了几份。 */
export function addMaterials(list: readonly HomeMaterial[], paths: readonly string[]): { list: HomeMaterial[]; rejected: number } {
  const next = [...list];
  let rejected = 0;
  for (const path of paths) {
    if (!path || next.some((m) => m.path === path)) continue;
    if (next.length >= MAX_HOME_MATERIALS) rejected++;
    else next.push(materialOf(path));
  }
  return { list: next, rejected };
}

/**
 * 新建项目的名称校验（原型 model-agent-projects.js `dirCreationError` 的名称部分）：空的、`.`/`..`、带斜杠或控制字符的不收。
 * 保存位置由 Runtime 定在项目根目录下（`projects.create` 只收名称），这里不校验父目录。
 */
export function projectNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return M.nameEmpty;
  if (trimmed === '.' || trimmed === '..' || /[/\\\u0000-\u001f]/.test(name)) return M.nameInvalid;
  return null;
}
