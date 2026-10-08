/**
 * Codex 的模型目录：起一个临时的 `codex app-server`，经 `model/list` 取模型表，换成 `DriverModel`。
 *
 * 模型字段的取法参考了 paseo 的 packages/server/src/server/agent/providers/codex-app-server-agent.ts
 * （`CodexModelListResponseSchema`、`buildCodexModelDefinition`、`buildCodexThinkingOptionMap`），
 * Apache-2.0，Copyright (c) 2025-present Mohamed Boudra；modified：改成 BaoCut 的 `DriverModel` 形状，
 * 加上隐藏模型的区分、tier 推断与分页上限。
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { RUNTIME_VERSION, type DriverModel, type ModelTier } from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import type { CodexInstall } from './codex-binary.ts';
import type { CodexModel, InitializeParams, ModelListParams, ModelListResponse } from './codex-protocol.ts';
import { CodexRpcConnection } from './rpc-connection.ts';

/** 一次 `model/list` 的结果。`all` 含隐藏模型，用来判断配置里的模型这一版 CLI 认不认得。 */
export interface CodexCatalog {
  models: DriverModel[];
  all: string[];
}

const MAX_PAGES = 5;

/**
 * 起临时 app-server 取模型表。不跑模型回合，不花额度；整个过程限时 `timeoutMs`，结束（含失败、超时）一定关掉进程。
 * 没登录时能不能拿到：未验证（本机的 codex 是登录状态）；拿不到时调用方给空表。
 */
export async function listCodexModels(install: CodexInstall, log: Logger, timeoutMs = 15_000): Promise<CodexCatalog> {
  const child = spawn(install.command, ['app-server'], {
    cwd: os.tmpdir(),
    env: install.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const conn = new CodexRpcConnection(child, log);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`codex model/list timed out (${timeoutMs} ms)`)), timeoutMs);
  });
  try {
    return await Promise.race([fetchCatalog(conn, timeoutMs), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    await conn.close();
  }
}

async function fetchCatalog(conn: CodexRpcConnection, timeoutMs: number): Promise<CodexCatalog> {
  // 真实的 app-server 会发 configWarning 之类的通知，一律不管。
  conn.onNotification(() => {});
  const init: InitializeParams = {
    clientInfo: { name: 'baocut', title: 'BaoCut', version: RUNTIME_VERSION },
    capabilities: null,
  };
  await conn.request('initialize', init, timeoutMs);
  conn.notify('initialized');
  const raw: CodexModel[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: ModelListParams = { includeHidden: true, ...(cursor ? { cursor } : {}) };
    const res = await conn.request<ModelListResponse>('model/list', params, timeoutMs);
    raw.push(...(Array.isArray(res?.data) ? res.data : []));
    cursor = typeof res?.nextCursor === 'string' && res.nextCursor ? res.nextCursor : null;
    if (!cursor) break;
  }
  return toCatalog(raw);
}

export function toCatalog(raw: CodexModel[]): CodexCatalog {
  const valid = raw.filter((m) => m && typeof m.id === 'string' && m.id);
  return {
    models: valid.filter((m) => !m.hidden).map(toDriverModel),
    all: valid.map((m) => m.id),
  };
}

export function toDriverModel(m: CodexModel): DriverModel {
  const efforts = (Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : [])
    .map((e) => (typeof e?.reasoningEffort === 'string' ? e.reasoningEffort : ''))
    .filter(Boolean)
    // 中文标签由界面按 id 映射；原生没有短标签，就用 id。
    .map((id) => ({ id, label: id }));
  const description = typeof m.description === 'string' && m.description.trim() ? m.description.trim() : null;
  return {
    id: m.id,
    label: typeof m.displayName === 'string' && m.displayName ? m.displayName : m.id,
    description,
    tier: inferTier(m.id, description),
    // 原样转述 Codex 自己标的默认，不替用户改（设计稿：模型目录是「发现」的证据，不是改写选择的许可）。
    isDefault: m.isDefault === true,
    efforts,
    defaultEffort: typeof m.defaultReasoningEffort === 'string' && m.defaultReasoningEffort ? m.defaultReasoningEffort : null,
  };
}

/**
 * 按名字与说明推断定位。名字的家族后缀优先（`-sol` 主力、`-astra` 最强、`-luna` 最快，对照 0.159.0 的目录），
 * 其次看说明里的说法；都推不出来为 null。界面只给推荐的那一个标「推荐」，所以 balanced 标得宽一些无妨。
 */
export function inferTier(id: string, description: string | null): ModelTier | null {
  const name = id.toLowerCase();
  if (/-sol\b/.test(name)) return 'balanced';
  if (/-astra\b/.test(name)) return 'max';
  if (/-luna\b|-mini\b|-nano\b/.test(name)) return 'fast';
  const text = (description ?? '').toLowerCase();
  if (/\bfrontier\b|most demanding|most capable|strongest/.test(text)) return 'max';
  if (/\bfast(est)?\b/.test(text)) return 'fast';
  if (/\bworkhorse\b|\bbalanced\b|\beveryday\b/.test(text)) return 'balanced';
  return null;
}
