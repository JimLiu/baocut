import { describe, expect, it, vi } from 'vitest';
import { RpcError, type LibraryEntrySummary, type MediaHandle } from '@baocut/protocol';
import type { HostBridge } from '../../host.ts';
import { RuntimeSession } from '../../runtime/session.ts';
import type { VoiceEntry } from '../../model/voices-library.ts';
import {
  auditionHandle,
  cloneVoice,
  createVoice,
  deleteVoice,
  exportVoice,
  importVoicePackage,
  removeClone,
  saveVoice,
} from './voice-actions.ts';

/**
 * 我的声音的命令走真的 `RuntimeSession`（追加的薄方法），只把 `client.request` 换成假的：记下方法与参数，按方法回一个结果。
 * 不上传、不建克隆、不碰任何 Provider——克隆的创建与删除都停在这一层。
 */

type Reply = (params: Record<string, unknown>) => unknown;

function fakeSession(replies: Record<string, Reply>) {
  const session = new RuntimeSession({} as HostBridge);
  const calls: [string, Record<string, unknown>][] = [];
  vi.spyOn(session.client, 'request').mockImplementation((async (method: string, params: Record<string, unknown>) => {
    calls.push([method, params]);
    const reply = replies[method];
    if (!reply) throw new Error(`没有料到的调用 ${method}`);
    return reply(params);
  }) as never);
  return { session, calls };
}

