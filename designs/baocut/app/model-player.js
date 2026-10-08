/* BaoCut 原型 — 全屏播放器（§11.1，第 222 轮）
   window.BC_PLAYER。纯函数，无 React、无 DOM。

   这一层管的是「观看面」的判据：chrome 什么时候该隐、进度条上的一点对应哪一秒、
   哪个键做什么、字幕四档各露哪条轨。视图（player.jsx）只负责把这些结论画出来。

   与 apps/baocut 的对应：`src/app/editor/stage/fullscreen.rs` 已经有一份镜像 Mac
   `FSFullscreenBarView` 的实现（120 = 46 + 18 + 2 + 38 + 16，钮 36，空闲 3s，淡出 130ms）。
   本原型不照抄那份几何——36 与 120 都不在 S2 的控件高度 / 间距阶梯上，照抄等于把
   AppKit 的私有数值搬进设计系统。这里按 S2 阶梯重排（钮 40/32、内边距 24、间距 8），
   **判据**（3 秒、holding、成片时钟）与 App 保持同源，差异逐条登记在 README 分歧台账第 221 条。 */
(function () {
  /* 空闲多久收起 chrome。与 App `fullscreen::IDLE_SECONDS` 同值——这是肌肉记忆里的
     数，两端不同会让人觉得「App 里刚才还在的条子怎么没了」。 */
  const IDLE_MS = 3000;
  /* 淡入淡出。App 沿用 Mac 的 130ms，本目录走 S2 的 150ms（检查器判据 E）。 */
  const FADE_MS = 150;

  /* 条子几何，全部落在 S2 的间距 / 控件阶梯上：
       上遮罩 96（标题行）· 下遮罩 160（渐变到 0.72）
       条内边距 24 · 进度行命中高 20 · 行距 8 · 控件行 40 → 条高 116 */
  const BAR_PAD = 24, SEEK_HIT = 20, ROW_GAP = 8, CTRL_H = 40;
  const BAR_H = BAR_PAD * 2 + SEEK_HIT + ROW_GAP + CTRL_H;   // 116
  const SCRIM_TOP = 96, SCRIM_BOTTOM = 160;
  /* 进度条静止 4pt、悬停/拖拽 6pt，与 App `render_seek_bar` 同则（也是 `.sl__track` 的高） */
  const TRACK_H = 4, TRACK_H_ACTIVE = 6;
  /* 悬停预览格：横片 160×90，竖片按画幅收窄（高最多 120）。预览格是「松手会落到
     哪一帧」的预告，所以它必须按项目画幅长——给竖屏片子看一格 16:9 是预告一个
     不存在的画面。 */
  const PREV_W = 160, PREV_MAX_H = 120;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /**
   * 「按住不放」的三件事：拖着进度条、开着弹层、正在拖音量。
   * 任意一件为真，空闲计时就不许收走 chrome——手还在条子上，条子却消失了，
   * 是所有播放器里最容易被骂的一种「聪明」。与 App `holding_visible` 同判据（多一项音量拖拽）。
   */
  function holdingVisible(s) {
    const o = s || {};
    return !!(o.scrubbing || o.pop || o.volDragging);
  }

  /**
   * chrome 该不该隐：**只有在播** 且 指针不在条上 且 没按住任何东西 且 空闲满 3 秒。
   * 暂停一定可见——暂停意味着用户正在看着这一帧做决定，这时候把控件收走等于藏起遥控器。
   */
  function chromeHidden(s) {
    const o = s || {};
    return !!o.playing && !o.hovering && !holdingVisible(o) && (o.idleMs || 0) >= IDLE_MS;
  }

  /** 进度比例（0–1）。时长为 0（空白项目）时恒 0，不要除出 NaN 去污染 style。 */
  function seekPct(t, dur) {
    if (!(dur > 0)) return 0;
    return clamp(t / dur, 0, 1);
  }

  /** 进度条上的横坐标 → 秒。`rect` 只用 left / width，所以测试里传裸对象即可。 */
  function timeAt(clientX, rect, dur) {
    const w = (rect && rect.width) || 0;
    if (!(w > 0) || !(dur > 0)) return 0;
    return clamp(((clientX - rect.left) / w) * dur, 0, dur);
  }

  /** 跳转步进（←/→ 5s、J/L 10s、⇧←/⇧→ 交给章节），钳在 [0, dur]。 */
  function stepTime(t, d, dur) { return clamp(t + d, 0, Math.max(0, dur || 0)); }

  /** 音量步进（↑/↓ 一档 10）。返回 0–100 整数；调用方负责顺手取消静音。 */
  function stepVolume(v, d) { return clamp(Math.round((v || 0) + d), 0, 100); }

  /** 喇叭四档，与舞台工具条同一张表（§11：0/静音 · 1–33 · 34–66 · 67–100）。 */
  function volumeIcon(v, muted) {
    return muted || !v ? 'vol0' : v <= 33 ? 'vol1' : v <= 66 ? 'vol2' : 'vol3';
  }

  /**
   * 播放键的三态：在播 → 暂停；停着且播放头已到片尾 → 重播；其余 → 播放。
   * 没有内容（时长为 0 的空时间线）无所谓片尾，显示播放。
   * `out` / `dur` 都是**成片时钟**（已剪段折掉之后），片尾留 0.05s 的余量——播放循环
   * 停在最后一帧附近，不一定恰好等于时长。全屏播放器与时间轴 transport 共用这一条。
   */
  function playButtonState(s) {
    const o = s || {};
    if (o.playing) return 'pause';
    if (!(o.dur > 0)) return 'play';
    return (o.out || 0) >= o.dur - 0.05 ? 'replay' : 'play';
  }
  /** 三态各自的图标；重播借 `refresh`（「再跑一次」那一枚）。 */
  const PLAY_ICON = {play: 'play', pause: 'pause', replay: 'refresh'};

  /* ---------- 字幕四档 ---------- */

  /**
   * 播放期的字幕选择是**视图态**，不是文档编辑：在全屏里选「只看译文」不该把
   * 原文轨在文档里标成 hidden（那会进撤销栈，也会跟着导出走）。所以这里只出一张
   * 「哪些 role 该露」的表，由 StageView 在 player 模式下临时过滤。
   *
   * 档位按**这个项目实际有的轨**生成：只有原文时不摆「双语」，那是空承诺。
   */
  function captionModes(tracks) {
    const list = (tracks || []).filter((t) => !t.hidden);
    const hasSrc = list.some((t) => t.role === 'source');
    const hasTr = list.some((t) => t.role !== 'source');
    const out = [{k: 'off', label: '关闭字幕'}];
    if (hasSrc) out.push({k: 'source', label: '原文', role: 'source'});
    if (hasTr) out.push({k: 'trans', label: '译文', role: 'trans'});
    if (hasSrc && hasTr) out.push({k: 'both', label: '双语'});
    return out;
  }

  /** 某一档下这条轨露不露。未知档位按「双语」处理（最宽），不至于把画面弄哑。 */
  function captionVisible(mode, role) {
    if (mode === 'off') return false;
    if (mode === 'source') return role === 'source';
    if (mode === 'trans') return role !== 'source';
    return true;
  }

  /** 进全屏时的默认档：文档里两条轨都在就双语，否则跟着那条在的走。 */
  function defaultCaptionMode(tracks) {
    const modes = captionModes(tracks).map((m) => m.k);
    if (modes.indexOf('both') >= 0) return 'both';
    if (modes.indexOf('source') >= 0) return 'source';
    if (modes.indexOf('trans') >= 0) return 'trans';
    return 'off';
  }

  /* ---------- 章节 ---------- */

  /** 播放头此刻在哪一章（标题行的第二段、进度条气泡的第二行都读它）。 */
  function chapterAt(chapters, t) {
    const list = chapters || [];
    for (let i = list.length - 1; i >= 0; i--) if (t >= list[i].start) return list[i];
    return list[0] || null;
  }

  /** 章节边界在进度条上的百分比。首章的 0 不画——那是轨道的起点，不是一道缝。 */
  function chapterTicks(chapters, dur) {
    if (!(dur > 0)) return [];
    return (chapters || [])
      .map((c) => c.start)
      .filter((s) => s > 0.01 && s < dur)
      .map((s) => +((s / dur) * 100).toFixed(4));
  }

  /* ---------- 键盘 ---------- */

  /**
   * 全屏时播放器**独占键盘**：编辑器那一层（删除元素、⌘C/V、方向键微调摆位）在
   * 全屏里没有可操作的对象，放它继续接只会让人在看片时误删东西。
   *
   * 返回动作名或 null。修饰键：⌘/⌃ 一律不接（留给系统与浏览器），⇧ 只用在左右键上。
   */
  function hotkey(e) {
    if (!e || e.metaKey || e.ctrlKey || e.altKey) return null;
    const k = e.key;
    const low = k && k.length === 1 ? k.toLowerCase() : k;
    if (k === ' ' || low === 'k') return 'play';
    if (k === 'Escape') return 'exit';
    if (low === 'f') return 'exit';           // 进出同一个键（进在编辑器那侧接）
    if (low === 'm') return 'mute';
    if (low === 'c') return 'captions';
    if (k === 'ArrowLeft') return e.shiftKey ? 'prev-chapter' : 'back';
    if (k === 'ArrowRight') return e.shiftKey ? 'next-chapter' : 'fwd';
    if (low === 'j') return 'back10';
    if (low === 'l') return 'fwd10';
    if (k === 'ArrowUp') return 'vol-up';
    if (k === 'ArrowDown') return 'vol-down';
    if (k === 'Home') return 'start';
    if (k === 'End') return 'end';
    if (k === '?') return 'keys';               // 这张表自己（全屏里编辑器的 ? 让了位）
    if (/^[0-9]$/.test(k)) return 'pct-' + k;   // 0–9 = 跳到 0%–90%
    return null;
  }

  /** `pct-N` → 秒。放在模型里是为了键盘表与测试共用一份换算。 */
  function pctTime(action, dur) {
    const m = /^pct-([0-9])$/.exec(action || '');
    if (!m) return null;
    return clamp((parseInt(m[1], 10) / 10) * (dur || 0), 0, dur || 0);
  }


  /**
   * 人看的那份键表。**键只有一张表**：播放器真正接的是 `hotkey`，清单弹层与
   * `docs/design/product/product-design.md` §19 都读这里，两处各写一份迟早会漂——「清单里写着、
   * 按下去没反应」是原型里最难被发现的一类假。测试逐行拿 `probe` 打进 `hotkey`
   * 核对，并反向扫一遍键盘：`hotkey` 能返回而这张表没写的动作，测试直接判红。
   *
   * `also` 是同一行里那半个方向（← 写了就不再单列 →）。
   */
  const KEYS = [
    {a: 'play', label: '播放 / 暂停（画面上单击同义）', keys: 'Space / K', probe: {key: ' '}},
    {a: 'exit', label: '退出全屏（画面上双击同义）', keys: 'Esc / F', probe: {key: 'Escape'}},
    {a: 'back', also: ['fwd'], label: '后退 / 前进 5 秒', keys: '← / →', probe: {key: 'ArrowLeft'}},
    {a: 'back10', also: ['fwd10'], label: '后退 / 前进 10 秒', keys: 'J / L', probe: {key: 'j'}},
    {a: 'prev-chapter', also: ['next-chapter'], label: '上一章 / 下一章', keys: '⇧← / ⇧→',
      probe: {key: 'ArrowLeft', shiftKey: true}},
    {a: 'vol-up', also: ['vol-down'], label: '音量 ±10（自动取消静音）', keys: '↑ / ↓', probe: {key: 'ArrowUp'}},
    {a: 'mute', label: '静音 / 取消静音', keys: 'M', probe: {key: 'm'}},
    {a: 'captions', label: '字幕档位轮转', keys: 'C', probe: {key: 'c'}},
    {a: 'start', also: ['end'], label: '跳到片头 / 片尾', keys: 'Home / End', probe: {key: 'Home'}},
    {a: 'pct', label: '跳到成片的 0% – 90%', keys: '0 – 9', probe: {key: '5'}, prefix: true},
    {a: 'keys', label: '这张表', keys: '?', probe: {key: '?'}},
  ];

  window.BC_PLAYER = {
    IDLE_MS, FADE_MS,
    BAR_PAD, SEEK_HIT, ROW_GAP, CTRL_H, BAR_H, SCRIM_TOP, SCRIM_BOTTOM,
    TRACK_H, TRACK_H_ACTIVE, PREV_W, PREV_MAX_H,
    holdingVisible, chromeHidden, playButtonState, PLAY_ICON, seekPct, timeAt, stepTime, stepVolume, volumeIcon,
    captionModes, captionVisible, defaultCaptionMode,
    chapterAt, chapterTicks, hotkey, pctTime, KEYS,
  };
})();
