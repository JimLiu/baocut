/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/pi/agent.ts 的 resolvePiThinkingConfig（按 thinkingLevelMap 筛推理档位、
 * 默认 medium 先往上再往下就近取）、parseModelReference（`provider/id` 或 `provider:id`）与 piModelSupportsImageInput。
 * 改成 BaoCut 的 DriverModel：模型 id 统一写 `provider/id`，档位名直接用 pi 的档位 id。
 */
import type { DriverModel } from '@baocut/protocol';

/** `get_available_models` 与 `get_state` 里的模型。只列出用到的字段。 */
export interface PiModel {
  id: string;
  name?: string;
  provider: string;
  reasoning?: boolean;
  input?: string[];
  /** 档位到模型原生取值的映射；某档为 null 表示这个模型不支持它。xhigh、max 只有映射里有才算支持。 */
  thinkingLevelMap?: Record<string, unknown>;
}

export const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];
const DEFAULT_THINKING: PiThinkingLevel = 'medium';

export function isPiThinkingLevel(value: string | null | undefined): value is PiThinkingLevel {
  return !!value && (PI_THINKING_LEVELS as readonly string[]).includes(value);
}

/** BaoCut 里的模型 id：`provider/id`。 */
export function piModelId(model: Pick<PiModel, 'provider' | 'id'>): string {
  return `${model.provider}/${model.id}`;
}

/** 拆开 `provider/id`（也认 `provider:id`）；没有分隔符时只有 id。 */
export function parseModelReference(modelId: string): { provider: string | null; id: string } {
  for (const sep of ['/', ':']) {
    const at = modelId.indexOf(sep);
    if (at > 0 && at < modelId.length - 1) return { provider: modelId.slice(0, at), id: modelId.slice(at + 1) };
  }
  return { provider: null, id: modelId };
}

export function piModelTakesImages(model: Pick<PiModel, 'input'> | null | undefined): boolean {
  return model?.input?.includes('image') === true;
}

/**
 * 这个模型能选的推理档位与默认档。不推理的模型没有档位。pi 自己的默认是 medium，模型不支持时先往上取最近的，没有再取剩下最高的。
 */
export function piThinkingLevels(model: PiModel): { efforts: PiThinkingLevel[]; defaultEffort: PiThinkingLevel | null } {
  if (!model.reasoning) return { efforts: [], defaultEffort: null };
  const efforts = PI_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
  const base = PI_THINKING_LEVELS.indexOf(DEFAULT_THINKING);
  const defaultEffort = efforts.find((level) => PI_THINKING_LEVELS.indexOf(level) >= base) ?? efforts.at(-1) ?? null;
  return { efforts, defaultEffort };
}

/** `get_available_models` 的结果 → BaoCut 的模型表。`current` 是 `get_state` 里当前的模型（pi 的默认）。 */
export function derivePiModels(models: PiModel[], current: Pick<PiModel, 'provider' | 'id'> | null): DriverModel[] {
  const currentId = current && current.provider !== 'unknown' ? piModelId(current) : null;
  return models
    .filter((m) => typeof m?.id === 'string' && typeof m?.provider === 'string')
    .map((m) => {
      const id = piModelId(m);
      const { efforts, defaultEffort } = piThinkingLevels(m);
      return {
        id,
        label: typeof m.name === 'string' && m.name ? m.name : m.id,
        description: id,
        tier: null,
        isDefault: id === currentId,
        efforts: efforts.map((level) => ({ id: level, label: level })),
        defaultEffort,
      };
    });
}
