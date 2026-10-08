/* node --test designs/baocut/app/model-daoyazi.test.js
   倒鸭子纯模型的不变量（设计稿 §14.1–§14.3）：确定性、分段理由、正交无重叠与量化、
   主角块、固定块、相机窗口与 zoom 区间、seek == 顺播、逐词生命周期、画幅 token、轻动感、
   哈希向量，以及 BaoCut 轨字段那一层（`defaults` / `fromCues` / `rolesOf` / `planFor`）。 */
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-daoyazi.js');
require('./model-wordanim.js');
const DZ = window.BC_DZ;

/* 夹具：一段原创口播，带停顿（≥ 0.8 s）、说话人切换、中英混排与数字，凑出 3–4 个动画段。
   词时间按字数比例从 cue 区间派生（确定性），模拟 transcript.json 的 words[]。 */
const SCRIPT = [
  ['A', 0.30, 2.10, ['你', '有没有', '发现', '，']],
  ['A', 2.15, 4.60, ['同样', '一段', '话', '，', '有的', '视频', '看着', '就是', '带劲', '。']],
  ['A', 4.70, 6.40, ['差别', '不在', '文案', '，']],
  ['A', 6.45, 8.30, ['在', '字幕', '怎么', '出现', '。']],
  ['A', 9.40, 11.20, ['以前', '我们', '把', '字幕', '钉', '在', '底部', '，']],
  ['A', 11.25, 13.10, ['一句', '换', '一句', '，', '像', '看', 'PPT', '。']],
  ['A', 13.15, 15.60, ['现在', '文字', '本身', '就是', '画面', '，']],
  ['A', 15.65, 17.90, ['镜头', '跟着', '你', '说话', '的', '节奏', '走', '。']],
  ['A', 17.95, 19.60, ['关键词', '放大', '，']],
  ['A', 19.65, 21.80, ['转', '个', '90', '度', '，', '再', '推', '过去', '。']],
  ['B', 22.60, 24.40, ['那', '剪辑', '会', '不会', '很', '麻烦', '？']],
  ['A', 24.50, 26.60, ['不会', '，', '你', '只', '改', '文稿', '，']],
  ['A', 26.65, 28.90, ['版式', '和', '镜头', '自动', '跟着', '变', '。']],
  ['A', 28.95, 31.40, ['不', '满意', '就', '换', '一版', '，', '3', '秒', '的', '事', '。']],
  ['A', 32.60, 34.40, ['这', '就是', '倒鸭子', '。']],
];
const CJK = /[一-鿿]/;
const weight = (tok) => {
  let w = 0;
  for (const ch of tok) w += CJK.test(ch) ? 1 : /[，。！？、]/.test(ch) ? 0.25 : 0.55;
  return Math.max(0.25, w);
};
const fixture = () => {
  const cues = [];
  let wid = 1;
  SCRIPT.forEach((row, ci) => {
    const [speaker, start, end, tokens] = row;
    const merged = [];
    for (const tok of tokens) {
      if (/^[，。！？、]$/.test(tok) && merged.length) merged[merged.length - 1] += tok;
      else merged.push(tok);
    }
    const total = merged.reduce((a, m) => a + weight(m), 0);
    let t = start;
    const words = merged.map((m) => {
      const dur = (end - start) * weight(m) / total;
      const w = { id: 'w' + (wid++), text: m, start: Math.round(t * 1000) / 1000, end: Math.round((t + dur) * 1000) / 1000 };
      t += dur;
      return w;
    });
    cues.push({ id: 'c' + (ci + 1), speaker, start, end, words });
  });
  return { cues, duration: 35.5, defaultRoles: { w28: 'hero', w20: 'emphasis', w62: 'hero', w40: 'emphasis' } };
};
const DATA = fixture();

const input = () => ({ cues: DATA.cues, roles: DATA.defaultRoles, duration: DATA.duration });
const base = { seed: 137, aspect: { w: 16, h: 9 } };
/* 逐词档：v3 起默认是整行入场、历史行不淡；逐词生命周期与弹入的用例显式切回逐词。 */
const wordBase = { ...base, options: { reveal: 'word', presentation: { history: { opacity: 0.5 } } } };
const strip = plan => JSON.stringify(plan, (k, v) => (k === 'debugCands' || k === 'turnWish' || k.startsWith('_')) ? undefined : v);

test('相同输入与 seed 重复编译逐字节一致；不同 seed 改变布局', () => {
  const a = DZ.compile(input(), base);
  const b = DZ.compile(input(), base);
  assert.equal(strip(a), strip(b));
  const c = DZ.compile(input(), { ...base, seed: 9 });
  const centersA = a.sequences.flatMap(s => s.blocks.map(x => x.center.join(',') + '/' + x.rotDeg)).join(' ');
  const centersC = c.sequences.flatMap(s => s.blocks.map(x => x.center.join(',') + '/' + x.rotDeg)).join(' ');
  assert.notEqual(centersA, centersC);
});

