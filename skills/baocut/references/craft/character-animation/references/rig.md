<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/character-animation/references/rig.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 绑定库 API

写场景代码时读。[`rig-kit/rig-kit.js`](../rig-kit/rig-kit.js) 拷进代码包，全局得到 `window.RigKit`（下面写作 `R`）。最小可运行的包在 `examples/mini-film/`。

## 骨架

```js
const R = window.RigKit;
R.style({ font: '800 %px Title', ink: '#2b2d42', accent: '#d62828', paper: '#ffffff' });
R.assets(window.RIG);          // cutout.mjs 写的 rig-data.js
R.voice(window.WORDS);         // [{ w, t0, t1 }]，这段内的秒数
R.film({ end: 12.4, build() {
  const sign = R.typed(R.board('lab'), 'KARLSRUHE', R.cue('in karlsruhe', { word: 1 }));
  R.shot('lab', 0, (t0, t1) => t => {
    R.camera(t, t0, t1, { x0: 700, x1: 860 });
    R.plate('lab');
    sign(t);
    R.actor('ann', t, { x: 880, y: 1030, h: 680 });
  });
} });
```

`build` 里算好时刻与文字，返回的函数只由 `t` 决定（不用 `Math.random`、`Date.now`，要随机用 `R.hash(n)`）。`W`、`H`、帧率取自根元素的 `data-*`。

## 时间

| 函数 | 用法 |
| --- | --- |
| `R.cue(phrase, { nth, word, offset })` | 这句话开口的时刻。按字母匹配，任何语言都行。说了不止一次必须给 `nth`（从 1 起）；`word` 取这句话里第几个词（从 0 起，负数从末尾数） |
| `R.cueEnd(phrase, o)` | 这句话结束的时刻 |
| `R.shot(id, t0, init)` | 注册一镜。`init(t0, t1)` 返回 `(t, ctx) => {}`。第一镜从 0 开始 |
| `R.wipe(t, { shape, color, dur, seed })` | 转场盖住 `t`。`shape`：`splat`、`iris`、`bars` |
| `R.E(name, t)` | 记一个音效事件。`typed`、`cross`、`tag`、`wipe` 会自己记 |

## 相机与场景

- `R.camera(t, t0, t1, { z0, z1, x0, x1, y0, y1, floor })`：这一镜的相机，底图和上面的东西共用同一个变换。自动夹在底图边缘内，`floor` 保证脚不出画。缺省缩放 1.03→1.06。
- `R.plate(name)`：铺满画布。`R.board(name, i)`：底图上第 i 块空白牌子的世界坐标矩形。
- `R.screen()`：回到屏幕坐标，贴屏幕的东西用。

## 角色

`R.actor(name, t, o)`：`x`、`y`（脚下）、`h`（身高）、`flip`、`lift`（抬高，配 `R.hop`）、`sq`（挤压，配 `R.squash`）、`headRot`、`seed`（不同角色给不同的值，眨眼才不同步）、`blink: false`、`draw: true`（手部件涂写）、`l`、`r`（两只手臂）。

手臂是 sprite 自己的左右：翻转后 `l` 在屏幕右边。`undefined` 是自然下垂、轻轻晃。

| 写法 | 含义 | 用在 |
| --- | --- | --- |
| `{ aim: [wx, wy] }` | 朝世界里的一点指，抬手角度有上限，不会碰到头；`reach` 伸多长 | 指向牌子、地图、别的角色 |
| `{ at: [angle, reach] }` | 相对肩膀：0 朝外平伸，负数朝上；`reach` 是手臂长度的比例 | 举东西、欢呼、摊手、叉腰（`[1.5, 0.5]`）。跳起来时手跟着身体走 |
| `{ x, y }` | 世界坐标 | 手要碰场景里的东西 |

都可再带 `pose`（`open`、`point`、`fist`）、`hold: { name, h, rot, up, side }`（拿着 prop，`up` 是物体相对手往上挪多少倍高度：托底 0.5、抓柄 0.3）、`front: true`（画在头前面，比如往嘴里送）。

`R.swing(t, at, A, B, d = 0.16)` 从 A 平滑换到 B，任何姿势切换都用它，`A`、`B` 可以是 `undefined`（下垂）。

- 肘部朝向由 `armSolve` 自动选：抬起时朝下，下垂时朝外。
- 换手：目标跑到身体另一侧时，一只手 `swing` 回下垂，另一只手 `swing` 上去。
- `R.walker(name, t, { x, y, h, flip, phase })`，`phase = R.walkPhase(name, h, 走过的距离)`，脚就不打滑。
- `R.sprite(name, { sleeve, face, edge, hand_, arm: { upper, lower, thick } })` 覆盖颜色和比例。`edge: false` 不画袖子边线；`hand_`：`mitten`、`paw` 或函数 `(g, pose, r, skin)`。

## 世界里的字与记号

- `R.typed(rect, text, t0, { size, cps, font, color, pad, hx, vy, silent })`：逐字落在矩形里，放不下自动缩小（缩得太小 `rig-check` 会报）。要多行就写 `\n`。在 `build` 里调用，返回 `draw(t)`，在镜头函数里调。
- `R.cross(rect, t0)` 打叉，`R.check(rect, t0)` 打勾，`R.ring(rect, t0)` 画圈。都返回 `draw(t)`。
- `R.tag(text, t0, { x, y, w, h, icon })`：贴屏幕的小卡，`icon`：`calendar`、`pin`、函数或 `null`。
- `R.backdrop.puffs(base, light)`、`.gears(...)`、`.rays(...)` 返回 `draw(t)`，配 `R.typed` 做全屏大标题。

## 出场与反应

`R.spring(age, w, d)`、`R.squash(age, amp)`、`R.hop(t, t0, dur, ht)`、`R.fall(t, t0, from, dur)`（掉下来落在 t0）、`R.roll(t, t0, t1, to)`（读数滚动）、`R.puff(x, y, t, t0, r, seed)`、`R.pop('!', x, y, t, t0, { life, size })`、`R.prop(name, x, y, h, { sq, rot, flip, s })`（`y` 是底部）。

## 打包

- 包里放：`index.html`、`rig-kit.js`、`rig-data.js`、`img/`、`scene.js`、`fonts/`（TTF 或 OTF）。
- 全片可以是一个包。很长的片子按大段落分几个包，改一段只重做那一段，每包的 `R.voice` 时间从这段开头算。
- 走 `production-scripts` 时把 `rig-kit.js`、`rig-data.js` 放进 `shared/`，`img/` 放进 `bundle.pick` 或 `bundle.keep`。
- `blur` 见 `SKILL.md` 第 3 节，默认 1。
