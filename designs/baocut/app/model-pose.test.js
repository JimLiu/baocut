/* model-pose.js —— 与 `apps/baocut` 的 `stage_drag.rs` / `stage_snap.rs` 同口径。
   这些数不是设计偏好，是已落地实现的数；改它就要连着两端一起改。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-pose.js');
const P = window.BC_POSE;

const FRAME = {w: 880, h: 495};

/* ---------- 移动 ---------- */

test('中心 ±1.5% 吸附，并按逐类型限位夹取', () => {
  const r = P.dragPos({x: 49, y: 51}, {dx: 0.5, dy: -0.5}, {w: 100, h: 100}, P.TEXT_LIMITS);
  assert.strictEqual(r.x, 50);
  assert.strictEqual(r.y, 50);
  assert.ok(r.vGuide && r.hGuide);
  // 拖到画面外：文字限位 3…97 / 4…96
  const out = P.dragPos({x: 50, y: 50}, {dx: -900, dy: 900}, {w: 880, h: 495}, P.TEXT_LIMITS);
  assert.strictEqual(out.x, 3);
  assert.strictEqual(out.y, 96);
  // B-roll 更紧：6…94
  const broll = P.dragPos({x: 50, y: 50}, {dx: -900, dy: 900}, {w: 880, h: 495}, P.BROLL_LIMITS);
  assert.strictEqual(broll.x, 6);
  assert.strictEqual(broll.y, 94);
});

test('视频限位跟盒子走：9:16 铺满 16:9 宽可底边对齐裁掉顶部，留 10% 可见带', () => {
  const boxH = FRAME.w * 16 / 9;            // 盒高 ≈ 316% 帧高
  const lim = P.mediaLimits({w: FRAME.w, h: boxH}, FRAME);
  assert.deepStrictEqual(lim.x, [-40, 140]);
  const pct = boxH / FRAME.h * 100;
  assert.ok(Math.abs(lim.y[0] - (10 - pct / 2)) < 1e-9);
  assert.ok(Math.abs(lim.y[1] - (90 + pct / 2)) < 1e-9);
  const target = 100 - pct / 2;             // 底边贴画面底
  const r = P.dragPos({x: 50, y: 50}, {dx: 0, dy: (target - 50) / 100 * FRAME.h}, FRAME, lim);
  assert.ok(Math.abs(r.y - target) < 1e-9);
  // 小于 10% 的盒整只留在画面里；零尺寸回退整幅
  assert.deepStrictEqual(P.mediaLimits({w: FRAME.w * 0.04, h: 0}, FRAME), {x: [2, 98], y: [0, 100]});
  assert.deepStrictEqual(P.mediaLimits({w: 10, h: 10}, {w: 0, h: 0}), {x: [0, 100], y: [0, 100]});
});

test('零尺寸画面返回 null——没有换算的尺子', () => {
  assert.strictEqual(P.dragPos({x: 50, y: 50}, {dx: 10, dy: 0}, {w: 0, h: 0}, P.TEXT_LIMITS), null);
});

/* ---------- 6px 多线吸附 ---------- */

test('吸的是盒子的边与中线，画布线优先于邻居', () => {
  // 盒中心 x=436，左边 386、中线 436、右边 486；画布中线 440 在中线 4px 内
  const box = P.boxOf(436, 250, 100, 60);
  const out = P.snapMove(box, FRAME, [], true);
  assert.strictEqual(out.dx, 4);
  assert.ok(out.guides.some((g) => g.v && g.p === 440));
});

test('邻居的边也是候选线', () => {
  const other = P.boxOf(200, 100, 80, 80);     // 左边 160
  const box = P.boxOf(203, 300, 80, 40);       // 左边 163，离 160 三个像素
  const out = P.snapMove(box, FRAME, [other], true);
  assert.strictEqual(out.dx, -3);
});

