import { describe, expect, it } from 'vitest';
import { methodParamSchemas, settingValueSchemas, settingsPatchSchema } from './schemas.ts';
import { cookieBrowsersSetting, resolveCookieBrowsers } from './external-tools.ts';
import { SETTING_DEFAULTS, SETTING_DESCRIPTIONS, SETTING_KEYS, defaultSettingsSnapshot, isSettingKey } from './settings.ts';

describe('偏好设置注册表', () => {
  it('每个键都有 schema、默认值与说明，默认值合自己的 schema', () => {
    expect(Object.keys(settingValueSchemas).sort()).toEqual([...SETTING_KEYS].sort());
    expect(Object.keys(SETTING_DEFAULTS).sort()).toEqual([...SETTING_KEYS].sort());
    expect(Object.keys(SETTING_DESCRIPTIONS).sort()).toEqual([...SETTING_KEYS].sort());
    for (const key of SETTING_KEYS) {
      expect(settingValueSchemas[key].safeParse(SETTING_DEFAULTS[key]).success, key).toBe(true);
      expect(SETTING_DESCRIPTIONS[key].length, key).toBeGreaterThan(0);
    }
  });

  it('键是点分的小写名，不含凭据类的键', () => {
    for (const key of SETTING_KEYS) {
      expect(key).toMatch(/^[a-z]+(?:\.[a-z][A-Za-z]*)+$/);
      expect(key).not.toMatch(/key|token|secret|password|credential|apikey/i);
    }
    expect(isSettingKey('offline.strict')).toBe(true);
    expect(isSettingKey('models.apiKey')).toBe(false);
  });

  it('补丁：未知的键与不合 schema 的值被拒绝，null 表示恢复默认', () => {
    expect(settingsPatchSchema.safeParse({ 'offline.strict': true, 'agent.defaultDriver': null }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ 'openai.apiKey': 'sk-x' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ 'agent.defaultAccessMode': 'everything' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ 'captions.maxLineLength': { cjk: 18 } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ 'captions.maxLineLength': { cjk: 18, other: 40, extra: 1 } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ 'downloads.directory': 'relative/dir' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ 'downloads.directory': '/Users/me/Downloads' }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ 'downloads.directory': 'D:\\Downloads' }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ 'updates.autoCheck': 'yes' }).success).toBe(false);
  });

  it('网站登录：默认所有浏览器；列表去重、只收认得的浏览器；按检测结果展开，全勾上存回 all', () => {
    const schema = settingValueSchemas['downloads.cookieBrowsers'];
    expect(SETTING_DEFAULTS['downloads.cookieBrowsers']).toBe('all');
    expect(schema.parse([])).toEqual([]);
    expect(schema.parse(['firefox', 'chrome', 'firefox'])).toEqual(['firefox', 'chrome']);
    expect(schema.safeParse(['netscape']).success).toBe(false);
    expect(schema.safeParse('none').success).toBe(false);
    const detected = [{ id: 'safari' as const }, { id: 'chrome' as const }, { id: 'firefox' as const }];
    expect(resolveCookieBrowsers('all', detected)).toEqual(['safari', 'chrome', 'firefox']);
    // 列表按检测到的顺序试；检测不到的不试
    expect(resolveCookieBrowsers(['firefox', 'edge', 'safari'], detected)).toEqual(['safari', 'firefox']);
    expect(resolveCookieBrowsers([], detected)).toEqual([]);
    expect(resolveCookieBrowsers('all', [])).toEqual([]);
    expect(cookieBrowsersSetting(['firefox', 'chrome', 'safari'], detected)).toBe('all');
    expect(cookieBrowsersSetting(['firefox', 'safari'], detected)).toEqual(['safari', 'firefox']);
    expect(cookieBrowsersSetting([], detected)).toEqual([]);
    expect(cookieBrowsersSetting([], [])).toEqual([]);
  });

  it('下载镜像：基址规则同下载来源，去掉结尾的 /，基址重复（不分大小写）只留第一个', () => {
    for (const key of ['models.downloadMirrors', 'tools.downloadMirrors'] as const) {
      const schema = settingValueSchemas[key];
      expect(SETTING_DEFAULTS[key]).toEqual([]);
      expect(
        schema.parse([
          { name: ' 公司镜像 ', base: 'http://10.0.0.2:8080/hf/' },
          { name: '', base: 'https://hf-mirror.com' },
          { name: 'again', base: 'HTTP://10.0.0.2:8080/hf' },
        ]),
      ).toEqual([
        { name: '公司镜像', base: 'http://10.0.0.2:8080/hf' },
        { name: '', base: 'https://hf-mirror.com' },
      ]);
      expect(schema.safeParse([{ name: '', base: 'hf-mirror.com' }]).success).toBe(false);
      expect(schema.safeParse([{ name: '', base: 'https://u:p@mirror.example' }]).success).toBe(false);
      expect(schema.safeParse([{ name: 'x'.repeat(41), base: 'https://mirror.example' }]).success).toBe(false);
      expect(schema.safeParse([{ base: 'https://mirror.example' }]).success).toBe(false);
      expect(schema.safeParse(Array.from({ length: 21 }, (_, i) => ({ name: '', base: `https://m${i}.example` }))).success).toBe(false);
    }
  });

  it('访问模式：新值原样接受，旧值换成新值', () => {
    const schema = settingValueSchemas['agent.defaultAccessMode'];
    for (const mode of ['ask', 'autoAcceptEdits', 'auto', 'fullAccess', 'plan']) expect(schema.parse(mode)).toBe(mode);
    expect(schema.parse('controlled')).toBe('ask');
    expect(schema.parse('authorized')).toBe('fullAccess');
    expect(settingsPatchSchema.parse({ 'agent.defaultAccessMode': 'authorized' })).toEqual({ 'agent.defaultAccessMode': 'fullAccess' });
    expect(SETTING_DEFAULTS['agent.defaultAccessMode']).toBe('auto');
  });

  it('方法参数：settings.get 只接受注册过的键', () => {
    expect(methodParamSchemas['settings.get'].safeParse({}).success).toBe(true);
    expect(methodParamSchemas['settings.get'].safeParse({ keys: ['offline.strict'] }).success).toBe(true);
    expect(methodParamSchemas['settings.get'].safeParse({ keys: ['nope'] }).success).toBe(false);
    expect(methodParamSchemas['settings.set'].safeParse({ values: { nope: 1 } }).success).toBe(false);
    expect(methodParamSchemas.subscribe.safeParse({ topic: 'settings' }).success).toBe(true);
  });

  it('没有设置存储时按默认值冻结', () => {
    expect(defaultSettingsSnapshot(['agent.defaultAccessMode', 'agent.defaultDriver'])).toEqual({
      values: { 'agent.defaultAccessMode': 'auto', 'agent.defaultDriver': null },
      sources: { 'agent.defaultAccessMode': 'default', 'agent.defaultDriver': 'default' },
    });
  });
});
