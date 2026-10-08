import { beforeEach, describe, expect, it } from 'vitest';
import type { PairedNode, ShareStatus } from '@baocut/protocol';
import { RuntimeSession } from '../../runtime/session.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useShare } from '../../state/share-store.ts';
import {
  flipShare,
  pairNode,
  refreshNodes,
  refreshShare,
  renewPairingCode,
  revokeShareClient,
  setShareCapability,
  unpairNode,
} from './share-commands.ts';

const status = (patch: Partial<ShareStatus> = {}): ShareStatus => ({
  enabled: false,
  listening: false,
  error: null,
  nodeId: 'node_self',
  name: 'Studio',
  port: 47610,
  addresses: [],
  allowAnySource: false,
  capabilities: { transcribe: { enabled: true } },
  pairing: null,
  clients: [],
  jobs: { running: 0, queued: 0 },
  ...patch,
});

const node = (nodeId: string): PairedNode => ({
  nodeId,
  alias: nodeId,
  name: nodeId,
  host: '192.168.1.31',
  port: 47610,
  pairedAt: '2026-10-01T00:00:00Z',
  health: null,
  problem: 'unreachable',
});

type Handler = (params: unknown) => unknown;

/** 只换掉 `client.request` 的会话：记下发出的方法与参数，按方法名回结果（可以是一个等着放行的 Promise）。 */
function fakeSession(handlers: Record<string, Handler>) {
  const calls: Array<[string, unknown]> = [];
  const session = Object.create(RuntimeSession.prototype) as RuntimeSession;
  Object.defineProperty(session, 'client', {
    value: {
      request: async (method: string, params: unknown) => {
        calls.push([method, params]);
        const handler = handlers[method];
        if (!handler) throw new Error(`没有准备 ${method}`);
        return handler(params);
      },
    },
  });
  return { session, calls };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  useShare.setState({ status: null, phase: null, nodes: null });
  useConnection.setState({ state: { status: 'connected', connectionId: 'c1' } as never });
});

describe('共享这台 Mac 的命令', () => {
  it('开始共享：那一两秒是「正在开始」，结果整份写回', async () => {
    const gate = deferred<ShareStatus>();
    const { session, calls } = fakeSession({ 'nodes.share.start': () => gate.promise });
    const running = flipShare(session, true);
    expect(useShare.getState().phase).toBe('starting');
    expect(await flipShare(session, true)).toBeNull();
    gate.resolve(status({ enabled: true, listening: true, pairing: { code: '481924', expiresAt: '2026-10-03T10:10:00Z' } }));
    await running;
    expect(useShare.getState().phase).toBeNull();
    expect(useShare.getState().status?.listening).toBe(true);
    expect(calls).toEqual([['nodes.share.start', {}]]);
  });

  it('停止共享失败时清掉「正在停止」并把错误抛出去', async () => {
    useShare.setState({ status: status({ enabled: true, listening: true }) });
    const { session } = fakeSession({
      'nodes.share.stop': () => {
        throw new Error('Runtime 正在停止');
      },
    });
    await expect(flipShare(session, false)).rejects.toThrow('Runtime 正在停止');
    expect(useShare.getState().phase).toBeNull();
    expect(useShare.getState().status?.enabled).toBe(true);
  });

  it('轮询结果晚于改动回来时不覆盖改动', async () => {
    const poll = deferred<ShareStatus>();
    const { session } = fakeSession({
      'nodes.share.status': () => poll.promise,
      'nodes.share.setCapability': () => status({ capabilities: { transcribe: { enabled: false } } }),
    });
    const reading = refreshShare(session);
    await setShareCapability(session, 'transcribe', false);
    poll.resolve(status());
    expect(await reading).toBeNull();
    expect(useShare.getState().status?.capabilities.transcribe?.enabled).toBe(false);
  });

  it('没连上 Runtime 时不读；读失败不改镜像', async () => {
    const { session, calls } = fakeSession({
      'nodes.share.status': () => {
        throw new Error('断了');
      },
    });
    useConnection.setState({ state: { status: 'disconnected', reason: 'x', retryInMs: null } });
    expect(await refreshShare(session)).toBeNull();
    expect(calls).toEqual([]);
    useConnection.setState({ state: { status: 'connected', connectionId: 'c1' } as never });
    useShare.setState({ status: status({ enabled: true }) });
    expect(await refreshShare(session)).toBeNull();
    expect(useShare.getState().status?.enabled).toBe(true);
  });

  it('重新生成配对码、吊销与开关能力都带对参数并写回', async () => {
    const { session, calls } = fakeSession({
      'nodes.share.pairingCode': () => status({ enabled: true, pairing: { code: '111222', expiresAt: '2026-10-03T10:10:00Z' } }),
      'nodes.share.revoke': () => status({ enabled: true, clients: [] }),
      'nodes.share.setCapability': (p) => status({ capabilities: { transcribe: { enabled: (p as { enabled: boolean }).enabled } } }),
    });
    await renewPairingCode(session);
    expect(useShare.getState().status?.pairing).toEqual({ code: '111222', expiresAt: '2026-10-03T10:10:00Z' });
    await revokeShareClient(session, 'client_a');
    await setShareCapability(session, 'transcribe', true);
    expect(calls).toEqual([
      ['nodes.share.pairingCode', {}],
      ['nodes.share.revoke', { clientId: 'client_a' }],
      ['nodes.share.setCapability', { capability: 'transcribe', enabled: true }],
    ]);
  });
});

describe('使用其他电脑的命令', () => {
  it('读已配对的节点；配对后放进列表，同一个节点替换原来那条', async () => {
    const { session, calls } = fakeSession({
      'nodes.list': () => ({ nodes: [node('node_a')] }),
      'nodes.pair': () => ({ node: { ...node('node_a'), problem: null } }),
    });
    await refreshNodes(session);
    expect(useShare.getState().nodes?.map((n) => n.nodeId)).toEqual(['node_a']);
    await pairNode(session, { host: '192.168.1.31', port: 47610, code: '481924' });
    expect(useShare.getState().nodes).toHaveLength(1);
    expect(useShare.getState().nodes?.[0]?.problem).toBeNull();
    expect(calls[1]).toEqual(['nodes.pair', { host: '192.168.1.31', port: 47610, code: '481924' }]);
  });

  it('取消配对只删这一台', async () => {
    useShare.setState({ nodes: [node('node_a'), node('node_b')] });
    const { session, calls } = fakeSession({ 'nodes.remove': () => ({}) });
    await unpairNode(session, 'node_a');
    expect(useShare.getState().nodes?.map((n) => n.nodeId)).toEqual(['node_b']);
    expect(calls).toEqual([['nodes.remove', { nodeId: 'node_a' }]]);
  });

  it('配对失败原样抛出，列表不变', async () => {
    useShare.setState({ nodes: [] });
    const { session } = fakeSession({
      'nodes.pair': () => {
        throw new Error('配对码不对');
      },
    });
    await expect(pairNode(session, { host: 'h', port: 1, code: '000000' })).rejects.toThrow('配对码不对');
    expect(useShare.getState().nodes).toEqual([]);
  });
});
