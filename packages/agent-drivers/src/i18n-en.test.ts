import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import { silentLogger } from '@baocut/harness';
import { ACP_PRESETS, loginAdvice } from './acp/acp-presets.ts';
import { describeClaudeAccount } from './claude/claude-binary.ts';
import { ClaudeDriver } from './claude/claude-driver.ts';
import { describeCodexAccount } from './codex/codex-binary.ts';
import { CodexDriver } from './codex/codex-driver.ts';
import { OpenCodeDriver } from './opencode/opencode-driver.ts';
import { PiDriver } from './pi/pi-driver.ts';
import { piAccessWarning } from './pi/pi-session.ts';

/** 界面语言是英文时，Driver 写给人看的文字（探测说明、账号、安装方式、会话提示）是英文，并带上消息引用。 */
describe('agent-drivers 的英文文案', () => {
  beforeEach(() => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('通用文案', () => {
    expect(String(DriversCommon.turnInProgress())).toBe("The previous turn hasn't finished yet");
    expect(String(DriversCommon.resumeFailed({ name: 'Codex', error: '' }))).not.toMatch(/[一-龥]/);
  });

  it('账号描述', () => {
    expect(describeClaudeAccount({ authMethod: 'claude.ai', subscriptionType: 'pro' } as never)).toBe('Claude Pro subscription');
    expect(describeCodexAccount('Logged in using ChatGPT')).toBe('ChatGPT account');
    expect(describeCodexAccount('Logged in using an API key - sk-***')).toBe('OpenAI API key');
  });

  it('预设表按当前语言取：订阅说明、安装方式、登录提示', () => {
    expect(String(ACP_PRESETS.cursor.plan)).toBe('Cursor subscription');
    expect(ACP_PRESETS.cursor.install?.[0]).toMatchObject({ label: 'Official script', labelRef: { key: 'driversCommon.officialScript' } });
    expect(String(loginAdvice(ACP_PRESETS.copilot))).not.toMatch(/[一-龥]/);
    expect(String(piAccessWarning())).toContain('"Full access"');
  });

  it('describe() 的 plan 带 planRef', () => {
    const claude = new ClaudeDriver(silentLogger).describe();
    expect(claude.plan).toBe('Claude Pro or Max subscription');
    expect(claude.planRef).toMatchObject({ key: 'driversClaude.plan' });
    expect(new CodexDriver(silentLogger).describe()).toMatchObject({
      plan: 'ChatGPT Plus or Pro subscription',
      planRef: { key: 'driversCodex.plan' },
    });
  });

  it('没装时的探测说明是英文，带 detailRef', async () => {
    const locate = async () => null;
    const codex = await new CodexDriver(silentLogger, { locate }).probe();
    expect(codex.detail).toBe("Couldn't find the codex command. Install Codex CLI, or set its location in Settings.");
    expect(codex.detailRef).toMatchObject({ key: 'driversCommon.commandMissing' });
    const opencode = await new OpenCodeDriver(silentLogger, { locate }).probe();
    expect(opencode.detail).toContain('Install 2.x with npm install -g @opencode/cli');
    const pi = await new PiDriver(silentLogger, { locate }).probe();
    expect(pi.detail).not.toMatch(/[一-龥]/);
    expect(pi.planRef).toMatchObject({ key: 'driversPi.plan' });
  });
});
