import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { APPROVAL_CARD_COPY, CLIENTS_COPY, COMMON_COPY, MCP_COPY, MODEL_API_COPY, WEB_COPY } from './services-copy.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('服务页文案', () => {
  it('英文界面读英文', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(MCP_COPY.title).toBe('MCP service');
    expect(WEB_COPY.revoke).toBe('Sign out');
    expect(COMMON_COPY.section.requests).toBe('Recent requests');
    expect(MODEL_API_COPY.levels.read).toBe('Can only list models (GET /v1/models). Generation requests are rejected.');
    expect(COMMON_COPY.portSaved(8080)).toBe('Port changed to 8080');
    expect(CLIENTS_COPY.meta('2 days ago', null)).toBe('Created 2 days ago · Never used');
    expect(APPROVAL_CARD_COPY.video('Launch')).toBe('Video "Launch"');
    expect(COMMON_COPY.lightsLabel(['MCP service: on', 'Web service: off'])).toBe('MCP service: on, Web service: off');
  });

  it('简体中文译文照旧', () => {
    expect(MCP_COPY.title).toBe('MCP 服务');
    expect(APPROVAL_CARD_COPY.video('发布会')).toBe('视频「发布会」');
    expect(COMMON_COPY.lightsLabel(['甲', '乙'])).toBe('甲，乙');
  });
});
