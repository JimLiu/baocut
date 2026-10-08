const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('Vite serves all prototype entries and legacy assets without rewriting classic scripts', async () => {
  const {createServer} = await import('vite');
  const server = await createServer({configFile: path.join(root, 'vite.config.mjs'), logLevel: 'silent', server: {port: 0}});
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    for (const entry of ['', 'BaoCut.html', 'BaoCutWeb.html', 'Components.html', 'baocut/BaoCut.html', 'baocut/BaoCutWeb.html']) {
      const response = await fetch(`${origin}/${entry}`);
      assert.equal(response.status, 200, entry);
      const html = await response.text();
      assert.match(html, /\/@vite\/client/, 'each entry connects to Vite for live reload');
      for (const [, src] of html.matchAll(/<script defer src="([^"]+)"/g)) {
        const url = new URL(src, `${origin}/${entry}`);
        const bundle = await fetch(url);
        assert.equal(bundle.status, 200, url.href);
        assert.match(bundle.headers.get('content-type'), /javascript/);
        assert.equal(await bundle.text(), await fs.readFile(path.join(root, src.split('?')[0]), 'utf8'), 'classic bundles retain their original bytes');
      }
    }
    assert.equal((await fetch(`${origin}/missing.html`)).status, 404, 'unknown pages do not silently show App');
  } finally {
    await server.close();
  }
});