test('分段：停顿、说话人切换与预算都能断段，且不改词时间', () => {
  const plan = DZ.compile(input(), base);
  const reasons = plan.sequences.map(s => s.breakReasons.join('+'));
  assert.ok(reasons.some(r => r.includes('pause')));
  assert.ok(reasons.some(r => r.includes('speaker')));
  assert.ok(reasons.some(r => r.includes('blocks') || r.includes('duration')));
  const words = plan.sequences.flatMap(s => s.blocks.flatMap(b => b.words));
  const src = new Map(DATA.cues.flatMap(c => c.words).map(w => [w.id, w]));
  for (const w of words) assert.deepEqual([w.start, w.end], [src.get(w.id).start, src.get(w.id).end]);
});

test('正交排版：同一段内任意两块 AABB 不相交，坐标量化到 1/64，角度只取直角', () => {
  for (const seed of [1, 137, 2024, 9999]) {
    const plan = DZ.compile(input(), { ...base, seed });
    for (const seq of plan.sequences) {
      const boxes = seq.blocks.map(b => DZ.aabbOf(b.center, b.w, b.h, b.rotDeg));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        assert.equal(DZ.overlapArea(boxes[i], boxes[j], 0), 0, `seed ${seed} ${seq.id} blocks ${i},${j} overlap`);
      }
      for (const b of seq.blocks) {
        assert.equal(b.center[0] * 64, Math.round(b.center[0] * 64));
        assert.ok([0, 90, 180, 270].includes(b.rotDeg));
      }
    }
    assert.equal(plan.diagnostics.filter(d => d.level === 'error').length, 0);
  }
});

test('hero 词独立成块、字号撑到列宽（封顶 2.75×）；emphasis 不改分块', () => {
  const plan = DZ.compile(input(), base);
  const hero = plan.sequences.flatMap(s => s.blocks).find(b => b.key === 'w28');
  assert.ok(hero && hero.hero && hero.words.length === 1);
  assert.ok(hero.font > plan.fontPx * 1.5 && hero.font <= plan.fontPx * 2.75, `主角字号 ${hero.font}`);
  const noRoles = DZ.compile({ ...input(), roles: { w20: 'emphasis' } }, base);
  const withEmph = DZ.compile({ ...input(), roles: {} }, base);
  assert.equal(strip(noRoles).replace(/"role":"emphasis"/g, '"role":"normal"'), strip(withEmph));
});

test('固定块优先：pinned 位置原样保留，其他块绕开', () => {
  // 块的 key 是首词 id；防快闪并块之后哪些词打头要现查
  const auto = DZ.compile(input(), base);
  const key = auto.sequences[0].blocks[2].key;
  const pins = { [key]: { center: [300, -200], rotDeg: 90 } };
  const plan = DZ.compile({ ...input(), pins }, base);
  const seq = plan.sequences.find(s => s.blocks.some(b => b.key === key));
  const b = seq.blocks.find(x => x.key === key);
  assert.deepEqual(b.localCenter, [300, -200]);
  assert.deepEqual(b.center, [300 + seq.origin[0], -200 + seq.origin[1]]);
  assert.equal(b.rotDeg, 90);
  assert.equal(b.placement, 'pinned');
  const boxes = seq.blocks.map(x => DZ.aabbOf(x.center, x.w, x.h, x.rotDeg));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.equal(DZ.overlapArea(boxes[i], boxes[j], 0), 0);
});

test('相机窗口：平滑档到达即 onset、运动长度在 [minTravel, maxTravel/speed] 内；停走档提前量 ≤ 0.6·travel；段不重叠；旋转 0 时 dRot 全 0', () => {
  const plan = DZ.compile(input(), base);
  assert.equal(plan.options.camera.motion, 'smooth');
  const C = plan.options.camera;
  for (const seq of plan.sequences) {
    for (let i = 1; i < seq.segments.length; i++) {
      assert.ok(seq.segments[i].t0 >= seq.segments[i - 1].t1 - 1e-9, `${seq.id} segment ${i} overlaps`);
      const s = seq.segments[i];
      if (s.kind === 'travel') {
        assert.equal(s.t1, seq.blocks[s.block].firstT, '平滑档：到达时刻就是新块首词 onset');
        assert.ok(s.t1 - s.t0 <= C.maxTravelMs / 1000 / plan.speed + 1e-9);
        assert.ok(s.t1 - s.t0 >= Math.min(C.minTravelMs / 1000, seq.blocks[s.block].firstT - seq.blocks[s.block - 1].firstT) - 1e-9);
      }
    }
  }
  const sg = DZ.compile(input(), { ...base, options: { camera: { motion: 'stopAndGo' } } });
  let travels = 0;
  for (const seq of sg.sequences) for (const s of seq.segments) if (s.kind === 'travel') {
    travels++;
    assert.ok(s.lead <= 0.6 * (s.t1 - s.t0) + 1e-9);
    assert.ok(s.t1 - s.t0 <= sg.options.camera.travelMs / 1000 + 1e-9);
  }
  assert.ok(travels > 0);
  const still = DZ.compile(input(), { ...base, options: { camera: { maxTurnDeg: 0 } } });
  for (const seq of still.sequences) {
    for (const b of seq.blocks) assert.equal(b.rotDeg, 0);
    for (const s of seq.segments) assert.equal(s.dRot || 0, 0);
  }
});