test('⌥ 关闭吸附是整条规则不参与，不是阈值调大', () => {
  const box = P.boxOf(436, 250, 100, 60);
  const out = P.snapMove(box, FRAME, [], false);
  assert.deepStrictEqual(out, {dx: 0, dy: 0, guides: []});
});

test('同时对齐两条不同的线时两条都画出来', () => {
  // 宽 880 的画布：盒子左边压 0、右边压 880 → 左右两条线都命中
  const box = P.boxOf(440, 250, 880, 60);
  const g = P.guidesFor(box, FRAME, [], P.GUIDE_TOL);
  const xs = g.filter((l) => l.v).map((l) => l.p).sort((a, b) => a - b);
  assert.deepStrictEqual(xs, [0, 440, 880]);
});

test('导引线的容差是像素量级——round1 的百分比残差不能让线消失', () => {
  // 440.4 距画布中线 0.4px：1e-6 的容差会一根都画不出来
  const box = P.boxOf(440.4, 250, 100, 60);
  assert.ok(P.guidesFor(box, FRAME, [], P.GUIDE_TOL).some((g) => g.v && g.p === 440));
  assert.strictEqual(P.guidesFor(box, FRAME, [], 1e-6).length, 0);
});

test('宽度吸附绕中心对称生长，中心不动', () => {
  // 中心 440、宽 200 → 左 340 / 右 540；把右边吸到画布中线 440 会让半宽变 0，跳过
  const s = P.snapWidth(440, 872, FRAME, [], true);
  assert.strictEqual(s.w, 880);                       // 两边各让 4px 吸到画布左右边
  assert.strictEqual(s.guides.length, 2);
});

/* ---------- 四角 ---------- */

test('四角等比缩放钳在 0.1…5，保留两位小数', () => {
  assert.strictEqual(P.cornerScale(1, 100, 150), 1.5);
  assert.strictEqual(P.cornerScale(1, 100, 10000), 5);
  assert.strictEqual(P.cornerScale(1, 100, 1), 0.1);
});

test('对角锚定：缩放时对角那个点纹丝不动', () => {
  const anchor = {x: 0, y: 0};
  const r = P.cornerScaleAbout(1, {x: 50, y: 50}, anchor, {x: 100, y: 100}, {x: 200, y: 200});
  assert.strictEqual(r.scale, 2);
  assert.deepStrictEqual([r.x, r.y], [100, 100]);      // 中心跟着挪，锚点仍在 (0,0)
  // 钳到边界上锚点也不能动：中心用的是钳位之后的倍率
  const big = P.cornerScaleAbout(1, {x: 50, y: 50}, anchor, {x: 100, y: 100}, {x: 9999, y: 9999});
  assert.strictEqual(big.scale, 5);
  assert.deepStrictEqual([big.x, big.y], [250, 250]);
});

test('对角锚点跟着旋转走', () => {
  // 未旋转时 br 的对角是 tl
  assert.deepStrictEqual(P.cornerAnchor(100, 100, 40, 20, 'br', 0), {x: 80, y: 90});
  const turned = P.cornerAnchor(100, 100, 40, 20, 'br', 90);
  assert.ok(Math.abs(turned.x - 110) < 1e-9 && Math.abs(turned.y - 80) < 1e-9);
});

/* ---------- 竖胶囊 ---------- */

test('宽度柄双倍计入，并投影到旋转后的 x 轴', () => {
  // 未旋转、右柄右拖 20px → 宽度 +40px，880 宽的帧上是 +4.5%
  const w = P.widthPct(440, {x: 0, y: 0}, {x: 20, y: 0}, 0, 1, 880, P.MIN_W);
  assert.strictEqual(w, Math.round((440 + 40) / 880 * 100));
  // 转 90° 之后，同样的横向位移落在盒子的 y 轴上，宽度不变
  assert.strictEqual(P.widthPct(440, {x: 0, y: 0}, {x: 20, y: 0}, 90, 1, 880, P.MIN_W), 50);
  // 下限 2%、上限 100%
  assert.strictEqual(P.widthPct(440, {x: 0, y: 0}, {x: -9999, y: 0}, 0, 1, 880, P.MIN_W), 2);
  assert.strictEqual(P.widthPct(440, {x: 0, y: 0}, {x: 9999, y: 0}, 0, 1, 880, P.MIN_W), 100);
});

