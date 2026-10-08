import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcError, setLocale } from '@baocut/protocol';
import { NodesServer } from '@baocut/protocol/messages/nodes';
import { FileCredentialStore } from '@baocut/runtime-storage';
import { NodeStore } from './client/node-store.ts';

/** 界面语言是英文时，节点两端写给人看的错误是英文；发起端的 RPC 错误带消息引用。 */
describe('nodes 的英文文案', () => {
  let dir: string;

  beforeEach(async () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-nodes-en-'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('别名冲突：英文错误带引用', async () => {
    const credentials = new FileCredentialStore(path.join(dir, 'model-credentials.json'));
    const store = await NodeStore.open(path.join(dir, 'nodes.json'), credentials);
    const base = { name: 'Studio', host: '127.0.0.1', port: 7000, token: `${store.clientId}.secret` };
    await store.upsert({ ...base, nodeId: 'node_a', alias: 'Studio' } as never);
    const error = await store.upsert({ ...base, nodeId: 'node_b', alias: 'Studio' } as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).message).toBe('Another node already uses this alias: Studio');
    expect((error as RpcError).messageRef?.key).toBe('nodesClient.aliasTaken');
  });

  it('节点服务回给对方的说明按本机语言', () => {
    expect(NodesServer.portInUse({ port: 7000 }).text).toBe('Port 7000 is already in use');
    expect(NodesServer.capabilityNotShareable({ capability: 'x', shareable: 'transcribe' }).text).not.toMatch(/[一-龥]/);
  });
});
