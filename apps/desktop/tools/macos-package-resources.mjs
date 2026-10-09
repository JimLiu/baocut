import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Keep the app's languages and Chromium's regional/gender variants. */
export function macElectronLanguages(locales) {
  const aliases = { 'zh-Hans': ['zh_CN'], 'zh-Hant': ['zh_TW'], 'pt-BR': ['pt_BR'], en: ['en', 'en_GB'], es: ['es', 'es_419'] };
  const native = locales.flatMap((locale) => aliases[locale] ?? [locale]);
  return [...new Set([...locales, ...native.flatMap((locale) => [locale, ...['FEMININE', 'MASCULINE', 'NEUTER'].map((gender) => `${locale}_${gender}`)])])];
}

/**
 * Mac staging only: Web, file:// preview and the native renderer share Web's
 * immutable font assets. Ordinary builds and Windows keep their current layout.
 * Validate all bytes and URL references before removing any desktop asset.
 */
export function shareMacFonts({ appDir, webDir, fontSource, exportWorker }) {
  const assets = path.join(appDir, 'out/renderer/assets');
  const webAssets = path.join(webDir, 'assets');
  const sources = readdirSync(fontSource).filter((name) => name.endsWith('.ttf')).sort();
  if (sources.length === 0) throw new Error('No bundled fonts to share');
  const webFiles = readdirSync(webAssets);
  const manifest = {};
  const edits = new Map(readdirSync(assets).filter((name) => name.endsWith('.js')).map((name) => {
    const file = path.join(assets, name);
    return [file, readFileSync(file, 'utf8')];
  }));
  let savedBytes = 0;
  for (const name of sources) {
    const bytes = readFileSync(path.join(fontSource, name));
    const stem = name.slice(0, -4);
    const candidates = webFiles.filter((file) => file.startsWith(`${stem}-`) && /^[A-Za-z0-9_-]{8}\.ttf$/.test(file.slice(stem.length + 1)));
    if (candidates.length !== 1) throw new Error(`Expected one Web asset for ${name}`);
    const asset = candidates[0];
    if (!readFileSync(path.join(webAssets, asset)).equals(bytes) || !readFileSync(path.join(assets, asset)).equals(bytes)) {
      throw new Error(`Desktop/Web font differs from the native font: ${name}`);
    }
    // Prebuilt --bin-dir must use the same external-fonts release mode.
    if (exportWorker && name === 'NotoSansSC-Variable.ttf' && readFileSync(exportWorker).includes(bytes)) {
      throw new Error('Mac export-worker embeds fonts; rebuild with --features external-fonts');
    }
    const quoted = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reference = new RegExp(`new URL\\((["'])${quoted}\\1,\\s*import\\.meta\\.url\\)`, 'g');
    let references = 0;
    for (const [file, text] of edits) {
      edits.set(file, text.replace(reference, () => {
        references++;
        return `new URL(${JSON.stringify(`../../../../web/assets/${asset}`)}, import.meta.url)`;
      }));
    }
    if (references === 0) throw new Error(`No file:// URL reference for ${name}`);
    manifest[name] = asset;
    savedBytes += bytes.length;
  }
  for (const [file, text] of edits) writeFileSync(file, text);
  writeFileSync(path.join(webAssets, 'bundled-fonts.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const asset of Object.values(manifest)) rmSync(path.join(assets, asset));
  return { manifest, savedBytes };
}
