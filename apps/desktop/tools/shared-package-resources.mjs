import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Desktop staging only: Web, file:// preview and the native renderer share Web's
 * immutable font assets. Ordinary builds keep their current layout.
 * Validate all bytes and URL references before removing any desktop asset.
 */
export function shareFonts({ appDir, webDir, fontSource, exportWorker }) {
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
      throw new Error('export-worker embeds fonts; rebuild with --features external-fonts');
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

/**
 * Stage one binary per module for Runtime, Web and file:// consumers. Ordinary
 * builds still inline WASM. An async ESM adapter preserves their data-URL API,
 * including the synchronous editor API, without synchronous network requests.
 * Check every consumer against the source before changing the staged app.
 */
export function shareWasm({ appDir, webDir, sources }) {
  const webAssets = path.join(webDir, 'assets');
  const targets = [
    { dir: path.join(appDir, 'out/renderer/assets'), prefix: '../../../../web/assets' },
    { dir: webAssets, prefix: '.' },
  ];
  const edits = new Map(targets.flatMap(({ dir }) => readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => { const file = path.join(dir, name); return [file, readFileSync(file, 'utf8')]; })));
  const nodeWasm = path.join(appDir, 'out/main/generated/editor.wasm');
  const manifest = {};
  const outputs = new Map();
  let savedBytes = 0;
  for (const name of ['editor', 'preview']) {
    const bytes = readFileSync(sources[name]);
    if (!WebAssembly.validate(bytes)) throw new Error(`Invalid ${name} WASM source`);
    if (name === 'editor' && !readFileSync(nodeWasm).equals(bytes)) throw new Error('Runtime editor WASM differs from the source');
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const asset = `${name}-${hash}.wasm`;
    const adapterSource = wasmAdapter(asset);
    const adapterHash = createHash('sha256').update(adapterSource).digest('hex').slice(0, 12);
    const adapter = `${name}-loader-${adapterHash}.js`;
    const variable = `__baocut_shared_${name}_wasm`;
    let removedBytes = name === 'editor' ? bytes.length : 0;
    for (const { dir, prefix } of targets) {
      let references = 0;
      for (const [file, text] of edits) {
        if (path.dirname(file) !== dir) continue;
        let found = false;
        const rewritten = text.replace(/(["'])data:application\/wasm;base64,([A-Za-z0-9+/=]+)\1/g, (literal, _quote, encoded) => {
          if (!Buffer.from(encoded, 'base64').equals(bytes)) return literal;
          found = true;
          references++;
          removedBytes += Buffer.byteLength(literal);
          return variable;
        });
        if (found) {
          if (text.includes(variable)) throw new Error(`Shared WASM identifier collision: ${file}`);
          edits.set(file, `import ${variable} from ${JSON.stringify(`${prefix}/${adapter}`)};\n${rewritten}`);
        }
      }
      if (references === 0) throw new Error(`No matching ${name} WASM in ${dir}; rebuild both clients`);
    }
    manifest[`${name}.wasm`] = asset;
    outputs.set(asset, bytes);
    outputs.set(adapter, adapterSource);
    savedBytes += removedBytes - bytes.length - Buffer.byteLength(outputs.get(adapter));
  }
  for (const [file, text] of edits) writeFileSync(file, text);
  for (const [file, bytes] of outputs) writeFileSync(path.join(webAssets, file), bytes);
  writeFileSync(path.join(webAssets, 'bundled-wasm.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(nodeWasm);
  return { manifest, savedBytes };
}

function wasmAdapter(asset) {
  // file:// uses the same asynchronous XHR path as preview fonts; HTTP uses fetch.
  // Awaiting the ESM dependency keeps editorSemantics() synchronous for callers.
  return `async function loadWasm() {
const url = new URL(${JSON.stringify(asset)}, import.meta.url);
const bytes = url.protocol === 'file:'
  ? await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', url.href);
      request.responseType = 'arraybuffer';
      request.onload = () => {
        if ((request.status === 0 || request.status === 200) && request.response instanceof ArrayBuffer)
          resolve(new Uint8Array(request.response));
        else reject(new Error('Cannot read shared WASM: ' + url.href));
      };
      request.onerror = () => reject(new Error('Cannot read shared WASM: ' + url.href));
      request.send();
    })
  : await fetch(url).then(async (response) => {
      if (!response.ok) throw new Error('Cannot read shared WASM: HTTP ' + response.status);
      return new Uint8Array(await response.arrayBuffer());
    });
const chunks = [];
for (let offset = 0; offset < bytes.length; offset += 32768)
  chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
return 'data:application/wasm;base64,' + btoa(chunks.join(''));
}
export default await loadWasm();
`;
}