/* ---------- 旋转 ---------- */

test('默认吸 15° 栅格，⇧ 自由并保留一位小数', () => {
  assert.strictEqual(P.snapRot(7, false), 0);
  assert.strictEqual(P.snapRot(8, false), 15);
  assert.strictEqual(P.snapRot(-93, false), -90);
  assert.strictEqual(P.snapRot(45.74, true), 45.7);
  // 归一到 (-180, 180]，-180 报成 180
  assert.strictEqual(P.snapRot(-180, false), 180);
  assert.strictEqual(P.snapRot(370, true), 10);
});

test('15° 栅格是 ±3° 基本方位吸附的超集', () => {
  [0, 90, -90, 180].forEach((k) => assert.strictEqual(P.snapRot(k + 2, false), k === -90 ? -90 : k === 180 ? 180 : k));
});

test('外包盒随旋转长大，中心不动', () => {
  const b = P.rotBounds(100, 50, 90);
  assert.ok(Math.abs(b.w - 50) < 1e-9 && Math.abs(b.h - 100) < 1e-9);
  assert.deepStrictEqual(P.rotBounds(100, 50, 0), {w: 100, h: 50});
});

/* ---------- 能力表 ---------- */

test('旋转把手覆盖独立元素，progress、wave 与取景框也能旋转', () => {
  const rot = Object.keys(P.CAPS).filter((k) => P.CAPS[k].rot);
  assert.deepStrictEqual(rot.sort(),
    ['counter', 'image', 'progress', 'shape', 'sticker', 'text',
      'textgroup', 'vframe', 'video', 'wave']);
});

test('没有主视频 clip（2026-09-16）：项目原片就是普通 video，八把手 / 等比角柄 / 视频限位同一套', () => {
  assert.equal(P.CAPS.clip, undefined);
  assert.equal(P.CLIP_POSE0, undefined);
  assert.equal(P.CLIP_LIMITS, undefined);
  assert.deepStrictEqual(P.CAPS.video, {move: true, scale: false, width: true, rot: true, resize: 'free'});
  assert.deepStrictEqual(P.limitsFor('video'), P.BROLL_LIMITS);
  assert.deepStrictEqual(P.limitsFor('text'), P.TEXT_LIMITS);
  assert.equal(P.handlesFor('video', 800, 450).length, 8);
});

/* 计时（第 88 轮）是一条**文字元素**，所以它吃旋转与等比缩放；但它没有宽度柄——
   竖胶囊改的是容器宽度好让内容重新换行，一格单行读数改宽什么也不会发生。 */
/* 第 89.1 轮补宽度柄：容器拉得宽，三档对齐才有留白可对（用户裁决）。
   第 88 轮判「没有宽度柄」的前提是盒子恒等于内容宽，那个前提这一轮被去掉了。 */
test('计时四个手势全给——它是一条文字元素', () => {
  const c = P.caps('counter');
  assert.ok(c.move && c.scale && c.rot && c.width);
  assert.strictEqual(c.resize, 'text');
  assert.deepStrictEqual(c, P.caps('text'), '与文字元素同一组能力');
});

test('整幅覆盖层与模板一个手势都不吃', () => {
  ['overlay', 'tpl'].forEach((k) => {
    assert.deepStrictEqual(P.caps(k), {});
  });
  assert.deepStrictEqual(P.caps('vframe'), {rot: true});
  assert.deepStrictEqual(P.caps('没这个类型'), {});
});

