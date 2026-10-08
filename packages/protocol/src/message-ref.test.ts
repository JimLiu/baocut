import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partialTranslations, setLocale } from './i18n.ts';
import { defineCatalog, formatRef, localizeText } from './message-ref.ts';
import { RpcError } from './wire.ts';

const T = defineCatalog(
  'refTest',
  {
    busy: 'The engine is busy',
    missing: (p: { name: string }) => `Could not find ${p.name}`,
    wrapped: (p: { reason: string }) => `Export failed: ${p.reason}`,
  },
  partialTranslations({
    'zh-Hans': {
      busy: '引擎正忙',
      missing: (p: { name: string }) => `找不到 ${p.name}`,
      wrapped: (p: { reason: string }) => `导出失败：${p.reason}`,
    },
  }),
);

beforeEach(() => {
  vi.stubEnv('BAOCUT_LOCALE', undefined);
  setLocale('en');
});
afterEach(() => vi.unstubAllEnvs());

describe('message references', () => {
  it('carries the text in the current language and a reference', () => {
    const m = T.missing({ name: 'clip.mp4' });
    expect(m.text).toBe('Could not find clip.mp4');
    expect(`${m}`).toBe('Could not find clip.mp4');
    expect(JSON.parse(JSON.stringify({ key: m.key, params: m.params }))).toEqual({ key: 'refTest.missing', params: { name: 'clip.mp4' } });
  });

  it('re-renders stored references in the reader language, nested ones too', () => {
    const ref = T.wrapped({ reason: T.busy() });
    expect(ref.params).toEqual({ reason: { key: 'refTest.busy', text: 'The engine is busy' } });
    setLocale('zh-Hans');
    expect(formatRef(ref, 'x')).toBe('导出失败：引擎正忙');
    expect(localizeText('stored text', ref)).toBe('导出失败：引擎正忙');
  });

  it('falls back to the stored text for unknown keys and missing references', () => {
    expect(formatRef({ key: 'nope.never' }, 'stored text')).toBe('stored text');
    expect(localizeText('stored text', undefined)).toBe('stored text');
    // 外层认得、内层是更新的版本才有的键：内层用它生成时的文字。
    const outer = { key: 'refTest.wrapped', params: { reason: { key: 'nope.newer', text: 'Disk full' } } };
    expect(formatRef(outer, 'x')).toBe('Export failed: Disk full');
  });

  it('round-trips RpcError and localizes on the receiving side', () => {
    const payload = new RpcError('not-found', T.missing({ name: 'a.mov' })).toPayload();
    expect(payload).toEqual({ code: 'not-found', message: 'Could not find a.mov', messageRef: { key: 'refTest.missing', params: { name: 'a.mov' } } });
    setLocale('zh-Hans');
    const received = RpcError.from(payload);
    expect(received.message).toBe('找不到 a.mov');
    expect(received.toPayload().messageRef).toEqual(payload.messageRef);
    expect(new RpcError('internal', 'raw text').toPayload()).toEqual({ code: 'internal', message: 'raw text' });
  });
});
