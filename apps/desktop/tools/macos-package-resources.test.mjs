import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOCALES } from '../../../packages/protocol/src/i18n.ts';
import { macElectronLanguages } from './macos-package-resources.mjs';

test('Mac languages preserve every app locale, Chromium aliases, regions and gender variants', () => {
  const languages = macElectronLanguages(LOCALES);
  for (const locale of LOCALES) assert.ok(languages.includes(locale));
  for (const locale of ['zh_CN', 'zh_TW', 'pt_BR', 'en', 'en_GB', 'es_419', 'ja']) {
    for (const suffix of ['', '_FEMININE', '_MASCULINE', '_NEUTER']) assert.ok(languages.includes(`${locale}${suffix}`));
  }
  assert.ok(!languages.includes('ar'));
});