test('字幕只有竖胶囊，上下左右都可拖', () => {
  const c = P.caps('subtitle');
  assert.ok(c.width && c.move && !c.scale && !c.rot);
  assert.strictEqual(c.axis, undefined, '不锁轴：水平中心 x 也跟着拖');
  assert.strictEqual(c.resize, 'width');
  assert.deepStrictEqual(P.handlesFor('subtitle', 400, 60), ['w', 'e'], '没有四角：它没有 pose.scale');
});

/* ---------- 四边缩放（第 122 轮）---------- */

test('把手集合按类型分三档', () => {
  // 自由比例一族：八把手
  ['sticker', 'video', 'progress', 'wave'].forEach((k) => {
    assert.deepStrictEqual(P.handlesFor(k, 200, 120),
      ['n', 'w', 's', 'e', 'nw', 'ne', 'sw', 'se'], k);
    assert.strictEqual(P.caps(k).resize, 'free');
  });
  // 文字一族：左右 ＋ 四角
  ['text', 'textgroup', 'counter'].forEach((k) => {
    assert.deepStrictEqual(P.handlesFor(k, 200, 120), ['w', 'e', 'nw', 'ne', 'sw', 'se'], k);
  });
  // 其余：只有四角
  ['image', 'shape'].forEach((k) => {
    assert.deepStrictEqual(P.handlesFor(k, 200, 120), ['nw', 'ne', 'sw', 'se'], k);
  });
  // 不吃手势的类型一个把手都不出
  ['overlay', 'tpl', 'vframe', '没这个类型'].forEach((k) => {
    assert.deepStrictEqual(P.handlesFor(k, 200, 120), [], k);
  });
});

test('小盒（任一边 < 24px）退化成三档各自的子集', () => {
  assert.deepStrictEqual(P.handlesFor('sticker', 20, 120), ['nw', 's', 'e']);
  assert.deepStrictEqual(P.handlesFor('sticker', 200, 12), ['nw', 's', 'e']);
  assert.deepStrictEqual(P.handlesFor('text', 200, 20), ['se', 'e']);
  assert.deepStrictEqual(P.handlesFor('image', 20, 20), ['nw']);
  // 24 是**不退化**的下界（`< 24` 才退化）；窄窗口舞台上三十来像素高的标题不再收把手
  assert.deepStrictEqual(P.handlesFor('image', 24, 24), ['nw', 'ne', 'sw', 'se']);
  assert.deepStrictEqual(P.handlesFor('text', 80, 36), ['w', 'e', 'nw', 'ne', 'sw', 'se']);
});

test('把手样式档与把手集合是两个不同的阈值（样式档按 50/40）', () => {
  assert.strictEqual(P.smallHandles(45, 120), true, '宽 45：集合不退化，样式已是小档');
  assert.deepStrictEqual(P.handlesFor('sticker', 45, 120).length, 8);
  assert.strictEqual(P.smallHandles(200, 120), false);
  assert.strictEqual(P.smallHandles(200, 30), true);
});

test('宽高比：自由一族返回 null，其余按起手盒锁死', () => {
  assert.strictEqual(P.aspectFor('sticker', 200, 100), null);
  assert.strictEqual(P.aspectFor('image', 200, 100), 2);
  assert.strictEqual(P.aspectFor('image', 0, 100), null, '量不到盒子就不硬造一个比例');
});

test('边把手只改一轴，锚在对边——右边拖 20px：宽 +20、中心右移 10', () => {
  const r = P.edgeResize({handle: 'e', dx: 20, dy: 7, rot: 0, w: 100, h: 50});
  assert.strictEqual(Math.round(r.w), 120);
  assert.strictEqual(r.h, 50, '纵向一动不动');
  assert.strictEqual(Math.round(r.x), 10);
  assert.strictEqual(Math.round(r.y), 0);
  // 下边拖 20px：高 +20、中心下移 10，宽不动
  const b = P.edgeResize({handle: 's', dx: 9, dy: 20, rot: 0, w: 100, h: 50});
  assert.strictEqual(b.w, 100);
  assert.strictEqual(Math.round(b.h), 70);
  assert.strictEqual(Math.round(b.y), 10);
});

