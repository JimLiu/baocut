import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentModeLabel, AGENT_MODE_LABELS } from './access.ts';
import { grantDataKindLabel } from './grants.ts';
import { setLocale } from './i18n.ts';
import { compileJsonSchema, JsonSchemaError } from './json-schema.ts';
import { methodParamSchemas } from './schemas.ts';
import { SETTING_DESCRIPTIONS, settingDescription } from './settings.ts';
import { templatePathProblem } from './template.ts';

/** 界面语言是英文时，协议层给人看的文字（设置说明、模式名、校验错误）按英文生成；切回中文后照旧。 */
describe('protocol 的英文文案', () => {
  beforeEach(() => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('设置说明在读取时按当前语言', () => {
    expect(settingDescription('updates.autoCheck')).toBe('Check for app updates automatically');
    expect(SETTING_DESCRIPTIONS['ui.language']).not.toMatch(/[一-龥]/);
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(settingDescription('updates.autoCheck')).toBe('自动检查应用更新');
  });

  it('模式名与数据种类带消息引用', () => {
    const label = agentModeLabel('fullAccess');
    expect(label.text).toBe('Full access');
    expect(label.key).toMatch(/^protocolLabels\./);
    expect(AGENT_MODE_LABELS.fullAccess).toBe('Full access');
    expect(grantDataKindLabel('transcript').text).not.toMatch(/[一-龥]/);
  });

  it('校验错误按当前语言', () => {
    expect(templatePathProblem('')).toBe('Path is empty');
    let caught: unknown;
    try {
      compileJsonSchema(1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JsonSchemaError);
    expect((caught as JsonSchemaError).message).toBe('schema must be an object');
    expect((caught as JsonSchemaError).messageRef?.key).toBe('protocolValidation.jsonSchemaNotObject');

    const parsed = methodParamSchemas['models.synthesizeSpeech'].safeParse({ text: '  ' });
    expect(parsed.success).toBe(false);
    const messages = parsed.error!.issues.map((i) => i.message).join('\n');
    expect(messages).toContain("Text can't be empty");
  });
});
