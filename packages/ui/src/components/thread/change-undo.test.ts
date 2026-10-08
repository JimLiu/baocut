import { describe, expect, it } from 'vitest';
import { RpcError, type EngineErrorBody, type FileTarget } from '@baocut/protocol';
import { alreadyUndoneBy, undoInBackground, type BackgroundUndoDeps } from './change-undo.ts';

const target: FileTarget = { projectId: 'proj_1', path: '样片' };

function engineError(code: string, details: unknown = null): RpcError {
  const body: EngineErrorBody = { code, message: code, entityIds: [], inputRevisions: [], retryability: 'never', details };
  return new RpcError('conflict', code, body);
}

function fakeDeps(options: { holds?: boolean; undo?: () => unknown } = {}) {
  const calls: { method: string; params: unknown }[] = [];
  const request = (async (method: string, params: unknown) => {
    calls.push({ method, params });
    if (method === 'videos.open') return { ref: { videoId: 'mov_1' }, snapshot: {} };
    if (method === 'edits.undo') return options.undo ? options.undo() : { receipt: { transactionId: 'tx_undo' }, replayed: false };
    if (method === 'videos.close') return { closed: true };
    throw new Error(`unexpected ${method}`);
  }) as unknown as BackgroundUndoDeps['request'];
  const holds: { target: FileTarget; videoId: string }[] = [];
  const deps: BackgroundUndoDeps = {
    request,
    editorHolds: (t, videoId) => {
      holds.push({ target: t, videoId });
      return options.holds ?? false;
    },
  };
  return { deps, calls, holds };
}

describe('undoInBackground', () => {
  it('打开 → 按事务撤销 → 关掉', async () => {
    const { deps, calls, holds } = fakeDeps();
    await expect(undoInBackground(deps, target, 'tx_1')).resolves.toEqual({ kind: 'undone', transactionId: 'tx_undo' });
    expect(calls.map((c) => c.method)).toEqual(['videos.open', 'edits.undo', 'videos.close']);
    expect(calls[0]!.params).toEqual(target);
    expect(calls[1]!.params).toMatchObject({ videoId: 'mov_1', target: { transaction: 'tx_1' } });
    expect(calls[2]!.params).toEqual({ videoId: 'mov_1' });
    expect(holds).toEqual([{ target, videoId: 'mov_1' }]);
  });

  it('编辑器占着这个视频时不替它关', async () => {
    const { deps, calls } = fakeDeps({ holds: true });
    await undoInBackground(deps, target, 'tx_1');
    expect(calls.map((c) => c.method)).toEqual(['videos.open', 'edits.undo']);
  });

  it('已经撤销过：返回撤销它的那一笔，照样关掉', async () => {
    const { deps, calls } = fakeDeps({
      undo: () => {
        throw engineError('UNDO_UNAVAILABLE', { transactionId: 'tx_1', undoneBy: 'tx_prev' });
      },
    });
    await expect(undoInBackground(deps, target, 'tx_1')).resolves.toEqual({ kind: 'already-undone', transactionId: 'tx_prev' });
    expect(calls.at(-1)!.method).toBe('videos.close');
  });

  it('撤销冲突等其它错误原样抛出，也会关掉', async () => {
    const { deps, calls } = fakeDeps({
      undo: () => {
        throw engineError('UNDO_CONFLICT');
      },
    });
    await expect(undoInBackground(deps, target, 'tx_1')).rejects.toThrow('UNDO_CONFLICT');
    expect(calls.at(-1)!.method).toBe('videos.close');
  });
});

describe('alreadyUndoneBy', () => {
  it('只认带着 undoneBy 的 UNDO_UNAVAILABLE', () => {
    expect(alreadyUndoneBy(engineError('UNDO_UNAVAILABLE', { undoneBy: 'tx_u' }))).toBe('tx_u');
    expect(alreadyUndoneBy(engineError('UNDO_UNAVAILABLE'))).toBeNull();
    expect(alreadyUndoneBy(engineError('UNDO_CONFLICT', { undoneBy: 'tx_u' }))).toBeNull();
    expect(alreadyUndoneBy(new RpcError('not-found', 'x', { code: 'UNDO_UNAVAILABLE' }))).toBeNull();
    expect(alreadyUndoneBy(new Error('x'))).toBeNull();
  });
});
