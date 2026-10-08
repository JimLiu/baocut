import { describe, expect, it } from 'vitest';
import { SETTING_DEFAULTS, SETTING_KEYS, type SettingsSnapshot } from '@baocut/protocol';
import { formatSettingLine, formatSettingValue, formatSettings, parseSettingValue, parseSettingsArgs } from './settings-output.ts';

const view = (patch: Partial<SettingsSnapshot['settings']> = {}): SettingsSnapshot => ({
  settings: { ...SETTING_DEFAULTS, ...patch },
  defaults: { ...SETTING_DEFAULTS },
});

describe('baocut settings 的参数', () => {
  it('list、get、set、reset', () => {
    expect(parseSettingsArgs([])).toEqual({ kind: 'list' });
    expect(parseSettingsArgs(['get', 'offline.strict'])).toEqual({ kind: 'get', key: 'offline.strict' });
    expect(parseSettingsArgs(['set', 'offline.strict', 'true'])).toEqual({ kind: 'set', key: 'offline.strict', value: true });
    expect(parseSettingsArgs(['set', 'agent.defaultAccessMode', 'authorized'])).toEqual({
      kind: 'set',
      key: 'agent.defaultAccessMode',
      value: 'authorized',
    });
    expect(parseSettingsArgs(['reset', 'captions.maxLineLength'])).toEqual({ kind: 'reset', key: 'captions.maxLineLength' });
  });

  it('不认识的键与缺参数给出用法', () => {
    expect(() => parseSettingsArgs(['get', 'openai.apiKey'])).toThrow(/不认识的设置项：openai\.apiKey/);
    expect(() => parseSettingsArgs(['set', 'offline.strict'])).toThrow(/用法/);
    expect(() => parseSettingsArgs(['set', 'offline.strict', 'true', 'extra'])).toThrow(/用法/);
    expect(() => parseSettingsArgs(['get'])).toThrow(/用法/);
    expect(() => parseSettingsArgs(['delete', 'offline.strict'])).toThrow(/用法/);
  });

  it('值按 JSON 解析，解析不了就当作字符串', () => {
    expect(parseSettingValue('20')).toBe(20);
    expect(parseSettingValue('false')).toBe(false);
    expect(parseSettingValue('null')).toBeNull();
    expect(parseSettingValue('{"cjk":18,"other":40}')).toEqual({ cjk: 18, other: 40 });
    expect(parseSettingValue('/Users/me/Downloads')).toBe('/Users/me/Downloads');
    expect(parseSettingValue('"quoted"')).toBe('quoted');
  });
});

describe('baocut settings 的输出', () => {
  it('列出全部键：当前值、是否默认与说明', () => {
    const lines = formatSettings(view({ 'offline.strict': true, 'captions.maxLineLength': { other: 40, cjk: 18 } }));
    expect(lines).toHaveLength(SETTING_KEYS.length * 2);
    const width = Math.max(...SETTING_KEYS.map((k) => k.length));
    expect(lines[0]).toBe(`${'agent.defaultDriver'.padEnd(width)}  null  默认`);
    expect(lines[1]).toMatch(/^ {2}新会话用的智能体引擎/);
    expect(lines).toContain(`${'offline.strict'.padEnd(width)}  true  已修改（默认 false）`);
    expect(lines).toContain(`${'captions.maxLineLength'.padEnd(width)}  {"cjk":18,"other":40}  已修改（默认 {"cjk":16,"other":42}）`);
    expect(lines).toContain(`${'agent.defaultAccessMode'.padEnd(width)}  "auto"  默认`);
  });

  it('单个键的一行与取值', () => {
    expect(formatSettingLine(view({ 'agent.defaultAccessMode': 'fullAccess' }), 'agent.defaultAccessMode')).toBe(
      'agent.defaultAccessMode  "fullAccess"  已修改（默认 "auto"）',
    );
    expect(formatSettingLine(view(), 'updates.autoCheck')).toBe('updates.autoCheck  true  默认');
    expect(formatSettingValue({ other: 1, cjk: 2 })).toBe('{"cjk":2,"other":1}');
  });
});
