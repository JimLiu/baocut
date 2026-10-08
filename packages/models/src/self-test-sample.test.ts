import { describe, expect, it } from 'vitest';
import { TRANSCRIBE_SELF_TEST, selfTestMatches } from './self-test-sample.ts';

describe('模型包自检的期望文字', () => {
  it('忽略大小写与标点；数字写成阿拉伯数字也算', () => {
    expect(selfTestMatches('Testing one, two, three. BaoCut is ready.', TRANSCRIBE_SELF_TEST)).toBe(true);
    expect(selfTestMatches('Testing 1, 2, 3, BayoCut is ready.', TRANSCRIBE_SELF_TEST)).toBe(true);
    expect(selfTestMatches('Testing one 2 three', TRANSCRIBE_SELF_TEST)).toBe(true);
    expect(selfTestMatches('Testing 1, 2, 4', TRANSCRIBE_SELF_TEST)).toBe(false);
    expect(selfTestMatches('Testing 123', TRANSCRIBE_SELF_TEST)).toBe(false);
  });
});
