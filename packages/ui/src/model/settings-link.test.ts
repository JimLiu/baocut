import { describe, expect, it, vi } from 'vitest';
import { capabilitySettingsHref, DOWNLOADER_SETTINGS_HREF, MODEL_SERVICE_CAPABILITIES, setLocale } from '@baocut/protocol';
import { settingsLink } from './settings-link.ts';
import { useShell } from '../state/shell-store.ts';

describe('回复里的设置链接', () => {
  it('工具提供的每种能力链接都能定位到对应模型设置', () => {
    const categories = ['asr', 'tts', 'image', 'llm', 'sep', 'music'];
    MODEL_SERVICE_CAPABILITIES.forEach((capability, i) => {
      expect(settingsLink(capabilitySettingsHref(capability))?.route).toEqual({ tab: 'models', category: categories[i] });
    });
    // 旧的本地 / 云端页签落到能力页（产品设计 §3.2.2）。
    expect(settingsLink('/settings/models/asr/cloud')?.route).toEqual({ tab: 'models', category: 'asr' });
    expect(settingsLink('/settings/models/sep/cloud')?.route).toEqual({ tab: 'models', category: 'sep' });
    expect(settingsLink('/settings/models/llm/local')?.route).toEqual({ tab: 'models', category: 'llm' });
    expect(settingsLink('/settings/models/tts/voices')?.route).toEqual({ tab: 'models', category: 'tts', page: 'voices' });
    expect(settingsLink('/settings/agent/')?.route).toEqual({ tab: 'settings', section: 'agent' });
    expect(settingsLink('/settings/providers')).toEqual({ route: { tab: 'settings', section: 'providers' }, trail: '设置 › API 提供方' });
    expect(settingsLink('/settings/usage')?.route).toEqual({ tab: 'settings', section: 'usage' });
    // 要登录才能下载时，错误详情里的 settingsHref 链到设置 › 视频下载
    expect(settingsLink(DOWNLOADER_SETTINGS_HREF)).toEqual({ route: { tab: 'settings', section: 'downloader' }, trail: '设置 › 视频下载' });
  });

  it.each(['/settings', '/settings/model', '/settings/models', '/settings/models/asr/voices', '/settings/models/asr/models/extra',
    '/settings/models/sep/remote', '/settings/agent/skills', '/settings/general/extra',
    '/settings/models/asr/cloud/extra', '/settings/downloader/cookies', '/settings/models/asr?tab=cloud', 'https://example.com/settings/agent', '//example.com/settings/agent',
    '/settings/unknown', 'javascript:alert(1)'])('未知地址 %s 只显示文字', (href) => {
    expect(settingsLink(href)).toBeNull();
  });

  it('提示的位置随界面语言改变', () => {
    expect(settingsLink('/settings/models/asr/cloud')?.trail).toBe('设置 › 模型 › 语音识别');
    expect(settingsLink('/settings/models/tts/voices')?.trail).toBe('设置 › 模型 › 语音合成 › 我的声音');
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    try {
      expect(settingsLink('/settings/models/asr/cloud')?.trail).toBe('Settings › Models › Speech recognition');
      expect(settingsLink('/settings/models/tts/models')?.trail).toBe('Settings › Models › Speech synthesis › Models');
    } finally {
      vi.unstubAllEnvs();
      setLocale('zh-Hans');
    }
  });

  it('打开具体设置后，后退回到原会话', () => {
    const session = { tab: 'home' as const, conversationId: 'conv_settings_link', projectId: null };
    useShell.getState().go(session);
    useShell.getState().go(settingsLink('/settings/models/asr/cloud')!.route);
    expect(useShell.getState().route).toEqual({ tab: 'models', category: 'asr' });
    useShell.getState().goBack();
    expect(useShell.getState().route).toEqual(session);
  });
});
