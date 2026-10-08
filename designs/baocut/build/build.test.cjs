const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'generated/manifest.json')));
test('committed output reproduces from current sources and pinned dependencies',()=>{
  execFileSync(process.execPath,[path.join(__dirname,'build.mjs'),'--check'],{stdio:'pipe'});
});
test('all entries load local production scripts, correct surface modules and content hashes',()=>{
  for(const [key,entry] of Object.entries(manifest)) {
    const html=fs.readFileSync(path.join(root,entry.file),'utf8');
    assert.doesNotMatch(html,/text\/babel|unpkg\.com|react\.development/);
    const scripts=[...html.matchAll(/<script defer src="([^"]+)"/g)].map(m=>m[1]);
    assert.ok(scripts.length<=4);
    for(const url of [...scripts,entry.css]) {
      const [file,query]=url.split('?v=');
      const bytes=fs.readFileSync(path.join(root,file));
      assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0,12),query);
    }
    const source=fs.readFileSync(path.join(root,'build/entries',key+'.html'),'utf8');
    const declared=[...source.matchAll(/<script[^>]*src="(app\/[^"?]+)[^"]*"/g)].map(m=>m[1]);
    assert.deepEqual(entry.sources,declared,'the emitted manifest covers every source in order');
    assert.ok(entry.sources.indexOf('app/ui-spectrum.jsx')<entry.sources.indexOf('app/ui.jsx'));
    assert.doesNotMatch(html,/<link rel="stylesheet" href="https:/,'fonts must not block first render');
  }
  assert.ok(!manifest.web.sources.some(s=>/^app\/(page-|settings-|apprail)/.test(s)));
});
