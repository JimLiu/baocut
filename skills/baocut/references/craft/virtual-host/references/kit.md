<!-- 由 tools/sync-agent-skill.ts 从 skills/baocut/built-in-skills/virtual-host/references/kit.md 生成，不要手改：改源文件后运行 npm run build:agent-skill -->

# 主播代码包：HostKit 的画法与摆放

[`host-kit/host-kit.js`](../host-kit/host-kit.js) 拷进代码包，读 `host-pack.mjs` 写的 `window.HOST_PACK` 与 `lipsync.mjs` 写的 `window.HOST_TRACK`，每帧在一张 Canvas 2D 上画底图，再按时间贴表情、眼睛、嘴的补丁。画面只由时间决定，满足 `baocut/1` 的要求，能走指令烘焙。

## 1. 最小的包

`examples/corner-host/` 就是：`index.html` 按顺序引 `pack/host-data.js`、`host-track.js`、`host-kit.js`、`scene.js`，`scene.js` 两行：

```js
const host = HostKit.host(window.HOST_PACK, window.HOST_TRACK);
HostKit.film({ draw(ctx, t) { host.draw(ctx, t, { x: 1660, y: 1080, h: 440 }); } });
```

`HostKit.film(o)` 注册合成：id 取根元素的 `data-composition-id`（或 `o.id`），每帧清成透明再调 `o.draw(ctx, t)`，`t` 是成片的秒；`o.background` 给一个颜色时整帧不透明（这时根元素写 `data-alpha="false"`）。

## 2. `HostKit.host(pack, track, options)`

| 选项 | 说明 |
| --- | --- |
| `dir` | 图片路径的前缀，缺省 `'./'`。`host-data.js` 里的路径是 `pack/base.png` 这样，`index.html` 和 `pack/` 同级时不用改 |
| `motion` | 点头、转向、呼吸、轻晃的幅度倍数，缺省 1；0.5 收一半，0 只眨眼和换口型 |
| `idleBlink` | 时间轴以外（说话前 1 秒以前、说完 0.5 秒以后，或没给 `track`）每隔几秒眨一次眼，缺省 4，0 不眨 |

`track` 可以不给（`null`）：主播只眨眼、轻晃、不说话，用在开场或听别人说话的段落。

返回 `{ draw, shapeAt, faceAt, blinkAt, ready, missing }`。`ready` 是图片都加载完的 Promise；`missing` 收集时间轴里有、角色包里没有的表情名（第一次碰到时也会 `console.warn`）。

## 3. `host.draw(ctx, t, d)`

| 参数 | 说明 |
| --- | --- |
| `x`、`y` | 角色底边中点在画布上的位置。缺省右下角：`x` 是画布宽减去角色宽的 0.55 倍，`y` 是画布高 |
| `h` | 画出来的高度（像素），缺省底图原高。宽按比例 |
| `flip` | 左右镜像，放在左边、或两人相对时用 |
| `sink` | 底边往下藏多少，缺省高度的 4%：点头、转向时不露出底图的切边 |
| `shape` | 临时指定口型（`'A'`…`'G'`、`'X'`），盖过时间轴 |
| `face` | 临时指定表情名；`null` 不要表情；不给时按时间轴 |

返回这一帧实际画的口型字母。

角色包里缺某个口型时借最接近的：B→C、A；C→B、D、E；D→C、E、B；E→F、C、D；F→E、A；G→B、A；A→X（底图本身的嘴）。表情区间里不说话时，有和表情同名的嘴（`mouth.smile`）就用它，没有就用底图的嘴。表情补丁盖住眼睛时不眨眼。

## 4. 摆放

角色底边贴着画面下沿，切边藏在画外；`h` 按画面高度定，`host.json` 的 `scale` 按 `h` 定（底图输出的高度比 `h` 大一点就够，画面不糊、包也小）。

| 画幅 | 写法 | 说明 |
| --- | --- | --- |
| 横屏 1920×1080，右下角 | `{ x: 1660, y: 1080, h: 440 }` | 约画面高度的 40%；字幕在下方居中时让开左边的字幕区 |
| 横屏，左下角 | `{ x: 260, y: 1080, h: 440 }` | 角色略侧着身时加 `flip: true`，让身体朝向画面中间 |
| 竖屏 1080×1920，下方居中 | `{ x: 540, y: 1920, h: 700 }` | 字幕放在主播上面，别压住脸 |
| 竖屏，右下角 | `{ x: 820, y: 1920, h: 560 }` | 画面主体放上半部 |

正面像是正脸，`flip` 只是左右镜像，不会让它转头；说话时每句的朝向由时间轴给，幅度很小。

## 5. 嵌进自己的代码场景

主播是场景的一部分（整镜出镜、站在图表旁边讲）时不用 `film()`，在自己的合成里画：

```js
const W = 1920, H = 1080;
const host = HostKit.host(window.HOST_PACK, window.HOST_TRACK);
let ctx = null;
window.__baocutCompositions = window.__baocutCompositions || {};
window.__baocutCompositions['scene-2'] = {
  async initialize(context) {
    ctx = context.target.querySelector('canvas').getContext('2d');
    await host.ready;
  },
  async renderAt(time) {
    const t = Number(time.ticks) / time.timescale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawScene(ctx, t);                                  // 场景自己的画面
    host.draw(ctx, t, { x: 1400, y: 1080, h: 900 });    // 主播画在最后，压在场景上面
  },
  dispose() { ctx = null; },
};
```

`t` 是这个包自己的时间：包从配音的第几秒开始放，`lipsync.mjs` 的 `--offset` 就写配音在包里的起点（包和配音同时开始时是 0）。按段切成几个包时每段一条时间轴，用这段的配音与逐字时间算。

## 6. 两个主播

两套角色包、两条时间轴，各用自己的变量名：`host.json` 写 `"var": "HOST_A_PACK"`，`lipsync.mjs` 给 `--var HOST_A_TRACK --seed 1`，另一个是 `HOST_B_*` 与 `--seed 2`（种子不同，眨眼、点头不同步）。两人的配音各是一条从同一时刻开始的完整音轨（对方说话时这条是静音）时最省事：各自转写、各自算时间轴，对方说话时这一方闭嘴，只眨眼、轻晃。

```js
const a = HostKit.host(window.HOST_A_PACK, window.HOST_A_TRACK);
const b = HostKit.host(window.HOST_B_PACK, window.HOST_B_TRACK);
HostKit.film({ draw(ctx, t) {
  a.draw(ctx, t, { x: 300, y: 1080, h: 440, flip: true });
  b.draw(ctx, t, { x: 1620, y: 1080, h: 440 });
} });
```

两份包的图片放在不同目录（`host.json` 的 `out` 写 `pack-a`、`pack-b`）。
