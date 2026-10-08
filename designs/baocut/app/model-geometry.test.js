/* model-geometry.js —— 与 `core/crates/bcut-editor-core/src/geometry_panel.rs` 的 15 条单测逐条对拍。
   数字抄自 Rust 源码；改任何一个数都要两端一起改。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-pose.js');
require('./model-template.js');
require('./model-geometry.js');
const G = global.window.BC_GEOM;
const T = global.window.BC_TPL;

const EPS = 1e-9;
const cb = (l, t, w, h) => ({l, t, w, h});
const lb = (x, y, w, h) => ({x, y, w, h});
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const P = G.pin;

test('projection_formulas_per_pin', () => {
  const b = cb(12, 4, 40, 6);
  assert.deepStrictEqual(G.project(b, P('left', 'top')), {x: 12, y: 4, w: 40, h: 6});
  const cm = G.project(b, P('center', 'middle'));
  assert.deepStrictEqual([cm.x, cm.y], [-18, -43]);
  const rb = G.project(b, P('right', 'bottom'));
  assert.deepStrictEqual([rb.x, rb.y], [48, 90]);
});

test('round_trips_on_all_nine_pins', () => {
  for (const b of [cb(0, 0, 100, 100), cb(12.3, 45.6, 40.1, 7.9), cb(-10, 90, 30, 20), cb(33.3, 66.7, 0.8, 0.6)]) {
    for (const pin of G.grid()) {
      const back = G.unproject(G.project(b, pin), pin);
      assert.ok(close(back.l, b.l, 0.1 + EPS) && close(back.t, b.t, 0.1 + EPS), JSON.stringify({pin, b, back}));
      const exact = G.unproject(G.projectRaw(b, pin), pin);
      assert.ok(close(exact.l, b.l, 1e-9) && close(exact.t, b.t, 1e-9));
    }
  }
});

test('default_pin_takes_the_nearest_line_and_breaks_ties_left_top', () => {
  assert.deepStrictEqual(G.defaultPin(cb(2, 4, 14, 8)), P('left', 'top'));
  assert.deepStrictEqual(G.defaultPin(cb(0, 98, 100, 2)), P('left', 'bottom'));
  assert.deepStrictEqual(G.defaultPin(cb(40, 45, 20, 10)), P('center', 'middle'));
  assert.deepStrictEqual(G.defaultPin(cb(80, 10, 18, 5)), P('right', 'top'));
  assert.strictEqual(G.defaultPin(cb(0, 0, 100, 100)).x, 'left');
});

test('snapping_bottom_or_right_never_leaves_the_canvas', () => {
  const b0 = lb(0, 91, 100, 0.8);
  const pin = P('left', 'bottom');
  const q = G.quick(pin, G.project(G.layerBox(b0), pin), 'snapToPin');
  const b = G.layerApply(b0, q.pin, q.values, false);
  assert.deepStrictEqual(b, lb(0, 99.2, 100, 0.8));
  assert.ok(b.y + b.h <= 100 + EPS);
  for (const pin of G.grid()) {
    for (const b0 of [lb(3, 7, 37.3, 12.9), lb(60, 90, 40, 10), lb(0, 0, 4, 0.6)]) {
      const q = G.quick(pin, G.project(G.layerBox(b0), pin), 'snapToPin');
      const b = G.layerApply(b0, q.pin, q.values, false);
      assert.ok(b.x >= 0 && b.y >= 0, JSON.stringify({pin, b}));
      assert.ok(b.x + b.w <= 100.05 && b.y + b.h <= 100.05);
      assert.deepStrictEqual([b.w, b.h], [G.r1(b0.w), G.r1(b0.h)]);
      const again = G.project(G.layerBox(b), q.pin);
      assert.ok(Math.abs(again.x) <= 0.1 && Math.abs(again.y) <= 0.1, JSON.stringify({pin, again}));
    }
  }
});

test('quick_actions_replace_the_four_chips', () => {
  const b0 = lb(10, 10, 30, 8);
  const pin = G.defaultPin(G.layerBox(b0));
  let p = P(pin.x, 'bottom');
  let q = G.quick(p, G.project(G.layerBox(b0), p), 'snapToPin');
  assert.deepStrictEqual(G.layerApply(b0, q.pin, q.values, false), lb(0, 92, 30, 8));
  const t = G.project(G.layerBox(b0), q.pin);
  t.y = 0;
  assert.deepStrictEqual(G.layerApply(b0, q.pin, t, false), lb(10, 92, 30, 8));
  p = P('center', 'middle');
  q = G.quick(p, G.project(G.layerBox(b0), p), 'snapToPin');
  assert.deepStrictEqual(G.layerApply(b0, q.pin, q.values, false), lb(35, 46, 30, 8));
  q = G.quick(pin, G.project(G.layerBox(b0), pin), 'fullWidth');
  assert.strictEqual(q.pin.x, 'left');
  assert.deepStrictEqual(G.layerApply(b0, q.pin, q.values, false), lb(0, 10, 100, 8));
  q = G.quick(pin, G.project(G.layerBox(b0), pin), 'fullHeight');
  assert.strictEqual(q.pin.y, 'top');
  assert.deepStrictEqual(G.layerApply(b0, q.pin, q.values, false), lb(10, 0, 30, 100));
});

test('layer_resize_keeps_the_pinned_edge_and_lock_ratio', () => {
  const b0 = lb(60, 80, 30, 10);
  const pin = P('right', 'bottom');
  const t = G.project(G.layerBox(b0), pin);
  assert.deepStrictEqual([t.x, t.y], [10, 10]);
  t.w = 40;
  assert.deepStrictEqual(G.layerApply(b0, pin, t, false), lb(50, 80, 40, 10));
  const locked = G.layerApply(b0, pin, t, true);
  assert.ok(close(locked.h, 13.3, 1e-9) && close(locked.y + locked.h, 90, 0.051), JSON.stringify(locked));
  t.w = 500;
  assert.deepStrictEqual(G.layerApply(b0, pin, t, false), lb(0, 80, 100, 10));
  const odd = lb(12.34, 56.78, 20.05, 7.77);
  const cm = P('center', 'middle');
  assert.deepStrictEqual(G.layerApply(odd, cm, G.project(G.layerBox(odd), cm), false), T.clampBox(odd));
});

test('layer_drag_snaps_to_canvas_and_other_layers', () => {
  const frame = {w: 1000, h: 500};
  let r = G.snapLayerMove(lb(69.6, 20, 30, 10), [], frame, true);
  assert.strictEqual(r.box.x, 70);
  assert.ok(r.guides.some((g) => g.v && g.p === 1000));
  r = G.snapLayerMove(lb(69.6, 20, 30, 10), [], frame, false);
  assert.strictEqual(r.box.x, 69.6);
  assert.strictEqual(r.guides.length, 0);
  const other = lb(0, 0, 20, 30);
  r = G.snapLayerMove(lb(40, 30.8, 10, 10), [other], frame, true);
  assert.strictEqual(r.box.y, 30);
  assert.ok(G.layerGuides(r.box, [other], frame).length > 0);
});

const sticker = (x, y, wPx, hPx) => ({x, y, boxW: wPx, boxH: hPx, frameW: 1920, frameH: 1080,
  placeW: wPx / 1920 * 100, scaleY: 1, valign: 'middle', heightTracksWidth: true});

test('element_box_is_center_based_and_valign_shifts_the_top', () => {
  const g = sticker(50, 50, 384, 216);
  assert.deepStrictEqual(G.elementBox(g), cb(40, 40, 20, 20));
  assert.strictEqual(G.elementBox(Object.assign({}, g, {valign: 'top'})).t, 50);
  assert.strictEqual(G.elementBox(Object.assign({}, g, {valign: 'bottom'})).t, 30);
});

test('element_position_edits_move_only_their_axis', () => {
  const g = sticker(50.3, 47.7, 384, 216);
  const pin = P('right', 'bottom');
  const t = G.project(G.elementBox(g), pin);
  t.x = 5;
  let out = G.elementApply(g, pin, t, false);
  assert.strictEqual(out.x, 85);
  assert.strictEqual(out.y, 47.7, '没改的轴原值不动');
  assert.deepStrictEqual([out.w, out.scaleY], [g.placeW, 1]);
  const q = G.quick(pin, G.project(G.elementBox(g), pin), 'snapToPin');
  out = G.elementApply(g, q.pin, q.values, false);
  assert.deepStrictEqual([out.x, out.y], [90, 90]);
  out = G.elementApply(g, q.pin, q.values, false, {x: [3, 97], y: [4, 85]});
  assert.strictEqual(out.y, 85);
});

test('element_width_edit_keeps_the_pinned_edge_and_height_follows', () => {
  const g = sticker(50, 50, 384, 216);
  const pin = P('left', 'bottom');
  const t = G.project(G.elementBox(g), pin);
  t.w = 30;
  const out = G.elementApply(g, pin, t, false);
  assert.strictEqual(out.w, 30);
  assert.strictEqual(out.scaleY, 1);
  assert.strictEqual(out.x, 55);
  assert.strictEqual(out.y, 45);
});

test('element_height_edit_writes_scale_y_only', () => {
  const g = sticker(50, 50, 384, 216);
  const pin = P('center', 'top');
  let t = G.project(G.elementBox(g), pin);
  t.h = 30;
  let out = G.elementApply(g, pin, t, false);
  assert.deepStrictEqual([out.w, out.scaleY, out.x], [g.placeW, 1.5, 50]);
  assert.strictEqual(out.y, 55);
  out = G.elementApply(g, pin, t, true);
  assert.ok(close(out.w, 30, 0.05) && out.scaleY === 1, JSON.stringify(out));
  const fixed = Object.assign({}, g, {heightTracksWidth: false});
  t = G.project(G.elementBox(fixed), pin);
  t.w = 40;
  out = G.elementApply(fixed, pin, t, true);
  assert.deepStrictEqual([out.w, out.scaleY], [40, 2]);
  assert.strictEqual(G.elementApply(fixed, pin, t, false).scaleY, 1);
});

test('square_kinds_scale_their_short_edge_basis', () => {
  const g = Object.assign(sticker(50, 50, 324, 324), {placeW: 30});
  const pin = P('left', 'top');
  const t = G.project(G.elementBox(g), pin);
  assert.strictEqual(t.w, 16.9);
  t.w = 33.8;
  assert.ok(close(G.elementApply(g, pin, t, false).w, 60, 0.11));
});

test('text_vertical_align_is_the_vertical_pin', () => {
  assert.strictEqual(G.pinYFromVerticalAlign(null), 'middle');
  assert.strictEqual(G.pinYFromVerticalAlign(undefined), 'middle');
  assert.strictEqual(G.pinYFromVerticalAlign('center'), 'middle');
  assert.strictEqual(G.pinYFromVerticalAlign('top'), 'top');
  assert.strictEqual(G.pinYFromVerticalAlign('bottom'), 'bottom');
  for (const p of G.PIN_Y) assert.strictEqual(G.pinYFromVerticalAlign(G.verticalAlignFor(p)), p);
  const text = Object.assign(sticker(50, 80, 768, 108), {valign: 'bottom', heightTracksWidth: false});
  const pin = P('center', 'bottom');
  const shown = G.project(G.elementBox(text), pin);
  assert.strictEqual(shown.y, 20);
  const q = G.quick(pin, shown, 'snapToPin');
  assert.strictEqual(G.elementApply(text, q.pin, q.values, false).y, 100);
  assert.strictEqual(G.retargetVerticalAlign(text, 'top'), 70);
  assert.strictEqual(G.retargetVerticalAlign(text, 'middle'), 75);
  const t = Object.assign({}, shown, {w: 50});
  const out = G.elementApply(text, pin, t, false);
  assert.deepStrictEqual([out.y, out.scaleY], [80, 1]);
});

test('element_width_has_a_floor', () => {
  const g = sticker(50, 50, 384, 216);
  const pin = P('left', 'top');
  const t = G.project(G.elementBox(g), pin);
  t.w = 0.1;
  assert.strictEqual(G.elementApply(g, pin, t, false).w, 2);
});

test('pins_serialize_as_lowercase_words', () => {
  assert.strictEqual(JSON.stringify(P('right', 'middle')), '{"x":"right","y":"middle"}');
  assert.ok(G.PIN_X.includes('center') && G.PIN_Y.includes('bottom'));
  assert.deepStrictEqual(G.grid()[5], P('right', 'middle'));
});

/* 原型侧补充：负半数按 Rust 远离零取整（-0.05 → -0.1，不是 -0） */
test('r1_rounds_half_away_from_zero_like_rust', () => {
  assert.strictEqual(G.r1(-18.25), -18.3);
  assert.strictEqual(G.r1(0.25), 0.3);
  assert.ok(Object.is(G.r1(-0.04), 0));
});