test('左 / 上两侧取反：往左拖是长大，锚落在右 / 下', () => {
  const l = P.edgeResize({handle: 'w', dx: -20, dy: 0, rot: 0, w: 100, h: 50});
  assert.strictEqual(Math.round(l.w), 120);
  assert.strictEqual(Math.round(l.x), -10, '右边不动，中心往左让');
  const t = P.edgeResize({handle: 'n', dx: 0, dy: -20, rot: 0, w: 100, h: 50});
  assert.strictEqual(Math.round(t.h), 70);
  assert.strictEqual(Math.round(t.y), -10);
});

test('⌥ 以中心为锚：位移双倍计入，中心纹丝不动', () => {
  const r = P.edgeResize({handle: 'e', dx: 20, dy: 0, rot: 0, w: 100, h: 50, alt: true});
  assert.strictEqual(Math.round(r.w), 140);
  assert.strictEqual(r.x, 0);
  assert.strictEqual(r.y, 0);
});

test('旋转 90° 后拖边仍沿元素自身轴——竖直位移改的是宽', () => {
  const r = P.edgeResize({handle: 'e', dx: 0, dy: 20, rot: 90, w: 100, h: 50});
  assert.strictEqual(Math.round(r.w), 120);
  assert.strictEqual(r.h, 50);
  // 中心沿旋转后的 +x 轴（= 屏幕 +y）让开 10
  assert.ok(Math.abs(r.x) < 1e-9);
  assert.strictEqual(Math.round(r.y), 10);
});

test('旋转 45°：只有投影到自身轴的那一半计入宽', () => {
  const r = P.edgeResize({handle: 'e', dx: 10, dy: 10, rot: 45, w: 100, h: 50});
  // 局部 dx = 10·cos45 + 10·sin45 = 14.142
  assert.ok(Math.abs(r.w - (100 + Math.sqrt(200))) < 1e-9);
  assert.strictEqual(r.h, 50);
});

test('四角默认锁比例；⇧ 只在自由比例一族解得开', () => {
  const lock = P.edgeResize({handle: 'se', dx: 20, dy: 0, rot: 0, w: 100, h: 50, ratioLocked: 2});
  assert.ok(Math.abs(lock.w / lock.h - 2) < 1e-9, '锁死的比例拖不歪');
  // 自由一族（ratioLocked = null）默认仍锁
  const free0 = P.edgeResize({handle: 'se', dx: 20, dy: 0, rot: 0, w: 100, h: 50});
  assert.ok(Math.abs(free0.w / free0.h - 2) < 1e-9);
  // ⇧ 解锁：横向拖只长宽
  const free1 = P.edgeResize({handle: 'se', dx: 20, dy: 0, rot: 0, w: 100, h: 50, shift: true});
  assert.strictEqual(Math.round(free1.w), 120);
  assert.strictEqual(free1.h, 50);
  // 但 ratioLocked 在场时 ⇧ 无效（锁比例的条件是 `alt || !shift || ratioLocked`）
  const still = P.edgeResize({handle: 'se', dx: 20, dy: 0, rot: 0, w: 100, h: 50,
    shift: true, ratioLocked: 2});
  assert.ok(Math.abs(still.w / still.h - 2) < 1e-9);
});

test('四角锚在对角：se 拖动时 nw 那个点不动', () => {
  const w0 = 100, h0 = 50;
  const r = P.edgeResize({handle: 'se', dx: 20, dy: 0, rot: 0, w: w0, h: h0, x: 0, y: 0,
    ratioLocked: w0 / h0});
  // 起手 nw 角 = (-50, -25)；新 nw 角 = 新中心 − 新半宽/半高
  assert.ok(Math.abs((r.x - r.w / 2) - (-w0 / 2)) < 1e-9);
  assert.ok(Math.abs((r.y - r.h / 2) - (-h0 / 2)) < 1e-9);
});

