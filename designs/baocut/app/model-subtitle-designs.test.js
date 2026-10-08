const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.window = {};
require('./model-subtitle-designs.js');
require('./model-substyle.js');
const D = window.BC_SD, S = window.BC_SUB;
test('generated families merge old appearances and retain nine distinct motion recipes', () => {
  const data = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../../../crates/subtitle-render/assets/subtitle-designs.json')));
  assert.equal(data.length, 9);
  for (const design of data) {
    const look = D.LOOKS['studio-' + design.id];
    assert.deepEqual(look.nativeStyle, design.style);
    for (const key of ['id', 'name', 'lang', 'role']) assert.ok(!(key in look), 'look must not overwrite track ' + key);
  }
  assert.equal(D.representative('hustle'), 'classic');
  assert.equal(D.representative('boba'), 'lime');
  assert.equal(D.representative('capri'), 'simple');
  assert.equal(D.representative('caption-daoyazi'), 'caption-daoyazi');
});
test('gallery consolidation only filters entries, without mutating legacy records', () => {
  const catalog = [{id:'v-classic',look:'classic'},{id:'v-hustle',look:'hustle'},{id:'vt-hustle',look:'hustle'}, ...D.cards('orig')];
  const before=JSON.stringify(catalog), result=S.screenCatalog(catalog);
  assert.equal(result.length,10);assert.equal(JSON.stringify(catalog),before);
  assert.ok(!result.some(v=>v.id==='v-hustle'));
});
