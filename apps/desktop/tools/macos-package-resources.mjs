/** Keep the app's languages and Chromium's regional/gender variants. */
export function macElectronLanguages(locales) {
  const aliases = { 'zh-Hans': ['zh_CN'], 'zh-Hant': ['zh_TW'], 'pt-BR': ['pt_BR'], en: ['en', 'en_GB'], es: ['es', 'es_419'] };
  const native = locales.flatMap((locale) => aliases[locale] ?? [locale]);
  return [...new Set([...locales, ...native.flatMap((locale) => [locale, ...['FEMININE', 'MASCULINE', 'NEUTER'].map((gender) => `${locale}_${gender}`)])])];
}
