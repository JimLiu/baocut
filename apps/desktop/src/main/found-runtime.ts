import { BaoCutClient, type ConnectionTarget } from '@baocut/client';
import { RpcError, RUNTIME_VERSION, type FoundActivity } from '@baocut/protocol';

/**
 * 与发现文件指向的 Runtime 说话（CLI 独立使用与发布 §4.2、§4.3）：问它忙不忙、请它停下。每次开一条短的桌面端连接，用完就关；
 * `runtime.status` 是被动请求，问一次不让它变成「在用」。
 */
export interface FoundRuntimeProbe {
  /** `runtime.status`：连不上、协议版本不同或超时时 null。 */
  activity(target: ConnectionTarget): Promise<FoundActivity | null>;
  /**
   * 协议版本不同的 Runtime 在握手的拒绝里报的任务数（新版 Runtime 会带上，旧版没有）。不知道时 null。
   */
  mismatchJobs(target: ConnectionTarget): Promise<number | null>;
  /** `runtime.stop`：它答应停下时 true；拒绝（有任务或别的 CLI 连接，或不是 CLI 拉起的）或问不到时 false。 */
  stop(target: ConnectionTarget): Promise<boolean>;
}

const PROBE_TIMEOUT_MS = 5_000;

async function withClient<T>(target: ConnectionTarget, use: (client: BaoCutClient) => Promise<T>): Promise<T> {
  const client = new BaoCutClient({
    resolve: async () => target,
    client: { kind: 'desktop', name: 'BaoCut runtime supervisor', version: RUNTIME_VERSION },
    reconnect: false,
    requestTimeoutMs: PROBE_TIMEOUT_MS,
  });
  try {
    await withTimeout(client.connect(), PROBE_TIMEOUT_MS);
    return await use(client);
  } finally {
    client.close();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const clientProbe: FoundRuntimeProbe = {
  activity: (target) => withClient(target, (client) => client.request('runtime.status', {})).catch(() => null),
  async mismatchJobs(target) {
    try {
      await withClient(target, async () => undefined);
      return null;
    } catch (error) {
      if (!(error instanceof RpcError) || error.code !== 'protocol-mismatch') return null;
      const jobs = (error.details as { activeJobs?: unknown } | undefined)?.activeJobs;
      return typeof jobs === 'number' ? jobs : null;
    }
  },
  stop: (target) =>
    withClient(target, (client) => client.request('runtime.stop', {})).then(
      () => true,
      () => false,
    ),
};
