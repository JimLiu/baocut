import { describe, expect, it, vi } from 'vitest';
import { capabilitySettingsHref, MODEL_SERVICE_CAPABILITIES, setLocale } from '@baocut/protocol';
import { settingsLink } from './settings-link.ts';
import { useShell } from '../state/shell-store.ts';

describe('回复里的设置链接', () => {
  it('工具提供的每种能力链接都能定位到对应模型设置', () => {
    const categories = ['asr', 'tts', 'image', 'llm', 'sep'];
    MODEL_SERVICE_CAPABILITIES.forEach((capability, i) => {
      expect(settingsLink(capabilitySettingsHref(capability))?.route).toEqual({ tab: 'models', category: categories[i] });
    });
    expect(settingsLink('/settings/models/asr/cloud')?.route).toEqual({ tab: 'models', category: 'asr', page: 'cloud' });
    expect(settingsLink('/settings/models/tts/voices')?.route).toEqual({ tab: 'models', category: 'tts', page: 'voices' });
    expect(settingsLink('/settings/agent/')?.route).toEqual({ tab: 'settings', section: 'agent' });
  });

  it.each(['/settings', '/settings/model', '/settings/models', '/settings/models/asr/voices',
    '/settings/models/sep/cloud', '/settings/models/llm/local', '/settings/agent/skills', '/settings/general/extra',
    '/settings/models/asr/cloud/extra', '/settings/models/asr?tab=cloud', 'https://example.com/settings/agent', '//example.com/settings/agent',
    '/settings/unknown', 'javascript:alert(1)'])('未知地址 %s 只显示文字', (href) => {
    expect(settingsLink(href)).toBeNull();
  });

  it('提示的位置随界面语言改变', () => {
    expect(settingsLink('/settings/models/asr/cloud')?.trail).toBe('设置 › 模型 › 语音识别 › 云端模型');
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    try {
      expect(settingsLink('/settings/models/asr/cloud')?.trail).toBe('Settings › Models › Speech recognition › Cloud models');
    } finally {
      vi.unstubAllEnvs();
      setLocale('zh-Hans');
    }
  });

  it('打开具体设置后，后退回到原会话', () => {
    const session = { tab: 'home' as const, conversationId: 'conv_settings_link', projectId: null };
    useShell.getState().go(session);
    useShell.getState().go(settingsLink('/settings/models/asr/cloud')!.route);
    expect(useShell.getState().route).toEqual({ tab: 'models', category: 'asr', page: 'cloud' });
    useShell.getState().goBack();
    expect(useShell.getState().route).toEqual(session);
  });
});