test('取景：zoom 在可读性区间内；阅读态当前块四角在视口内', () => {
  const plan = DZ.compile(input(), base);
  const zoomMin = (0.032 * plan.ref.h) / plan.fontPx;
  const zoomMaxFont = (DZ.ZOOM_FONT_CAP * plan.ref.h) / plan.fontPx;
  const vp = plan.viewport;
  for (const seq of plan.sequences) {
    for (const s of seq.segments) {
      if (s.kind === 'overview') continue;
      assert.ok(s.to.zoom >= zoomMin - 1e-9 && s.to.zoom <= zoomMaxFont + 1e-9, `zoom ${s.to.zoom}`);
      const block = seq.blocks[s.block];
      const frame = DZ.sample(plan, s.t1 + 1e-6);
      const M = DZ.matMul(DZ.cameraMatrix(frame.camera, vp), DZ.blockMatrix(block));
      for (const c of [[0, 0], [block.w, 0], [0, block.h], [block.w, block.h]]) {
        const p = DZ.apply(M, c);
        assert.ok(p[0] >= vp.x - 0.5 && p[0] <= vp.x + vp.w + 0.5 && p[1] >= vp.y - 0.5 && p[1] <= vp.y + vp.h + 0.5, `${seq.id} block ${block.key} corner ${p} outside viewport`);
      }
    }
  }
});

test('seek 即采样：顺播路径与直接 seek 到同一时刻结果一致', () => {
  const plan = DZ.compile(input(), base);
  const direct = JSON.stringify(DZ.sample(plan, 7.2));
  let last;
  for (let t = 0; t <= 7.2 + 1e-9; t += 1 / 30) last = DZ.sample(plan, Math.min(t, 7.2));
  last = DZ.sample(plan, 7.2);
  assert.equal(JSON.stringify(last), direct);
  assert.equal(JSON.stringify(DZ.sample(plan, 7.2)), direct);
});

test('生命周期：逐词 onset 前不可见，历史块按 maxBlocks 截断，未来块不绘制，段间淡出不超过 fadeMs', () => {
  const plan = DZ.compile(input(), wordBase);
  const seq = plan.sequences[1];
  const bi = seq.blocks.findIndex((x, i) => i > 0 && x.words.length >= 2);
  const b = seq.blocks[bi];
  const w = b.words[b.words.length - 1];
  const pre = plan.entrance.pre;
  assert.ok(pre > 0 && pre < plan.entrance.dur, '入场提前量是入场时长的一部分');
  const before = DZ.sample(plan, w.start - pre - 0.001);
  const fb = before.blocks.find(x => x.idx === bi);
  assert.ok(fb && fb.words[fb.words.length - 1].opacity === 0, '提前量之前不可见');
  assert.ok(fb.words[0].opacity > 0, '首词已可见');
  assert.ok(!before.blocks.some(x => x.idx > bi), '未来块不应出现');
  const rolling = DZ.sample(plan, w.start - pre / 2).blocks.find(x => x.idx === bi).words;
  const rw = rolling[rolling.length - 1];
  assert.ok(rw.opacity > 0 && rw.opacity < 1 && !rw.speaking, 'onset 之前已在入场、但还不算在念');
  const onset = DZ.sample(plan, w.start + 1e-4).blocks.find(x => x.idx === bi).words;
  assert.ok(onset[onset.length - 1].opacity >= 0.49 && onset[onset.length - 1].speaking, 'onset 时已站住一半');
  const late = DZ.sample(plan, seq.blocks[seq.blocks.length - 1].firstT + 0.01);
  assert.ok(late.blocks.length <= plan.options.presentation.history.maxBlocks + 1);
  assert.equal(late.blocks.filter(x => x.opacity === 1).length, 1);
  const seq2 = plan.sequences[2];
  const enter = seq2.segments[0];
  assert.equal(enter.kind, 'enter');
  assert.equal(seq2.cutAt, enter.t0);
  const mid = DZ.sample(plan, (enter.t0 + enter.t1) / 2);
  assert.ok(mid.fading && mid.fading.camera === null && mid.fading.alpha > 0 && mid.fading.alpha < 1, '飞过去的路上上一段还在，用同一台相机');
  assert.ok(DZ.sample(plan, enter.t1 + 0.05).fading, '到达后 fadeMs 内淡出');
  assert.equal(DZ.sample(plan, enter.t1 + plan.options.sequence.fadeMs / 1000 + 0.01).fading, null);
  const blockReveal = DZ.compile(input(), { ...base, reveal: 'block' });
  const fr = DZ.sample(blockReveal, blockReveal.sequences[1].blocks[1].firstT + 0.001);
  const bb = fr.blocks.find(x => x.idx === 1);
  assert.ok(bb.words.every(x => x.opacity > 0));
});