test('最小 10×10 px：拖过头也钳在那里', () => {
  const r = P.edgeResize({handle: 'e', dx: -9999, dy: 0, rot: 0, w: 100, h: 50});
  assert.strictEqual(r.w, P.MIN_PX);
  const b = P.edgeResize({handle: 's', dx: 0, dy: -9999, rot: 0, w: 100, h: 50});
  assert.strictEqual(b.h, P.MIN_PX);
  // min 可覆盖
  assert.strictEqual(P.edgeResize({handle: 'e', dx: -9999, dy: 0, rot: 0, w: 100, h: 50, min: 4}).w, 4);
});

test('光标随旋转角转', () => {
  assert.strictEqual(P.resizeCursor('e', 0), 'e-resize');
  assert.strictEqual(P.resizeCursor('e', 90), 's-resize');
  assert.strictEqual(P.resizeCursor('n', 90), 'e-resize');
  assert.strictEqual(P.resizeCursor('nw', 45), 'n-resize');
  // 负角先折回 0…360
  assert.strictEqual(P.resizeCursor('e', -90), 'n-resize');
  assert.strictEqual(P.resizeCursor('没这个把手', 0), 'default');
});

test('四角是两个字母、四边是一个——`isCorner` 是这张词表的唯一判据', () => {
  ['nw', 'ne', 'sw', 'se'].forEach((h) => assert.strictEqual(P.isCorner(h), true, h));
  ['n', 'w', 's', 'e'].forEach((h) => assert.strictEqual(P.isCorner(h), false, h));
});

test('缺省摆位里没有 `h`——没写过高度的元素仍按内容宽高比撑（向后兼容）', () => {
  assert.strictEqual(P.POSE0.h, undefined);
  assert.strictEqual(P.poseOf({pose: {h: 30}}).h, 30, '写过的读得回来');
  assert.strictEqual(P.poseOf({}).h, undefined);
});

/* ---------- 字幕的位置：`y` ＋ `verticalAlign`（与核心同一套） ---------- */

test('哪条边钉在锚线上 → 相对自身高度位移多少', () => {
  assert.strictEqual(P.subShift('top'), 0, '顶边钉住：块从锚线往下长');
  assert.strictEqual(P.subShift('center'), -50);
  assert.strictEqual(P.subShift('bottom'), -100, '底边钉住：块从锚线往上长');
});

test('未知的对齐值当底边处理——核心那边是严格白名单，缺席不等于居中', () => {
  assert.strictEqual(P.subShift(undefined), -100);
  assert.strictEqual(P.subShift('middle'), -100, '「middle」不是核心认的名字');
});

test('锚线 y 是帧高百分比，夹在 0–100（核心 clamp_position 的同一把尺）', () => {
  assert.strictEqual(P.subClampY(86), 86);
  assert.strictEqual(P.subClampY(-12), 0);
  assert.strictEqual(P.subClampY(140), 100);
  assert.strictEqual(P.subClampY(93.44), 93.4);
});

test('拖动是纯位移——写进去多少读出来就是多少，没有「换锚点再折算」那一步', () => {
  [0, 7, 50, 86, 93, 100].forEach((y) => assert.strictEqual(P.subClampY(y), y));
});

test('三个对齐名与核心的白名单逐字相同', () => {
  assert.deepStrictEqual(P.VALIGNS, ['top', 'center', 'bottom']);
});

/* ---------- 适应 / 填满画布（第 85 轮，fit-canvas / fill-canvas） ---------- */

test('缺省摆位只有一份——菜单、画面、属性页读的是同一个 POSE0', () => {
  assert.deepStrictEqual(P.POSE0, {x: 50, y: 50, w: 20, scale: 1, rot: 0});
  assert.deepStrictEqual(P.poseOf(undefined), P.POSE0, '没写过摆位的元素也得拿到整套字段');
  assert.deepStrictEqual(P.poseOf({pose: {w: 60, flipX: true}}),
    {x: 50, y: 50, w: 60, scale: 1, rot: 0, flipX: true});
});