function entry(version = 3, patch: Partial<VoiceEntry['content']> = {}): VoiceEntry {
  return {
    library: 'voices',
    id: 'voc_1',
    version,
    contentHash: `sha256:${version}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-03T08:00:00.000Z',
    content: {
      name: '主播',
      language: 'zh-CN',
      transcript: '大家好',
      origin: 'imported',
      consent: { declared: true, declaredAt: '2026-10-01T00:00:00.000Z', statement: '我本人的声音' },
      reference: { sha256: 'sha256:r', byteLength: 1000, mediaType: 'audio/wav', fileName: 'ref.wav' },
      ...patch,
    },
  };
}

function summary(clones: LibraryEntrySummary['clones'] = []): LibraryEntrySummary {
  return { library: 'voices', id: 'voc_1', version: 3, contentHash: 'sha256:3', name: '主播', kind: 'voice', updatedAt: '', consentDeclared: true, clones };
}

describe('新建与编辑', () => {
  it('从文件新建：library.put 带 source.path 与 commandId', async () => {
    const { session, calls } = fakeSession({ 'library.put': () => ({ entry: entry(1), created: true, changed: true }) });
    await createVoice(session, { name: '主播', language: 'zh-CN', transcript: '', consent: false }, '/tmp/ref.wav');
    expect(calls[0]![0]).toBe('library.put');
    expect(calls[0]![1]).toMatchObject({
      library: 'voices',
      source: { path: '/tmp/ref.wav' },
      content: { name: '主播', origin: 'imported', consent: { declared: false, statement: null } },
    });
    expect(calls[0]![1]).toHaveProperty('commandId');
    expect(calls[0]![1]).not.toHaveProperty('id');
  });

  it('编辑：带版本号、不带文件；勾着声明时交回原话', async () => {
    const { session, calls } = fakeSession({ 'library.put': () => ({ entry: entry(4), created: false, changed: true }) });
    const outcome = await saveVoice(session, { name: '新名字', language: 'zh-CN', transcript: '大家好', consent: true }, entry());
    expect(outcome).toMatchObject({ kind: 'saved', changed: true });
    expect(calls[0]![1]).toMatchObject({ id: 'voc_1', expectedVersion: 3, content: { name: '新名字', consent: { declared: true, statement: '我本人的声音' } } });
    expect(calls[0]![1]).not.toHaveProperty('source');
  });

  it('别处先改了：取回最新的一版交回去，不拿新版本号自动重试', async () => {
    const { session, calls } = fakeSession({
      'library.put': () => {
        throw new RpcError('conflict', '条目已经被别处修改', { code: 'LIBRARY_VERSION_CONFLICT' });
      },
      'library.get': () => ({ entry: entry(5, { name: '别处改的名字' }) }),
    });
    const outcome = await saveVoice(session, { name: '我的名字', language: '', transcript: '', consent: true }, entry());
    expect(outcome.kind).toBe('conflict');
    expect(outcome.entry.version).toBe(5);
    expect(calls.map(([m]) => m)).toEqual(['library.put', 'library.get']);
  });

  it('别的拒绝原样抛出', async () => {
    const error = new RpcError('invalid-request', 'name 超过 200 个字符', { code: 'LIBRARY_FORMAT_INVALID' });
    const { session } = fakeSession({
      'library.put': () => {
        throw error;
      },
    });
    await expect(saveVoice(session, { name: 'x', language: '', transcript: '', consent: false }, entry())).rejects.toBe(error);
  });
});

describe('删除：先删克隆，删不掉不删音色', () => {
  it('没有克隆：直接删条目', async () => {
    const { session, calls } = fakeSession({ 'library.remove': () => ({ removed: true }) });
    expect(await deleteVoice(session, summary())).toEqual({ kind: 'deleted', clones: [] });
    expect(calls).toEqual([['library.remove', { library: 'voices', id: 'voc_1' }]]);
  });

  it('有克隆（有效与过期的都删）：先逐个删远端，再删条目', async () => {
    const { session, calls } = fakeSession({
      'library.removeVoiceClone': (p) => ({ removed: true, remote: p.providerId === 'elevenlabs' ? 'deleted' : 'not-found' }),
      'library.remove': () => ({ removed: true }),
    });
    const voice = summary([
      { providerId: 'elevenlabs', state: 'valid' },
      { providerId: 'minimax', state: 'stale' },
    ]);
    expect(await deleteVoice(session, voice)).toEqual({
      kind: 'deleted',
      clones: [
        { providerId: 'elevenlabs', remote: 'deleted' },
        { providerId: 'minimax', remote: 'not-found' },
      ],
    });
    expect(calls).toEqual([
      ['library.removeVoiceClone', { id: 'voc_1', providerId: 'elevenlabs' }],
      ['library.removeVoiceClone', { id: 'voc_1', providerId: 'minimax' }],
      ['library.remove', { library: 'voices', id: 'voc_1' }],
    ]);
  });

  it('远端删不掉：停下，不删条目，带回 Provider 的说法', async () => {
    const { session, calls } = fakeSession({
      'library.removeVoiceClone': () => {
        throw new RpcError('conflict', 'ElevenLabs 上的克隆没有删掉，记录保留：网络不通', { code: 'PROVIDER_UNAVAILABLE', id: 'voc_1' });
      },
      'library.remove': () => ({ removed: true }),
    });
    const outcome = await deleteVoice(session, summary([{ providerId: 'elevenlabs', state: 'valid' }]));
    expect(outcome).toMatchObject({ kind: 'clone-failed', providerId: 'elevenlabs' });
    expect(outcome.kind === 'clone-failed' && outcome.message).toContain('记录保留');
    expect(calls.map(([m]) => m)).not.toContain('library.remove');
  });

  it('用户选了只删本机的：克隆记录只在本机清掉，再删条目', async () => {
    const { session, calls } = fakeSession({
      'library.removeVoiceClone': () => ({ removed: true, remote: 'skipped' }),
      'library.remove': () => ({ removed: true }),
    });
    await deleteVoice(session, summary([{ providerId: 'elevenlabs', state: 'valid' }]), true);
    expect(calls).toEqual([
      ['library.removeVoiceClone', { id: 'voc_1', providerId: 'elevenlabs', localOnly: true }],
      ['library.remove', { library: 'voices', id: 'voc_1' }],
    ]);
  });

  it('克隆记录已经没有了（别处刚删）：当作删掉了，接着删条目', async () => {
    const { session, calls } = fakeSession({
      'library.removeVoiceClone': () => {
        throw new RpcError('not-found', '这个音色在这个 Provider 上没有克隆');
      },
      'library.remove': () => ({ removed: true }),
    });
    expect(await deleteVoice(session, summary([{ providerId: 'elevenlabs', state: 'stale' }]))).toEqual({ kind: 'deleted', clones: [] });
    expect(calls.map(([m]) => m)).toEqual(['library.removeVoiceClone', 'library.remove']);
  });
});

describe('导入导出、克隆与试听', () => {
  it('导入音色包与导出：路径原样交给 Runtime；目标已存在的拒绝原样抛出', async () => {
    const exists = new RpcError('conflict', '目标文件已存在：/tmp/主播.bcvoice');
    const { session, calls } = fakeSession({
      'library.import': () => ({ entry: entry(1) }),
      'library.export': () => {
        throw exists;
      },
    });
    expect((await importVoicePackage(session, '/tmp/别人.bcvoice')).content.name).toBe('主播');
    expect(calls[0]![1]).toMatchObject({ path: '/tmp/别人.bcvoice' });
    await expect(exportVoice(session, summary(), '/tmp/主播.bcvoice')).rejects.toBe(exists);
    expect(calls[1]).toEqual(['library.export', { entry: { library: 'voices', id: 'voc_1' }, path: '/tmp/主播.bcvoice' }]);
  });

  it('建克隆提交一个任务（带 commandId）；删克隆默认请求远端', async () => {
    const { session, calls } = fakeSession({
      'library.createVoiceClone': () => ({ jobId: 'job_9' }),
      'library.removeVoiceClone': () => ({ removed: true, remote: 'deleted' }),
    });
    expect(await cloneVoice(session, summary(), 'elevenlabs')).toBe('job_9');
    expect(calls[0]![1]).toMatchObject({ id: 'voc_1', providerId: 'elevenlabs' });
    expect(calls[0]![1]).toHaveProperty('commandId');
    expect(await removeClone(session, summary(), 'elevenlabs')).toEqual({ removed: true, remote: 'deleted' });
    expect(calls[1]).toEqual(['library.removeVoiceClone', { id: 'voc_1', providerId: 'elevenlabs' }]);
  });

  it('建克隆被拒（没有声明、没有授权……）原样抛出', async () => {
    const error = new RpcError('forbidden', '把音频交给 ElevenLabs 需要用户授权', { code: 'GRANT_REQUIRED' });
    const { session } = fakeSession({
      'library.createVoiceClone': () => {
        throw error;
      },
    });
    await expect(cloneVoice(session, summary(), 'elevenlabs')).rejects.toBe(error);
  });

  it('试听：手里的地址没到期就接着用，快到期了重新要', async () => {
    const now = Date.parse('2026-10-03T08:00:00.000Z');
    const fresh: MediaHandle = { url: 'http://127.0.0.1/m/2', mimeType: 'audio/wav', size: 1000, fileName: 'ref.wav', expiresAt: '2026-10-03T09:00:00.000Z' };
    const { session, calls } = fakeSession({ 'library.openHandle': () => fresh });
    const cached = { ...fresh, url: 'http://127.0.0.1/m/1', expiresAt: '2026-10-03T08:10:00.000Z' };
    expect(await auditionHandle(session, summary(), cached, now)).toBe(cached);
    expect(calls).toEqual([]);
    const expiring = { ...cached, expiresAt: '2026-10-03T08:00:10.000Z' };
    expect(await auditionHandle(session, summary(), expiring, now)).toBe(fresh);
    expect(calls).toEqual([['library.openHandle', { library: 'voices', id: 'voc_1' }]]);
  });
});