test('画幅档：竖屏取 vertical tokens，viewport 与 density 随之变化；用户覆盖只写差值', () => {
  const wide = DZ.compile(input(), base);
  const tall = DZ.compile(input(), { ...base, aspect: { w: 9, h: 16 } });
  assert.equal(wide.aspectKind, 'wide');
  assert.equal(tall.aspectKind, 'vertical');
  assert.equal(tall.density, DZ.LAYOUT_TOKENS.vertical.density);
  assert.notEqual(JSON.stringify(wide.viewport), JSON.stringify(tall.viewport));
  const custom = DZ.compile(input(), { ...base, options: { layout: { density: 0.9 } } });
  assert.equal(custom.density, 0.9);
  assert.equal(custom.fit, DZ.LAYOUT_TOKENS.wide.fit);
});

test('轻动感预设：不旋转、停留更久、intensity 封顶 40，是保存进文件的值', () => {
  const plan = DZ.compile(input(), { ...base, intensity: 80, options: { preset: 'light' } });
  assert.equal(plan.options.camera.maxTurnDeg, 0);
  assert.equal(plan.options.camera.dwell, 0.35);
  assert.equal(plan.intensity, 40);
});

test('段与段接在同一张画布上：世界互不重叠、块 center = localCenter + origin、镜头从上一段末姿态连续飞入', () => {
  const plan = DZ.compile(input(), base);
  assert.ok(plan.sequences.length >= 3);
  assert.deepEqual(plan.sequences[0].origin, [0, 0]);
  for (let i = 0; i < plan.sequences.length; i++) {
    const seq = plan.sequences[i];
    for (const b of seq.blocks) assert.deepEqual(b.center, [b.localCenter[0] + seq.origin[0], b.localCenter[1] + seq.origin[1]]);
    for (let j = 0; j < i; j++) assert.equal(DZ.overlapArea(seq.world, plan.sequences[j].world, 0), 0, `world ${i} vs ${j}`);
    if (i === 0) continue;
    const prev = plan.sequences[i - 1];
    const enter = seq.segments[0];
    const prevLast = prev.segments[prev.segments.length - 1];
    assert.equal(enter.kind, 'enter');
    assert.ok(enter.t0 >= prevLast.t1 - 1e-9, '上一段镜头停下后才起飞');
    assert.deepEqual(enter.from, prevLast.to, '起点是上一段的末姿态');
    assert.equal(enter.t1, seq.blocks[0].firstT);
  }
  // 相机采样在段边界连续：cutAt 前一瞬与后一瞬姿态相同
  const seq = plan.sequences[1];
  const a = DZ.sample(plan, seq.cutAt - 1e-4).camera, b = DZ.sample(plan, seq.cutAt + 1e-4).camera;
  assert.ok(Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.zoom - b.zoom) < 1e-3 && Math.abs(a.rot - b.rot) < 0.5);
});

test('位置 / 角度 / 缩放同一条 ease：中点三者都恰好走一半，没有超调', () => {
  const plan = DZ.compile(input(), { ...base, options: { camera: { zoomLog: false } } });
  const s = plan.sequences.flatMap(sq => sq.segments).find(x => x.kind === 'travel' && x.dRot);
  assert.ok(s, '有一段带转向的运动');
  const mid = DZ.sample(plan, (s.t0 + s.t1) / 2).camera;
  assert.ok(Math.abs(mid.x - (s.from.x + s.to.x) / 2) < 1e-6);
  assert.ok(Math.abs(mid.rot - (s.from.rot + s.dRot / 2)) < 1e-6);
  assert.ok(Math.abs(mid.zoom - (s.from.zoom + s.to.zoom) / 2) < 1e-6);
  const lo = Math.min(s.from.x, s.to.x), hi = Math.max(s.from.x, s.to.x);
  for (let k = 0; k <= 20; k++) { const p = DZ.sample(plan, s.t0 + (s.t1 - s.t0) * k / 20).camera; assert.ok(p.x >= lo - 1e-6 && p.x <= hi + 1e-6); }
});

