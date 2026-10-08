import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defineMessages,
  getLocale,
  live,
  localeOfTag,
  matchLocale,
  onLocaleChange,
  partialTranslations,
  pluralForm,
  resolveLanguage,
  setLocale,
} from './i18n.ts';

const initial = getLocale();
// 测试环境用 BAOCUT_LOCALE 钉住中文（vitest.config.ts）；这里要来回切换，先撤掉它。
beforeEach(() => vi.stubEnv('BAOCUT_LOCALE', undefined));
afterEach(() => {
  setLocale(initial);
  vi.unstubAllEnvs();
});

describe('locale matching', () => {
  it('splits Chinese by script and region, and maps English tags to English', () => {
    for (const tag of ['zh', 'zh-CN', 'zh_CN.UTF-8', 'zh-SG', 'zh-Hans-HK']) expect(localeOfTag(tag)).toBe('zh-Hans');
    for (const tag of ['zh-Hant', 'zh-Hant-TW', 'zh-TW', 'zh_TW.UTF-8', 'zh-HK', 'zh-MO']) expect(localeOfTag(tag)).toBe('zh-Hant');
    for (const tag of ['en', 'en-US', 'en_GB.UTF-8']) expect(localeOfTag(tag)).toBe('en');
    for (const tag of ['ja', 'ja-JP', 'ja_JP.UTF-8']) expect(localeOfTag(tag)).toBe('ja');
    for (const tag of ['ko', 'ko-KR', 'ko_KR.UTF-8']) expect(localeOfTag(tag)).toBe('ko');
    for (const tag of ['fr', 'fr-FR', 'fr_CA.UTF-8']) expect(localeOfTag(tag)).toBe('fr');
    for (const tag of ['es', 'es-ES', 'es_MX.UTF-8']) expect(localeOfTag(tag)).toBe('es');
    for (const tag of ['pt', 'pt-BR', 'pt_PT.UTF-8']) expect(localeOfTag(tag)).toBe('pt-BR');
    for (const tag of ['nl', 'nl-NL', 'nl_BE.UTF-8']) expect(localeOfTag(tag)).toBe('nl');
    for (const tag of ['vi', 'vi-VN', 'vi_VN.UTF-8']) expect(localeOfTag(tag)).toBe('vi');
    for (const tag of ['de', 'de-DE', 'de_CH.UTF-8']) expect(localeOfTag(tag)).toBe('de');
    for (const tag of ['it', 'it-IT', 'it_CH.UTF-8']) expect(localeOfTag(tag)).toBe('it');
    for (const tag of ['tr', 'tr-TR', 'tr_TR.UTF-8']) expect(localeOfTag(tag)).toBe('tr');
    for (const tag of ['ru', 'ru-RU', 'ru_RU.UTF-8']) expect(localeOfTag(tag)).toBe('ru');
    for (const tag of ['pl', 'pl-PL', 'pl_PL.UTF-8']) expect(localeOfTag(tag)).toBe('pl');
    for (const tag of ['', 'C', 'POSIX', 'ar-EG', 'sv', null, undefined]) expect(localeOfTag(tag)).toBeNull();
  });

  it('takes the first shipped language and falls back to English', () => {
    expect(matchLocale(['ar-EG', 'zh-CN', 'en-US'])).toBe('zh-Hans');
    expect(matchLocale(['sv-SE', 'fi-FI'])).toBe('en');
    expect(matchLocale([])).toBe('en');
  });

  it('prefers an explicit choice over the system languages', () => {
    expect(resolveLanguage('en', ['zh-CN'])).toBe('en');
    expect(resolveLanguage('system', ['zh-CN'])).toBe('zh-Hans');
    expect(resolveLanguage('system', ['zh-TW'])).toBe('zh-Hant');
    expect(resolveLanguage(null, ['he-IL'])).toBe('en');
  });

  it('picks plural forms by the language rules, falling back to other', () => {
    const forms = { one: 'файл', few: 'файла', many: 'файлов', other: 'файла' };
    expect([1, 3, 5, 21, 1.5].map((n) => pluralForm('ru', n, forms))).toEqual(['файл', 'файла', 'файлов', 'файл', 'файла']);
    expect(pluralForm('ja', 1, { one: 'x', other: 'y' })).toBe('y');
    expect(pluralForm('not a tag!', 1, { one: 'x', other: 'y' })).toBe('y');
  });
});

describe('message catalogs', () => {
  const M = defineMessages(
    { title: 'Settings', count: (n: number) => (n === 1 ? '1 file' : `${n} files`), modes: { a: 'Auto' } },
    partialTranslations({ 'zh-Hans': { title: '设置', count: (n: number) => `${n} 个文件`, modes: { a: '自动' } } }),
  );

  it('reads the current language on every access', () => {
    setLocale('en');
    expect(M.title).toBe('Settings');
    expect(M.count(2)).toBe('2 files');
    setLocale('zh-Hans');
    expect(M.title).toBe('设置');
    expect(M.count(2)).toBe('2 个文件');
    expect(M.modes.a).toBe('自动');
  });

  it('falls back to English for missing test translations, including nested values', () => {
    setLocale('zh-Hant');
    expect(M.title).toBe('Settings');
    expect(M.count(2)).toBe('2 files');
    expect(M.modes.a).toBe('Auto');
  });

  it('keeps a stable reference with live()', () => {
    const modes = live(() => M.modes);
    setLocale('en');
    expect(modes.a).toBe('Auto');
    expect(Object.keys(modes)).toEqual(['a']);
    setLocale('zh-Hans');
    expect(modes.a).toBe('自动');
    expect({ ...modes }).toEqual({ a: '自动' });
  });

  it('lets BAOCUT_LOCALE win over setLocale', () => {
    setLocale('en');
    vi.stubEnv('BAOCUT_LOCALE', 'zh-CN');
    setLocale('en');
    expect(M.title).toBe('设置');
    expect(getLocale()).toBe('zh-Hans');
  });

  it('notifies listeners only when the language changes', () => {
    setLocale('en');
    const seen: string[] = [];
    const off = onLocaleChange((l) => seen.push(l));
    setLocale('en');
    setLocale('zh-Hans');
    off();
    setLocale('en');
    expect(seen).toEqual(['zh-Hans']);
  });
});
