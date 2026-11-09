import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CASK_FILE, renderHomebrewCask } from './homebrew-cask.mjs';

const releases = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'releases');
const pinned = () => JSON.parse(readFileSync(path.join(releases, 'appcast-aarch64-apple-darwin.json'), 'utf8'));

test('the checked-in cask matches the pinned macOS feed', () => {
  assert.equal(readFileSync(path.join(releases, CASK_FILE), 'utf8'), renderHomebrewCask(pinned()));
});

test('the cask links the bundled command line entry and leaves updates to the App', () => {
  const feed = pinned();
  const text = renderHomebrewCask(feed);
  assert.match(text, new RegExp(`version "${feed.version},${feed.build}"`));
  assert.match(text, new RegExp(`sha256 "${feed.app.sha256}"`));
  assert.match(text, /binary "#\{appdir\}\/BaoCut\.app\/Contents\/MacOS\/baocut-cli", target: "baocut"/);
  assert.match(text, /auto_updates true/);
  // Homebrew expands the interpolations to the feed's own URL.
  const url = /url "([^"]+)"/.exec(text)[1].replaceAll('#{version.csv.first}', feed.version).replaceAll('#{version.csv.second}', String(feed.build));
  assert.equal(url, feed.app.url);
});

test('the cask refuses a feed that points elsewhere', () => {
  const feed = pinned();
  assert.throws(() => renderHomebrewCask({ ...feed, app: { ...feed.app, url: feed.app.url.replace('jimliu/baocut', 'someone/else') } }), /asset naming/);
  assert.throws(() => renderHomebrewCask({ ...feed, target: 'x86_64-pc-windows-msvc' }), /Apple Silicon/);
  assert.throws(() => renderHomebrewCask({ ...feed, app: { ...feed.app, sha256: 'nope' } }), /checksum/);
});
