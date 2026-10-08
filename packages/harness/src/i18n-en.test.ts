import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentModeLabel, localizeText, refOf, RpcError, setLocale } from '@baocut/protocol';
import { HarnessRuns } from '@baocut/protocol/messages/harness';
import { DriverRegistry } from './agent-manager.ts';

/** 界面语言是英文时，Harness 写给人看的错误与会话提示是英文，并带消息引用（界面换语言后能重新生成）。 */
describe('harness 的英文文案', () => {
  beforeEach(() => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('没有注册的 Agent：英文错误带引用', () => {
    let caught: unknown;
    try {
      new DriverRegistry().get('nope');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RpcError);
    expect((caught as RpcError).message).toBe('No Agent is registered with id nope');
    expect((caught as RpcError).messageRef?.key).toBe('harnessAgents.noDriver');
  });

  it('模式切换提示：模式名作为参数，切回中文后按引用重新生成', () => {
    const text = HarnessRuns.modeChanged({ to: agentModeLabel('fullAccess'), from: agentModeLabel('auto') });
    expect(text.text).toContain('"Full access"');
    expect(text.text).not.toMatch(/[一-龥]/);
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(localizeText(text.text, refOf(text))).toMatch(/[一-龥]/);
  });
});