test('块内排版：词左对齐、折行时 x 归零 y 往下一个行高、取景宽 ≥ 两个字宽；行盒落在 1/32 网格', () => {
  const plan = DZ.compile(input(), base);
  for (const seq of plan.sequences) for (const b of seq.blocks) {
    assert.ok(b.lines >= 1 && b.lines <= DZ.MERGE_MAX_LINES);
    assert.equal(b.words[0].x, 0); assert.equal(b.words[0].y, 0);
    let lines = 1;
    for (let i = 1; i < b.words.length; i++) {
      const p = b.words[i - 1], w = b.words[i];
      if (w.y === p.y) assert.ok(w.x >= p.x + p.w - 1e-9, '行内不回头');
      else { assert.equal(w.x, 0); assert.equal(w.y, p.y + Math.round(p.font * DZ.LINE_HEIGHT * 32) / 32); lines++; }
    }
    assert.equal(lines, b.lines);
    assert.ok(b.w >= DZ.MIN_ROW_EM * b.font - 1e-9, `取景宽 ${b.w} 短于两个字宽`);
    assert.ok(b.w >= b.textW - 1 / 64, '取景宽量化到 1/32、文字宽 1/64，差不过一格');
    const last = b.words[b.words.length - 1];
    assert.equal(b.h, last.y + Math.round(last.font * DZ.LINE_HEIGHT * 32) / 32);
    assert.equal(b.w * 32, Math.round(b.w * 32));
  }
});

test('防快闪：每一块至少停 0.7 s，不够的并进相邻块（保住较早的入场时刻），装不下一行就折行；主角与换人不并', () => {
  const chars = (id, start, end, sp, text) => { const cs = [...text]; return { id, start, end, speaker: sp, words: cs.map((t, k) => ({ id: id + ':' + k, text: t, start: start + (end - start) * k / cs.length, end: start + (end - start) * (k + 1) / cs.length })) }; };
  const cues = [
    chars('f1', 0, 1.3, 'a', '这一句说得特别快一口气念完'),
    chars('f2', 1.4, 3.8, 'a', '后面拖了一个字吗'),
    chars('f3', 3.9, 4.2, 'a', '哦'),
    { id: 'f4', start: 4.25, end: 6, speaker: 'a', words: ['原来', '是', '这样', '啊'].map((t, k) => ({ id: 'f4:' + k, text: t, start: 4.25 + 1.75 * k / 4, end: 4.25 + 1.75 * (k + 1) / 4 })) },
  ];
  const plan = DZ.compile({ cues, roles: {}, duration: 6.5 }, base);
  let folded = 0, words = 0;
  for (const seq of plan.sequences) seq.blocks.forEach((b, i) => {
    const nx = seq.blocks[i + 1];
    const dwell = nx ? nx.firstT - b.firstT : b.lastT - b.firstT;
    assert.ok(dwell >= DZ.MIN_BLOCK_DWELL_S - 1e-9, `${b.key} 只停 ${dwell}s`);
    assert.equal(b.firstT, b.words[0].start);
    for (let k = 1; k < b.words.length; k++) assert.ok(b.words[k].start >= b.words[k - 1].start);
    assert.ok(b.words.length > 1, '「哦」不单独闪一下');
    if (b.lines > 1) folded++;
    words += b.words.length;
  });
  assert.ok(folded > 0, '并完装不下一行的块应当折行');
  assert.equal(words, 13 + 8 + 1 + 4);
  const other = cues.map((c) => (c.id === 'f3' ? { ...c, speaker: 'b' } : c));
  const p2 = DZ.compile({ cues: other, roles: {}, duration: 6.5 }, { ...base, options: { sequence: { breakOnSpeakerChange: false } } });
  assert.equal(p2.sequences.flatMap(sq => sq.blocks).find(b => b.key === 'f3:0').words.length, 1, '换说话人不并');
  const p3 = DZ.compile({ cues, roles: { 'f3:0': 'hero' }, duration: 6.5 }, base);
  assert.equal(p3.sequences.flatMap(sq => sq.blocks).find(b => b.hero).words.length, 1, '主角块不参与');

});

test('同列等宽：没碰到字号上下限的行文字宽都贴着列宽；一句同色、强调色不连着出', () => {
  const plan = DZ.compile(input(), base);
  const colW = plan.fontPx * (2.5 + 5 * plan.density);
  let justified = 0;
  for (const seq of plan.sequences) {
    seq.blocks.forEach((b, i) => {
      const scale = b.font / plan.fontPx;
      const cap = b.hero ? 2.75 : 2;
      assert.ok(scale >= 0.75 - 1e-9 && scale <= cap + 1e-9, `行 ${b.key} 的字号倍率 ${scale}`);
      assert.equal(scale * 64, Math.round(scale * 64));
      if (scale > 0.75 && scale < cap) {
        assert.ok(Math.abs(b.textW - colW) <= (b.textW / scale) / 64 + 1e-9, `行 ${b.key} 宽 ${b.textW} ≠ 列宽 ${colW}`);
        justified++;
      }
      assert.ok([0, 1, 2].includes(b.tone));
      if (i > 0) {
        const p = seq.blocks[i - 1];
        if (p.cueId === b.cueId) assert.equal(b.tone, p.tone, '一句的各行同色');
        else if (b.tone !== 0) assert.notEqual(b.tone, p.tone, '强调色不连着出');
      }
    });
  }
  assert.ok(justified > 0);
});

