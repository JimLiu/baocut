import { describe, expect, it } from 'vitest';
import { PROGRESS_STYLES } from './progress.ts';

describe('进度条样式', () => {
  it('14 款，键序是属性页目录的次序', () => {
    expect(Object.keys(PROGRESS_STYLES)).toEqual([
      'normal',
      'rounded',
      'circle',
      'donut',
      'border',
      'reverse_border',
      'rainbow_border',
      'reverse_rainbow_border',
      'strobe_border',
      'reverse_strobe_border',
      'snake',
      'snake_spin',
      'snake_rainbow',
      'snake_spin_rainbow',
    ]);
  });
});
