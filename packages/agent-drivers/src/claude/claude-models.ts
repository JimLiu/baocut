/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/claude/models.ts 的 getClaudeModelsWithSettings / readClaudeSettingsModels
 * （把 settings.json 的 env 里指定的模型并进模型表）。
 */
import type { DriverEffort, DriverModel, ModelTier } from '@baocut/protocol';
import type { EffortLevel, ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { DriversClaude } from '@baocut/protocol/messages/agent-drivers';

/**
 * Claude 的模型表：来自 SDK 的 `supportedModels()`（不花钱、不要求登录），拿不到时用内置的精简表。
 *
 * `supportedModels()` 的真实形状（2.1.284，未登录）：第一行 `value: 'default'`，描述里写着它当前指向谁
 * （`resolvedModel` 也是）；其余行的 `value` 是别名或完整 id（`opus`、`sonnet`、`haiku`、`claude-fable-5-1[1m]`），
 * `description` 形如 `Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok`。
 */

export interface ClaudeModelEntry extends DriverModel {
  /** 别名解析到的完整模型 id；判断 `settings.json` 里写的模型认不认识时也比它。 */
  resolvedModel: string | null;
}

const EFFORT_LABEL: Record<EffortLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

export const CLAUDE_EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function isClaudeEffort(value: string): value is EffortLevel {
  return (CLAUDE_EFFORTS as readonly string[]).includes(value);
}

function efforts(levels: readonly EffortLevel[] | undefined): DriverEffort[] {
  return (levels ?? []).map((id) => ({ id, label: EFFORT_LABEL[id] ?? id }));
}

/** 按名字归档。Fable 是比 Opus 更强的一档，也归 `max`；认不出的（网关的自定义 id 等）为 null。 */
export function claudeTier(id: string): ModelTier | null {
  const lower = id.toLowerCase();
  if (lower.includes('fable') || lower.includes('opus')) return 'max';
  if (lower.includes('sonnet')) return 'balanced';
  if (lower.includes('haiku')) return 'fast';
  return null;
}

/** SDK 的模型表 → DriverModel。`default` 那一行不单列，它指向的模型标为默认。 */
export function mapClaudeModels(infos: ModelInfo[]): ClaudeModelEntry[] {
  const fallback = infos.find((m) => m.value === 'default');
  const defaultTarget = fallback?.resolvedModel ?? null;
  let defaultTaken = false;
  return infos
    .filter((m) => m.value !== 'default')
    .map((m) => {
      const { label, description } = splitDescription(m);
      const isDefault = !defaultTaken && defaultTarget !== null && m.resolvedModel === defaultTarget;
      if (isDefault) defaultTaken = true;
      return {
        id: m.value,
        label,
        description,
        tier: claudeTier(m.resolvedModel ?? m.value),
        isDefault,
        efforts: m.supportsEffort === false ? [] : efforts(m.supportedEffortLevels),
        // SDK 不给模型的默认强度；null = 按 Claude Code 自己的默认。
        defaultEffort: null,
        resolvedModel: m.resolvedModel ?? null,
      };
    });
}

/** `Opus 5.5 · Best for … · $4/$20 per Mtok` → 标签 `Opus 5.5`，其余作描述。没有分隔符时用 displayName。 */
function splitDescription(m: ModelInfo): { label: string; description: string | null } {
  const parts = (m.description ?? '').split(' · ').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return { label: parts[0]!, description: parts.slice(1).join(' · ') };
  return { label: m.displayName || m.value, description: m.description?.trim() || null };
}

/**
 * 拿不到 `supportedModels()` 时的精简表：只列别名，别名总指向当前版本，不会过时。
 * 强度按常见的四档给；不知道哪个是默认，都不标。
 */
export const FALLBACK_CLAUDE_MODELS: ClaudeModelEntry[] = [
  { id: 'opus', label: 'Opus', description: null, tier: 'max', isDefault: false, efforts: efforts(['low', 'medium', 'high', 'max']), defaultEffort: null, resolvedModel: null },
  { id: 'sonnet', label: 'Sonnet', description: null, tier: 'balanced', isDefault: false, efforts: efforts(['low', 'medium', 'high', 'max']), defaultEffort: null, resolvedModel: null },
  { id: 'haiku', label: 'Haiku', description: null, tier: 'fast', isDefault: false, efforts: [], defaultEffort: null, resolvedModel: null },
];

const ENV_KEY_TIER: Record<string, ModelTier | null> = {
  ANTHROPIC_MODEL: null,
  ANTHROPIC_DEFAULT_FABLE_MODEL: 'max',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'max',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'balanced',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'fast',
};

/**
 * 把用户设置 `env` 里指定的模型（`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_*_MODEL`）并进模型表：表里已有的（比 id 与解析后的
 * 完整 id，见 `claudeModelKnown`）不重复列，其余追加在后面。档位先按名字认，认不出时按它替代的是哪一档；
 * 强度不知道，不给（空表 = 不分强度）。
 */
export function withSettingsModels(models: ClaudeModelEntry[], envModels: Array<{ key: string; id: string }>): ClaudeModelEntry[] {
  const out = [...models];
  for (const { key, id } of envModels) {
    if (claudeModelKnown(id, out)) continue;
    out.push({
      id,
      label: id,
      description: String(DriversClaude.fromSettings({ key })),
      tier: claudeTier(id) ?? ENV_KEY_TIER[key] ?? null,
      isDefault: false,
      efforts: [],
      defaultEffort: null,
      resolvedModel: null,
    });
  }
  return out;
}

/** `settings.json` 里写的模型在不在表里：比 id、解析后的完整 id，忽略 `[1m]` 之类的后缀与大小写。 */
export function claudeModelKnown(model: string, models: ClaudeModelEntry[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\[[^\]]*\]$/, '');
  const want = norm(model);
  return models.some((m) => norm(m.id) === want || (m.resolvedModel !== null && norm(m.resolvedModel) === want));
}

/**
 * 某个模型能不能用 `auto` 权限模式。看 `supportsAutoMode`：2.1.284 上 opus / sonnet / fable 标了 true，haiku 没有这个字段。
 * 表里没有任何一行带这个字段时（旧 CLI）不知道，返回 null，由调用方直接试。
 * `model` 为 null 表示用默认模型，看 `default` 那一行。
 */
export function claudeAutoModeSupport(infos: ModelInfo[], model: string | null): boolean | null {
  if (!infos.some((m) => m.supportsAutoMode !== undefined)) return null;
  const want = model ?? 'default';
  const entry = infos.find((m) => m.value === want) ?? infos.find((m) => m.resolvedModel === want);
  if (!entry) return null;
  return entry.supportsAutoMode === true;
}
