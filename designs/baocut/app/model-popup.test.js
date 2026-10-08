const {test} = require('node:test');
const assert = require('node:assert/strict');
const {popupPlacement: place} = require('./model-popup.js');

test('popup anchors to a floating toolbar button, not the inspector edge', () => {
  assert.deepEqual(place({left: 190, right: 216, top: 375, bottom: 399}, 234, 360,
    {width: 1000, height: 920}), {left: 190, top: 405});
});
test('popup flips and clamps all four window edges and oversized content', () => {
  assert.deepEqual(place({left: 920, right: 946, top: 780, bottom: 804}, 270, 360,
    {width: 1000, height: 920}), {left: 722, top: 414});
  assert.deepEqual(place({left: -20, right: 6, top: 0, bottom: 24}, 270, 360,
    {width: 1000, height: 920}, 'right', 'up'), {left: 8, top: 30});
  assert.deepEqual(place({left: 100, right: 126, top: 130, bottom: 154}, 600, 500,
    {width: 320, height: 240}), {left: 8, top: 8});
});

test('nested menus open beside their row and flip left at the right edge', () => {
  assert.deepEqual(place({left: 100, right: 316, top: 500, bottom: 532}, 200, 150,
    {width: 1000, height: 700}, 'left', 'right'), {left: 322, top: 500});
  assert.deepEqual(place({left: 784, right: 992, top: 650, bottom: 682}, 200, 150,
    {width: 1000, height: 700}, 'left', 'right'), {left: 578, top: 542});
});
