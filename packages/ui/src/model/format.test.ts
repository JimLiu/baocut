import { describe, expect, it } from 'vitest';
import { formatTenths, shortenPath } from './format.ts';

describe('shortenPath', () => {
  it('macOS 与 Linux 的主目录缩成 ~', () => {
    expect(shortenPath('/Users/me')).toBe('~');
    expect(shortenPath('/Users/me/BaoCut/models')).toBe('~/BaoCut/models');
    expect(shortenPath('/home/me/BaoCut')).toBe('~/BaoCut');
    expect(shortenPath('/Volumes/ExtremeSSD/BaoCut')).toBe('/Volumes/ExtremeSSD/BaoCut');
  });

  it('Windows 的主目录：任意盘符、不分大小写，后面的分隔符原样保留', () => {
    expect(shortenPath('C:\\Users\\me')).toBe('~');
    expect(shortenPath('C:\\Users\\me\\BaoCut\\models')).toBe('~\\BaoCut\\models');
    expect(shortenPath('c:\\users\\Me\\BaoCut')).toBe('~\\BaoCut');
    expect(shortenPath('E:/Users/me/BaoCut')).toBe('~/BaoCut');
    expect(shortenPath('D:\\Models\\baocut')).toBe('D:\\Models\\baocut');
  });
});

describe('formatTenths（原型 model-time.test.js 的 timecode）', () => {
  it('一位小数、满一小时进位', () => {
    expect(formatTenths(0)).toBe('00:00.0');
    expect(formatTenths(12.4)).toBe('00:12.4');
    expect(formatTenths(206)).toBe('03:26.0');
    expect(formatTenths(3599.9)).toBe('59:59.9');
    expect(formatTenths(3600)).toBe('1:00:00.0');
    expect(formatTenths(3723.5)).toBe('1:02:03.5');
    expect(formatTenths(-5.5)).toBe('-00:05.5');
    // 先量化再拆位：两个浮点秒相减（22.4 − 12.4）是 9.999999999999998，不能写成「00:010.0」。
    expect(formatTenths(22.4 - 12.4)).toBe('00:10.0');
    expect(formatTenths(9.999999)).toBe('00:10.0');
    // 秒进位带着分走，分进位带着小时走。
    expect(formatTenths(59.99)).toBe('01:00.0');
    expect(formatTenths(3599.99)).toBe('1:00:00.0');
  });

  it('decimals: 0 去掉小数位', () => {
    expect(formatTenths(12.4, { decimals: 0 })).toBe('00:12');
    expect(formatTenths(3723.5, { decimals: 0 })).toBe('1:02:04');
  });
});