test('适应画布：长边贴齐、短边留边——两轴倍率取小的那个', () => {
  // 元素比画面「更高」（880×600 的盒子放进 880×495 的画面）：受高度限制
  const p = P.fitPose({w: 100, scale: 1}, {w: 880, h: 600}, {w: 880, h: 495}, 'fit');
  assert.strictEqual(p.w, 82.5, '倍率 495/600 = 0.825，宽度跟着缩');
  assert.strictEqual(p.x, 50);
  assert.strictEqual(p.y, 50, '这两件同时把元素居中');
});

test('填满画布：短边贴齐、长边裁出画面——取大的那个，允许超过 100%', () => {
  const p = P.fitPose({w: 100, scale: 1}, {w: 880, h: 600}, {w: 880, h: 495}, 'fill');
  assert.strictEqual(p.w, 100, '这一个方向本来就够宽，不用再放大');
  // 又窄又高的元素填满 16:9 会长到画面外，这正是「填满」的语义
  const q = P.fitPose({w: 20, scale: 1}, {w: 176, h: 600}, {w: 880, h: 495}, 'fill');
  assert.strictEqual(q.w, 100, '176 × 5 = 880：短边（宽）贴齐，高度溢出被裁');
});

test('倍率写回 w，`scale` 不动——手柄那一档的语义不变', () => {
  // 盒子现在占 w×scale = 80%，也就是 880 的 704px
  const p = P.fitPose({w: 40, scale: 2}, {w: 704, h: 600}, {w: 880, h: 495}, 'fit');
  // 受高度限制缩到 0.825 倍 → 显示宽 66%，除回 scale 得 w = 33
  assert.strictEqual(p.w, 33);
  assert.strictEqual(p.scale, undefined, '不写 scale，就不会把手柄调过的倍率抹掉');
});

test('量不出尺寸就返回 null——由调用方报一句实话，不是照报「已适应画布」', () => {
  assert.strictEqual(P.fitPose({w: 20}, {w: 0, h: 0}, {w: 880, h: 495}, 'fit'), null);
  assert.strictEqual(P.fitPose({w: 20}, {w: 100, h: 50}, {w: 0, h: 0}, 'fit'), null);
  assert.strictEqual(P.fitPose({w: 20}, null, {w: 880, h: 495}, 'fit'), null);
});

test('结果夹在 MIN_W 与 FIT_MAX_W 之间', () => {
  // 又高又扁的画面：适应之后宽度只剩 1.7%，夹到宽度柄的下限
  const tiny = P.fitPose({w: 20, scale: 1}, {w: 880, h: 600}, {w: 880, h: 10}, 'fit');
  assert.strictEqual(tiny.w, P.MIN_W);
  // 又矮又宽的元素填满 16:9 要放到 495%，夹到止损值
  const huge = P.fitPose({w: 20, scale: 1}, {w: 880, h: 100}, {w: 880, h: 495}, 'fill');
  assert.strictEqual(huge.w, P.FIT_MAX_W);
});

/* ---------- 锚线位置那一行（第 89.3 轮换成图标） ---------- */

test('锚线三格与核心白名单同一份键序，且每格都有图标与名字', () => {
  assert.deepStrictEqual(P.VALIGN_ITEMS.map((i) => i.k), P.VALIGNS);
  assert.deepStrictEqual(P.VALIGN_ITEMS.map((i) => i.icon),
    ['align-top', 'align-middle', 'align-bottom']);
  P.VALIGN_ITEMS.forEach((i) => {
    assert.ok(!i.label, '纯图标段不摆汉字');
    // 名字按**锚线**说话，不写「垂直对齐」：对齐是结果不是设定
    assert.ok(i.tip, i.k + ' 缺 tip');
  });
});
