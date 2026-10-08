import { describe, expect, it } from 'vitest';
import { Pairing } from './pairing.ts';
import { ManualClock } from './testing/test-node.ts';

const MINUTE = 60_000;

function codeOf(pairing: Pairing): string {
  const state = pairing.state();
  if (!state || !('code' in state)) throw new Error('没有配对码');
  return state.code;
}

/** 一个肯定不是当前配对码的 6 位数。 */
function wrong(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

describe('配对', () => {
  it('配对码是 6 位数字，用一次就作废；令牌是 clientId.secret，持久的只有盐与摘要', () => {
    const clock = new ManualClock();
    const pairing = new Pairing([], { clock });
    const { code, expiresAt } = pairing.newCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(Date.parse(expiresAt)).toBe(clock.now() + 10 * MINUTE);

    const outcome = pairing.pair(code, 'client-a', 'Mac Studio');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.token).toMatch(/^client-a\.[A-Za-z0-9_-]{43}$/);
    const secret = outcome.token.split('.')[1]!;
    const stored = JSON.stringify(pairing.clients());
    expect(stored).not.toContain(secret);
    expect(pairing.clients()).toEqual([
      expect.objectContaining({
        clientId: 'client-a',
        name: 'Mac Studio',
        salt: expect.any(String),
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ]);
    expect(pairing.state()).toBeNull();
    expect(pairing.pair(code, 'client-b', 'Other')).toEqual({ ok: false, code: 'PAIRING_CODE_INVALID' });

    expect(pairing.verify(outcome.token)).toMatchObject({ clientId: 'client-a', lastSeenAt: new Date(clock.now()).toISOString() });
  });

  it('错误的令牌一律无效', () => {
    const pairing = new Pairing([]);
    const outcome = pairing.pair(pairing.newCode().code, 'client-a', 'A');
    if (!outcome.ok) throw new Error('配对失败');
    const [clientId, secret] = outcome.token.split('.') as [string, string];
    const flipped = (secret[0] === 'A' ? 'B' : 'A') + secret.slice(1);
    for (const token of [
      '',
      'client-a',
      `.${secret}`,
      `client-b.${secret}`,
      `${clientId}.${flipped}`,
      `${clientId}.${secret}x`,
      `${clientId}.${secret.slice(0, -1)}`,
      `${clientId}.${secret}=`,
      `${clientId}.${Buffer.from(secret, 'base64url').toString('base64')}`,
    ]) {
      expect(pairing.verify(token), token).toBeNull();
    }
    expect(pairing.verify(outcome.token)).not.toBeNull();
  });

  it('配对码过期后无效', () => {
    const clock = new ManualClock();
    const pairing = new Pairing([], { clock });
    const { code } = pairing.newCode();
    clock.advance(10 * MINUTE - 1);
    expect(pairing.state()).toMatchObject({ code });
    clock.advance(1);
    expect(pairing.state()).toBeNull();
    expect(pairing.pair(code, 'client-a', 'A')).toEqual({ ok: false, code: 'PAIRING_CODE_INVALID' });
  });

  it('输错 5 次锁定 10 分钟并作废配对码；锁定期满后要新的配对码', () => {
    const clock = new ManualClock();
    const pairing = new Pairing([], { clock });
    const { code } = pairing.newCode();
    for (let i = 0; i < 4; i++) expect(pairing.pair(wrong(code), 'client-a', 'A')).toEqual({ ok: false, code: 'PAIRING_CODE_INVALID' });
    expect(pairing.state()).toMatchObject({ code });
    expect(pairing.pair(wrong(code), 'client-a', 'A')).toEqual({ ok: false, code: 'PAIRING_CODE_INVALID' });
    expect(pairing.state()).toEqual({ lockedUntil: new Date(clock.now() + 10 * MINUTE).toISOString() });

    // 锁定期间连正确的码也不行，并告诉对方还要等多久。
    clock.advance(3 * MINUTE);
    expect(pairing.pair(code, 'client-a', 'A')).toEqual({ ok: false, code: 'PAIRING_LOCKED', retryAfterMs: 7 * MINUTE });

    clock.advance(7 * MINUTE);
    expect(pairing.state()).toBeNull();
    // 旧码已作废。
    expect(pairing.pair(code, 'client-a', 'A')).toEqual({ ok: false, code: 'PAIRING_CODE_INVALID' });
    const fresh = pairing.newCode();
    expect(pairing.pair(fresh.code, 'client-a', 'A').ok).toBe(true);
  });

  it('生成新的配对码解除锁定、清零计数', () => {
    const clock = new ManualClock();
    const pairing = new Pairing([], { clock });
    const { code } = pairing.newCode();
    for (let i = 0; i < 5; i++) pairing.pair(wrong(code), 'client-a', 'A');
    expect(pairing.state()).toHaveProperty('lockedUntil');
    const fresh = pairing.newCode();
    expect(pairing.state()).toMatchObject({ code: fresh.code });
    for (let i = 0; i < 4; i++) pairing.pair(wrong(fresh.code), 'client-a', 'A');
    expect(pairing.pair(fresh.code, 'client-a', 'A').ok).toBe(true);
  });

  it('同一个 clientId 重新配对换掉旧令牌；吊销后令牌无效', () => {
    const pairing = new Pairing([]);
    const first = pairing.pair(pairing.newCode().code, 'client-a', 'A');
    const second = pairing.pair(pairing.newCode().code, 'client-a', 'A2');
    if (!first.ok || !second.ok) throw new Error('配对失败');
    expect(pairing.verify(first.token)).toBeNull();
    expect(pairing.verify(second.token)).toMatchObject({ clientId: 'client-a', name: 'A2' });
    expect(pairing.clients()).toHaveLength(1);

    expect(pairing.revoke('client-a')).toBe(true);
    expect(pairing.revoke('client-a')).toBe(false);
    expect(pairing.verify(second.token)).toBeNull();
    expect(pairing.has('client-a')).toBe(false);
  });

  it('从持久状态恢复的客户端仍能用原令牌', () => {
    const pairing = new Pairing([]);
    const outcome = pairing.pair(pairing.newCode().code, 'client-a', 'A');
    if (!outcome.ok) throw new Error('配对失败');
    const restored = new Pairing(JSON.parse(JSON.stringify(pairing.clients())));
    expect(restored.verify(outcome.token)).toMatchObject({ clientId: 'client-a' });
    expect(restored.state()).toBeNull();
  });
});