test('逐行取景：当前行的取景宽放成视口宽 × fit（除非碰到字号上限），行盒居中', () => {
  const plan = DZ.compile(input(), base);
  const vp = plan.viewport;
  let normalized = 0, capped = 0;
  for (const seq of plan.sequences) for (const s of seq.segments) {
    if (s.kind === 'overview') continue;
    const b = seq.blocks[s.block];
    assert.equal(s.to.x, b.center[0]); assert.equal(s.to.y, b.center[1]);
    // 上限按这一行自己的字号算：屏幕字号 ≤ 30% 画布高，行高 ≤ 视口高 × fit
    const cap = Math.min((DZ.ZOOM_FONT_CAP * plan.ref.h) / b.font, (vp.h * plan.fit) / b.h);
    if (s.to.zoom >= cap - 1e-2) { capped++; continue; }
    assert.ok(Math.abs(s.to.zoom * b.w - vp.w * plan.fit) < vp.w * 1e-3, `行 ${b.key} 的屏幕宽 ${s.to.zoom * b.w} ≠ ${vp.w * plan.fit}`);
    normalized++;
  }
  assert.ok(normalized > 0);
  const focus = DZ.focusFor({ center: [10, 20], rotDeg: 90, w: 200, h: 43.2 }, { viewport: vp, fit: plan.fit, ref: plan.ref, fontPx: plan.fontPx });
  assert.deepEqual([focus.x, focus.y, focus.rot], [10, 20, 90]);
  assert.ok(Math.abs(focus.zoom - (vp.w * plan.fit) / 200) < 1e-3);
  void capped;
});

test('段在上一行的下角枢转：lb 绕左下角顺时针 90°，rb 绕右下角逆时针 90°，新首行的对应下角与之重合', () => {
  const para = { origin: [100, 50], rot: 0, height: 43.25 };
  const prev = { w: 120, h: 43.25 };
  const row = { w: 80, h: 43.25 };
  const lb = DZ.pivotPara(para, prev, row, 'lb');
  assert.equal(lb.rot, 90);
  const lbCorner = [lb.origin[0] + DZ.rotVec(90, [0, row.h])[0], lb.origin[1] + DZ.rotVec(90, [0, row.h])[1]];
  assert.deepEqual(lbCorner, [100, 50 + 43.25], '新首行左下角 = 上一行左下角');
  const rb = DZ.pivotPara(para, prev, row, 'rb');
  assert.equal(rb.rot, 270);
  const rbCorner = [rb.origin[0] + DZ.rotVec(270, [row.w, row.h])[0], rb.origin[1] + DZ.rotVec(270, [row.w, row.h])[1]];
  assert.deepEqual(rbCorner, [100 + 120, 50 + 43.25], '新首行右下角 = 上一行右下角');
  assert.deepEqual(DZ.rotVec(90, [1, 0]), [0, 1]);
  assert.deepEqual(DZ.rotVec(270, [1, 0]), [0, -1]);
  assert.deepEqual(DZ.rotVec(180, [1, 2]), [-1, -2]);
  // 编译出来的段：同一段内相邻行左对齐往下叠；相邻段的角度差恰好 ±90
  const plan = DZ.compile(input(), base);
  let turns = 0;
  for (const seq of plan.sequences) for (let i = 1; i < seq.blocks.length; i++) {
    const a = seq.blocks[i - 1], b = seq.blocks[i];
    if (a.para === b.para) {
      const d = [b.center[0] - a.center[0], b.center[1] - a.center[1]];
      const local = DZ.rotVec((360 - a.rotDeg) % 360, d);
      assert.ok(Math.abs(local[1] - (a.h + b.h) / 2) < 1e-6, '同段相邻行紧贴往下叠');
      assert.ok(Math.abs(local[0] - (b.w - a.w) / 2) < 1e-6, '同段行左对齐');
    } else if (b.placement !== 'pinned') {
      const dr = ((b.rotDeg - a.rotDeg) % 360 + 360) % 360;
      if (dr === 90 || dr === 270) turns++; else assert.equal(dr, 0, '不是枢转就是同角度另起一段');
    }
  }
  assert.ok(turns > 0, '默认动感下会出现枢转');
});

