/* node --test designs/baocut/app/model-wordanim.test.js
   这一份钉的是**词这一侧**：怎么切词、播放头落在第几个词上、块底色配什么墨色。
   动效那一摊第 66 轮搬去了 model-subanim.test.js（17 条关键帧数据）。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-wordanim.js');
require('./model-shape-paths.js');   // model-elements.js 的形状几何（生成物）
require('./model-elements.js');            // data.js 建演示元素时要用
require('./model-textpresets.js');         // data.js 的文字目录转口自它
require('./model-substyle.js');
require('./model-subanim.js');       // data.js 的动效目录派生自它
require('./model-subpresets.js');       // data.js 的字幕样式目录转口自它
require('./model-motioncaption.js');   // data.js 的动效字幕那一区派生自它
require('./model-template.js');
require('./model-cut.js');   // data.js 的剪口建议派生自它（第 192 轮）
require('./model-defaultsub.js'); // data.js 的画廊第一区（默认样式那张卡）
require('./data.js');
const W = window.BC_WA;
const D = window.BC_DATA;

/* ---------- 分词 ---------- */

test('拉丁按空格切，标点跟着前一个词', () => {
  assert.deepEqual(W.split('Words are the truth.'), ['Words', 'are', 'the', 'truth.']);
});

test('CJK 按两字一词切，全角标点跟着前一个词', () => {
  assert.deepEqual(W.split('词是真相，句子是投影。'), ['词是', '真相，', '句子', '是投', '影。']);
});

test('韩文按空格切、词间补空格，挨着汉字或全角标点不补', () => {
  assert.deepEqual(W.split('오늘은 날씨가 좋아요.'), ['오늘은', '날씨가', '좋아요.']);
  assert.equal(W.joint('오늘은', '날씨가'), ' ');
  assert.equal(W.joint('서울', 'Seoul'), ' ');
  assert.equal(W.joint('서울', '東京'), '');
  assert.equal(W.joint('좋아요，', '그래요'), '');
});

test('切法确定——同一句切两次结果一样', () => {
  const s = '大家好，我是苏黎，负责 rendering 这一块。';
  assert.deepEqual(W.split(s), W.split(s));
});

test('空串与空白切出空数组', () => {
  assert.deepEqual(W.split(''), []);
  assert.deepEqual(W.split('   '), []);
  assert.deepEqual(W.split(null), []);
});

test('CJK 之间不补空格，拉丁之间补', () => {
  assert.equal(W.joint('词是', '真相'), '');
  assert.equal(W.joint('are', 'the'), ' ');
  assert.equal(W.joint('cue', '都是'), '');       // 混排按 CJK 一侧算
});

/* ---------- 播放头落在第几个词 ---------- */

test('cue 之前是 -1，念完是 n', () => {
  assert.equal(W.at(1, 2, 6, 4), -1);
  assert.equal(W.at(9, 2, 6, 4), 4);
});

test('词位随播放头单调不减', () => {
  let prev = -2;
  for (let t = 1.5; t <= 6.5; t += 0.1) {
    const i = W.at(+t.toFixed(2), 2, 6, 4);
    assert.ok(i >= prev, 't=' + t.toFixed(2) + ' 回退了');
    prev = i;
  }
});

test('最后一个词不会越界', () => {
  assert.equal(W.at(5.9999, 2, 6, 4), 3);
});

test('零词或零时长不炸', () => {
  assert.equal(W.at(3, 2, 6, 0), -1);
  assert.equal(W.at(3, 2, 2, 4), -1);
});

/* ---------- 取帧 ---------- */

test('每一种样式的 anim 都在动画目录里', () => {
  const keys = D.subtitle.anims.map((a) => a.k);
  D.subtitle.catalog.forEach((p) => {
    /* 动效字幕（第 70 轮起是 emphasis 系列配方）走**另一条渲染路径**：它的时间通道
       在 `BC_VC` 里，与这张逐词动效目录无关，所以判据是「配方指得到 ＋ 不借逐词动效」。
       借一条逐词动效会让画面上出现两个说了算的人（§13.2 第 54 轮）。 */
    if (p.caption) {
      assert.ok(window.BC_VC.byKey(p.caption), p.id + ' 的 caption「' + p.caption + '」不在 BC_VC.PRESETS 里');
      assert.equal(p.anim, 'none', p.id + ' 是配方却还借了一条逐词动效');
      return;
    }
    assert.ok(keys.indexOf(p.anim) >= 0, p.id + ' 的 anim「' + p.anim + '」不在目录里');
  });
});

test('仅译文的样式一律没有逐词动画——词级时间戳只有源语言轨有', () => {
  D.subtitle.catalog.filter((p) => p.form === 'trans').forEach((p) => {
    assert.equal(p.anim, 'none', p.id + ' 是仅译文却配了逐词动画');
  });
});

test('样例文字默认是英文，且每一门都切得出词', () => {
  assert.ok(D.subtitle.sample.en, '没有英文样例');
  assert.equal(D.subtitle.sampleDefault, 'en');
  Object.keys(D.subtitle.sample).forEach((k) => {
    const s = D.subtitle.sample[k];
    assert.ok(W.split(s.thumb).length >= 2, k + ' 的缩略图样例切不出两个词');
    assert.ok(W.split(s.line).length >= 3, k + ' 的预览条样例切不出三个词');
  });
});

test('画廊样张固定一对语言，最显眼那一行是默认那门（英文）', () => {
  const sp = D.subtitle.specimen;
  assert.equal(sp.main, D.subtitle.sampleDefault);
  assert.notEqual(sp.sub, sp.main, '双语样张两行写同一门语言，看不出是双语');
  assert.ok(D.subtitle.sample[sp.sub], '样张下面那一行的语言没有样例文字');
});
