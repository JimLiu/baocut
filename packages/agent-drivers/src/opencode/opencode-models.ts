/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/opencode/v2/mapping.ts 的 modelsFromV2 / modelRef（`provider/model` 的写法、
 * 只留 enabled 的模型、variants 当推理强度），v2/readiness.ts 的 waitForLocationReady（冷启动的目录先回空的插件表，
 * 轮询到非空才算就绪），v2/agent.ts 的 fetchCatalog。
 * 改成 BaoCut 的 DriverModel；没有账号时不报错（OpenCode Zen 的免费模型不用登录），账号按已启用的 provider 报。
 */
import type { DriverModel } from '@baocut/protocol';
import { DriversOpencode } from '@baocut/protocol/messages/agent-drivers';
import type { OpenCodeServer } from './opencode-server.ts';

/** `/api/model` 里的一个模型（只列用到的字段）。 */
export interface OpenCodeModel {
  id: string;
  providerID: string;
  name?: string;
  enabled?: boolean;
  status?: string;
  capabilities?: { input?: string[] };
  variants?: Array<{ id: string }>;
}

export interface OpenCodeProvider {
  id: string;
  name?: string;
  activation?: string;
}

/** OpenCode 自带、不用登录的 provider（OpenCode Zen 的免费模型）。 */
export const BUILTIN_PROVIDER = 'opencode';

export interface OpenCodeCatalog {
  models: DriverModel[];
  /** 已启用的、需要账号的 provider 名称（逗号分隔）；只有自带的免费 provider 时为 null。 */
  account: string | null;
}

/**
 * 等目录就绪：冷启动时 `/api/plugin` 先回空表，配置里的插件登记完才有内容（实测 2.0.24：第一次 0 个，随后 86 个）。
 * 在那之前读模型表、建会话会拿到空的结果。
 */
export async function waitForLocation(server: OpenCodeServer, directory: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await server.request<{ data?: unknown[] }>('GET', '/api/plugin', { location: directory, timeoutMs: 5_000 });
    if (Array.isArray(res?.data) && res.data.length > 0) return;
    if (Date.now() > deadline) throw new Error(String(DriversOpencode.directoryNotReady({ seconds: String(Math.round(timeoutMs / 1000)), directory })));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 读模型表、默认模型与已启用的 provider。 */
export async function readCatalog(server: OpenCodeServer, directory: string): Promise<OpenCodeCatalog> {
  await waitForLocation(server, directory);
  const [models, fallback, providers] = await Promise.all([
    server.request<{ data?: OpenCodeModel[] | null }>('GET', '/api/model', { location: directory }),
    server.request<{ data?: OpenCodeModel | null }>('GET', '/api/model/default', { location: directory }).catch(() => null),
    server.request<{ data?: OpenCodeProvider[] | null }>('GET', '/api/provider', { location: directory }).catch(() => null),
  ]);
  const defaultId = fallback?.data ? modelId(fallback.data) : null;
  return { models: driverModels(models?.data ?? [], defaultId), account: accountOf(providers?.data ?? []) };
}

/** BaoCut 的模型 id：`<providerID>/<id>`，例如 `anthropic/claude-sonnet-5`、`opencode/big-pickle`。 */
export function modelId(model: Pick<OpenCodeModel, 'id' | 'providerID'>): string {
  return `${model.providerID}/${model.id}`;
}

/** 反过来：按第一个 `/` 拆开（模型 id 自己可能带斜杠）。拆不开时为 null。 */
export function modelRef(id: string, effort: string | null): { providerID: string; id: string; variant?: string } | null {
  const cut = id.indexOf('/');
  if (cut <= 0 || cut === id.length - 1) return null;
  return { providerID: id.slice(0, cut), id: id.slice(cut + 1), ...(effort ? { variant: effort } : {}) };
}

export function driverModels(models: OpenCodeModel[], defaultId: string | null): DriverModel[] {
  return models
    .filter((m) => m.enabled !== false && m.status !== 'deprecated')
    .map((m) => {
      const id = modelId(m);
      const efforts = (m.variants ?? []).filter((v) => v.id && v.id !== 'default').map((v) => ({ id: v.id, label: v.id }));
      return {
        id,
        label: m.name || id,
        description: null,
        tier: null,
        isDefault: id === defaultId,
        efforts,
        defaultEffort: null,
      };
    });
}

/** 账号：除了自带的免费 provider 之外已启用的 provider。 */
export function accountOf(providers: OpenCodeProvider[]): string | null {
  const names = providers
    .filter((p) => p.id !== BUILTIN_PROVIDER && (p.activation === undefined || p.activation === 'enabled'))
    .map((p) => p.name || p.id);
  return names.length > 0 ? names.join(', ') : null;
}