test('CSS ease：cubic-bezier(.25,.1,.25,1) 已知值、单调、端点归零归一；停走档与弹入用它', () => {
  assert.equal(DZ.cssEase(0), 0);
  assert.equal(DZ.cssEase(1), 1);
  assert.ok(Math.abs(DZ.cssEase(0.5) - 0.8024) < 2e-3, `cssEase(0.5) = ${DZ.cssEase(0.5)}`);
  assert.ok(Math.abs(DZ.cssEase(0.25) - 0.4085) < 5e-3);
  let last = 0;
  for (let i = 1; i <= 100; i++) { const v = DZ.cssEase(i / 100); assert.ok(v >= last - 1e-12); last = v; }
  const sg = DZ.compile(input(), { ...base, options: { camera: { motion: 'stopAndGo' } } });
  const seq = sg.sequences[1];
  const s = seq.segments.find(x => x.kind === 'travel' && x.dRot === 0 && Math.abs(x.to.x - x.from.x) > 1);
  const mid = DZ.sample(sg, (s.t0 + s.t1) / 2).camera;
  const k = (mid.x - s.from.x) / (s.to.x - s.from.x);
  assert.ok(Math.abs(k - DZ.cssEase(0.5)) < 1e-3, `停走档中点走了 ${k}，应是 CSS ease 的 ${DZ.cssEase(0.5)}`);
});

test('弹入：动感 60 从 0.3 倍起、原点在词的左中（整块时在行的左中）、按 CSS ease 放到 1', () => {
  const plan = DZ.compile(input(), wordBase);
  const seq = plan.sequences[1];
  const bi = seq.blocks.findIndex((x, i) => i > 0 && x.words.length >= 2);
  const b = seq.blocks[bi];
  const w = b.words[b.words.length - 1];
  const pre = plan.entrance.pre, dur = plan.entrance.dur;
  const at = (t) => DZ.sample(plan, t).blocks.find(x => x.idx === bi).words[b.words.length - 1];
  const f0 = at(w.start - pre + 1e-4);
  assert.ok(Math.abs(f0.scale - 0.3) < 0.01, `起点 ${f0.scale}`);
  assert.equal(f0.ox, w.x, '原点在词的左边');
  const fm = at(w.start - pre + dur / 2);
  assert.ok(Math.abs(fm.scale - (0.3 + 0.7 * DZ.cssEase(0.5))) < 1e-3);
  assert.ok(Math.abs(fm.opacity - DZ.cssEase(0.5)) < 1e-3);
  const f1 = at(w.start - pre + dur + 1e-4);
  assert.equal(f1.scale, 1); assert.equal(f1.opacity, 1);
  const calm = DZ.compile(input(), { ...wordBase, intensity: 0 });
  const c0 = DZ.sample(calm, w.start - pre + 1e-4).blocks.find(x => x.idx === bi).words[b.words.length - 1];
  assert.equal(c0.scale, 1, '动感 0 不缩放');
  // 默认整行入场：一行共用行首时刻与行左缘原点，从 0.7 倍起，不标「正在说」
  const block = DZ.compile(input(), base);
  assert.equal(block.reveal, 'block');
  const bRow = block.sequences[1].blocks[bi];
  const bb = DZ.sample(block, bRow.firstT - pre + 1e-4).blocks.find(x => x.idx === bi);
  assert.ok(bb.words.every(x => x.ox === 0), '整块出现时原点是行的左边');
  assert.ok(bb.words.every(x => Math.abs(x.scale - 0.7) < 0.01), `整行从 0.7 倍起：${bb.words[0].scale}`);
  const said = DZ.sample(block, (bRow.words[0].start + bRow.words[0].end) / 2);
  assert.ok(said.blocks.every(x => x.words.every(y => !y.speaking)), '整行入场不逐字换色');
  assert.ok(said.blocks.every(x => x.opacity === 1), '历史行不淡');
});

test('排版顺着走：多数块落在上一块坐标系的「下方」，转向按 turnEvery 节流', () => {
  const plan = DZ.compile(input(), base);
  let straight = 0, total = 0;
  for (const seq of plan.sequences) {
    let since = Infinity;
    for (let i = 1; i < seq.blocks.length; i++) {
      const p = seq.blocks[i - 1], b = seq.blocks[i];
      const d = ((b.rotDeg - p.rotDeg) % 360 + 360) % 360;
      if (d !== 0) { assert.ok(since >= plan.options.layout.turnEvery, `${seq.id} 转向太密`); since = 0; } else since++;
      const side = DZ.runSideOf(p.rotDeg);
      const dx = b.center[0] - p.center[0], dy = b.center[1] - p.center[1];
      const went = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'below' : 'above');
      total++; if (went === side) straight++;
    }
  }
  assert.ok(straight / total >= 0.6, `直线推进占比 ${straight}/${total}`);
});

