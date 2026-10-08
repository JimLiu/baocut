import type { PairedNode, ShareStatus } from '@baocut/protocol';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useShare } from '../../state/share-store.ts';

/**
 * 远端算力的命令（`nodes.share.*` 与 `nodes.*`）。每条改动都返回完整的 `ShareStatus`，拿到就整份写回镜像，
 * 界面不在本地改共享状态。失败原样抛给调用方提示。
 *
 * 轮询与改动会交错：一次 status 读在改动之前发出、之后才回来，会把改动的结果盖回旧值。所以每次改动写回时
 * 把代数加一，轮询回来时代数变了就丢掉这次结果。
 */
let generation = 0;

function write(status: ShareStatus): ShareStatus {
  generation += 1;
  useShare.getState().setStatus(status);
  return status;
}

/** 读一次共享状态写进镜像；没连上或读失败时不改（不打扰，下一次轮询再读）。 */
export async function refreshShare(session: RuntimeSession): Promise<ShareStatus | null> {
  if (useConnection.getState().state.status !== 'connected') return null;
  const before = generation;
  try {
    const status = await session.shareStatus();
    if (before !== generation || useShare.getState().phase) return null;
    useShare.getState().setStatus(status);
    return status;
  } catch {
    return null;
  }
}

/** 开始或停止共享：那一两秒亮「正在…」，结果整份写回；起停中再按不重复发。 */
export async function flipShare(session: RuntimeSession, on: boolean): Promise<ShareStatus | null> {
  const store = useShare.getState();
  if (store.phase) return null;
  store.setPhase(on ? 'starting' : 'stopping');
  try {
    return write(await (on ? session.startShare() : session.stopShare()));
  } finally {
    useShare.getState().setPhase(null);
  }
}

export async function renewPairingCode(session: RuntimeSession): Promise<ShareStatus> {
  return write(await session.renewPairingCode());
}

export async function revokeShareClient(session: RuntimeSession, clientId: string): Promise<ShareStatus> {
  return write(await session.revokeShareClient(clientId));
}

export async function setShareCapability(session: RuntimeSession, capability: string, enabled: boolean): Promise<ShareStatus> {
  return write(await session.setShareCapability(capability, enabled));
}

// ---- 使用其他电脑 ----

let nodesGeneration = 0;

/** 读一次已配对的节点（每个带 2 秒的实时探测）；失败时不改。 */
export async function refreshNodes(session: RuntimeSession): Promise<PairedNode[] | null> {
  if (useConnection.getState().state.status !== 'connected') return null;
  const before = nodesGeneration;
  try {
    const nodes = await session.listNodes();
    if (before !== nodesGeneration) return null;
    useShare.getState().setNodes(nodes);
    return nodes;
  } catch {
    return null;
  }
}

/** 配对成功后把这台节点放进列表（同一个 nodeId 再次配对替换原来的那条）。 */
export async function pairNode(
  session: RuntimeSession,
  params: { host: string; port: number; code: string },
): Promise<PairedNode> {
  const node = await session.pairNode(params);
  nodesGeneration += 1;
  const current = useShare.getState().nodes ?? [];
  useShare.getState().setNodes([...current.filter((n) => n.nodeId !== node.nodeId), node]);
  return node;
}

/** 取消配对：只删本机的记录与令牌。 */
export async function unpairNode(session: RuntimeSession, nodeId: string): Promise<void> {
  await session.removeNode(nodeId);
  nodesGeneration += 1;
  const current = useShare.getState().nodes ?? [];
  useShare.getState().setNodes(current.filter((n) => n.nodeId !== nodeId));
}
