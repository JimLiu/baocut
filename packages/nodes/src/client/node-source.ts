import type { Localized, PairedNode, ProviderCapability, ProviderUnavailableReason, ProviderView, TranscribeModelInfo } from '@baocut/protocol';
import {
  BUNDLES,
  DEFAULT_TRANSCRIBE_BUNDLES,
  modelDetail,
  type DescribeMode,
  type ProviderQueue,
  type ProviderSource,
  type TranscribeProvider,
} from '@baocut/models';
import type { PairedNodeRecord } from './node-store.ts';
import { NodesClient as NC } from '@baocut/protocol/messages/nodes';

/**
 * 已配对节点的 Provider 来源（`node:<nodeId>`，架构设计 §6.7）：每个已配对的节点是一个 Provider，模型是节点上的模型包。
 *
 * 可用性分两种取法（见 `DescribeMode`）：
 * - 提交时的选择（`select`）不联网：节点配对着就算可用，连不连得上、模型包就没就绪由尝试前的预检判断
 *   （失败为任务的 `REMOTE_NODE_*`，与以前相同）；
 * - `models.capabilities`（`probe`）对每个节点做一次健康探测（`NodeInitiator.probe`，至多 2 秒，并行），并记下结果；
 *   之后配置变化引起的重算（`view`）沿用最近一次的探测结果，不再联网。
 *
 * 没有探测结果时，模型列表取本机模型包登记里的转写模型包（节点多半装的也是它们），可用性不标。
 */

/** NodeInitiator 里这个来源要用的部分。 */
export interface NodeSourceInitiator {
  readonly store: {
    list(): PairedNodeRecord[];
    get(nodeId: string): PairedNodeRecord | null;
    resolve(ref: string): PairedNodeRecord | null;
    credentialProblem(nodeId: string): string | null;
  };
  readonly provider: TranscribeProvider;
  probe(nodeId: string): Promise<PairedNode | null>;
}

const PREFIX = 'node:';

export class NodeProviderSource implements ProviderSource {
  readonly kind = 'node' as const;
  readonly #initiator: NodeSourceInitiator;
  /** 最近一次探测的结果。 */
  readonly #probed = new Map<string, PairedNode>();

  constructor(initiator: NodeSourceInitiator) {
    this.#initiator = initiator;
  }

  owns(providerId: string): boolean {
    return providerId.startsWith(PREFIX);
  }

  /** `node:<nodeId 或别名>` → `node:<nodeId>`。 */
  resolve(providerId: string): string | null {
    if (!this.owns(providerId)) return null;
    const record = this.#initiator.store.resolve(providerId.slice(PREFIX.length));
    return record ? `${PREFIX}${record.nodeId}` : null;
  }

  async list(mode: DescribeMode): Promise<ProviderView[]> {
    const records = this.#initiator.store.list();
    const views = await Promise.all(records.map((record) => this.#describe(record, mode)));
    // 已经不再配对的节点不留探测结果。
    const ids = new Set(records.map((r) => r.nodeId));
    for (const nodeId of this.#probed.keys()) if (!ids.has(nodeId)) this.#probed.delete(nodeId);
    return views;
  }

  async describe(providerId: string, mode: DescribeMode): Promise<ProviderView | null> {
    const resolved = this.resolve(providerId);
    const record = resolved ? this.#initiator.store.get(resolved.slice(PREFIX.length)) : null;
    return record ? this.#describe(record, mode) : null;
  }

  transcriber(providerId: string): TranscribeProvider | null {
    return this.owns(providerId) ? this.#initiator.provider : null;
  }

  /** 每个节点一个队列，本机同时只向一个节点交一个任务（节点自己排队）。 */
  queue(providerId: string): ProviderQueue {
    return { key: providerId, concurrency: 1 };
  }

  executors(): TranscribeProvider[] {
    return [this.#initiator.provider];
  }

  async #describe(record: PairedNodeRecord, mode: DescribeMode): Promise<ProviderView> {
    let probed: PairedNode | null = null;
    if (mode === 'probe') {
      probed = await this.#initiator.probe(record.nodeId).catch(() => null);
      if (probed) this.#probed.set(record.nodeId, probed);
    } else if (mode === 'view') {
      probed = this.#probed.get(record.nodeId) ?? null;
    }
    return {
      providerId: `${PREFIX}${record.nodeId}`,
      kind: 'node',
      label: NC.nodeLabel({ alias: record.alias }).text,
      config: null,
      capabilities: { transcribe: transcribeCapability(probed, this.#initiator.store.credentialProblem(record.nodeId)) },
    };
  }
}

function transcribeCapability(probed: PairedNode | null, credentialProblem: string | null): ProviderCapability<TranscribeModelInfo> {
  const transcribe = probed?.health?.capabilities?.transcribe;
  const models: TranscribeModelInfo[] = transcribe
    ? transcribe.bundles.map((b) => {
        const reason = bundleReason(b.state);
        return model(
          b.bundleId,
          NC.bundleLabel({ bundleId: b.bundleId, backend: b.backend, device: b.device }).text,
          reason ? { available: false, unavailableReason: reason } : { available: true },
        );
      })
    : BUNDLES.filter((b) => b.capability === 'transcribe').map((b) => model(b.bundleId, NC.bundleLabel({ bundleId: b.bundleId, backend: b.backend, device: b.device }).text, {}));
  const usable = models.filter((m) => m.available !== false);
  const preferred = usable.find((m) => DEFAULT_TRANSCRIBE_BUNDLES.includes(m.modelId)) ?? usable[0] ?? models[0];
  if (preferred) preferred.default = true;

  let reason: ProviderUnavailableReason | null = null;
  let detail: Localized | undefined;
  if (credentialProblem) [reason, detail] = ['not-paired', NC.tokenUnreadable({ problem: credentialProblem })];
  else if (probed?.problem === 'unreachable') [reason, detail] = ['not-connected', NC.unreachable()];
  else if (probed?.problem === 'version') [reason, detail] = ['unsupported', NC.versionIncompatible()];
  else if (probed?.problem === 'unpaired') [reason, detail] = ['not-paired', NC.pairingRevoked()];
  else if (transcribe && !transcribe.enabled)
    [reason, detail] = ['unsupported', NC.transcribeSharingOff()];
  else if (transcribe && usable.length === 0) [reason, detail] = ['not-installed', NC.noTranscribeBundle()];
  return { models, available: reason === null, ...(reason ? { unavailableReason: reason } : {}), ...(detail ? modelDetail(detail) : {}) };
}

function bundleReason(state: string): ProviderUnavailableReason | null {
  if (state === 'not-installed') return 'not-installed';
  if (state === 'error') return 'unsupported';
  return null;
}

function model(modelId: string, label: string, availability: Partial<TranscribeModelInfo>): TranscribeModelInfo {
  return {
    modelId,
    label,
    maxInputBytes: null,
    maxDurationSec: null,
    wordTimestamps: 'none',
    languages: 'any',
    acceptsHint: true,
    cost: 'free-local',
    ...availability,
  };
}