test('竖过来的频率：默认动感下转向不少于行数的 15%，行中间也会转', () => {
  // 防快闪并块之后夹具只剩二十来块，单个种子的比例抖得厉害；四个种子合起来量
  let turns = 0, total = 0, midRow = 0;
  for (const seed of [137, 138, 139, 140]) for (const seq of DZ.compile(input(), { ...base, seed }).sequences) {
    for (let i = 1; i < seq.blocks.length; i++) {
      const p = seq.blocks[i - 1], b = seq.blocks[i];
      total++;
      if (b.rotDeg === p.rotDeg) continue;
      turns++;
      if (!/[，。！？；：、,.!?;:…—]$/.test(p.words[p.words.length - 1].text) && p.cueId === b.cueId) midRow++;
    }
  }
  assert.ok(turns >= 0.15 * total, `转向太少 ${turns}/${total}`);
  assert.ok(midRow > 0, '行中间从不转向');
});

test('稳定 hash：FNV-1a 64 与 SplitMix64 有已知向量', () => {
  assert.equal(DZ.fnv1a64('').toString(16), 'cbf29ce484222325');
  assert.equal(DZ.fnv1a64('a').toString(16), 'af63dc4c8601ec8c');
  const r = DZ.splitmix64(0n);
  assert.equal(r.next().toString(16), 'e220a8397b1dcdaf');
});

test('轨字段那一层：defaults 可 deepMerge 演示记录，fromCues 均分词时间且 breaks 落成 breakBefore', () => {
  const d = DZ.defaults({heroes: {g2: [9]}});
  assert.equal(d.seed, 137);
  assert.deepEqual(d.heroes, {g2: [9]});
  assert.equal(d.fit, null, 'fit 留空表示跟画幅 token 走');
  const cues = DZ.fromCues([
    {id: 'g1', start: 0, end: 2, sp: 's1', text: '欢迎回到这里'},
    {id: 'g2', start: 2, end: 4, sp: 's1', text: 'hello world'},
  ], window.BC_WA.split, {breaks: ['g2']});
  assert.equal(cues[0].words.length, 3);
  assert.deepEqual(cues[0].words.map((w) => w.id), ['g1:0', 'g1:1', 'g1:2']);
  assert.deepEqual(cues[0].words.map((w) => [w.start, w.end]), [[0, 0.667], [0.667, 1.333], [1.333, 2]]);
  assert.equal(cues[0].speaker, 's1');
  assert.equal(cues[1].breakBefore, true);
  assert.equal(cues[0].breakBefore, false);
});

test('rolesOf：主角来自 kinetic.heroes、强调来自强调词标记，主角优先；planFor 按轨字段编译且换一版改布局', () => {
  const roles = DZ.rolesOf({heroes: {g1: [1]}}, {on: true, marks: {g1: [{index: 1, text: 'x'}, {index: 2, text: 'y'}]}});
  assert.deepEqual(roles, {'g1:1': 'hero', 'g1:2': 'emphasis'});
  assert.deepEqual(DZ.rolesOf({heroes: {}}, {on: false, marks: {g1: [{index: 0, text: 'x'}]}}), {}, '强调词关着就不算');
  const cues = [
    {id: 'g1', start: 0, end: 3, sp: 's1', text: '先从一个很实际的问题开始：为什么要做本地？'},
    {id: 'g2', start: 3, end: 6, sp: 's2', text: '因为素材是别人的。上传这件事本身就是一个决定。'},
  ];
  const env = {aspect: {w: 16, h: 9}, split: window.BC_WA.split, duration: 6};
  const kin = DZ.defaults({heroes: {g1: [4]}});
  const a = DZ.planFor(cues, kin, env);
  const b = DZ.planFor(cues, kin, env);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const hero = a.sequences.flatMap((s) => s.blocks).find((x) => x.hero);
  assert.ok(hero && hero.words[0].id === 'g1:4');
  assert.equal(a.sequences.length, 2, '换人断段');
  const c = DZ.planFor(cues, Object.assign({}, kin, {seed: DZ.reseed(kin.seed)}), env);
  assert.notEqual(DZ.reseed(kin.seed), kin.seed);
  const centers = (p) => p.sequences.flatMap((s) => s.blocks.map((x) => x.center.join(',') + '/' + x.rotDeg)).join(' ');
  assert.notEqual(centers(a), centers(c));
  const bi = DZ.planFor(cues, Object.assign({}, kin, {viewportMode: 'bottom'}), Object.assign({}, env, {bilingual: true}));
  assert.ok(bi.viewport.h < a.viewport.h, '双语 + 下方：字幕区域收窄');
  assert.equal(DZ.seqIndexAt(a, -1), -1);
  assert.equal(DZ.seqIndexAt(a, a.sequences[1].cutAt), 1);
});
