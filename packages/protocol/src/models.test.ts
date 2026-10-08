import { describe, expect, it } from 'vitest';
import { MODEL_CHECK_CODES, modelCheckCode, modelCheckRepair } from './models.ts';

describe('检查没通过的原因', () => {
  it('修复帮不帮得上：文件坏了能，输出不对可能，别的都不能；认不得的代码按不能', () => {
    expect(modelCheckRepair('MODEL_FILES_DAMAGED')).toBe('yes');
    expect(modelCheckRepair('MODEL_OUTPUT_WRONG')).toBe('maybe');
    for (const code of ['APP_FILE_MISSING', 'MODEL_OUT_OF_MEMORY', 'MODEL_WORKER_FAILED', 'SOMETHING_NEW', null, undefined]) {
      expect(modelCheckRepair(code), String(code)).toBe('no');
    }
  });

  it('只认得登记过的代码', () => {
    for (const code of MODEL_CHECK_CODES) expect(modelCheckCode(code)).toBe(code);
    expect(modelCheckCode('MODEL_SELF_TEST_FAILED')).toBeNull();
    expect(modelCheckCode(undefined)).toBeNull();
    expect(modelCheckCode(42)).toBeNull();
  });
});
