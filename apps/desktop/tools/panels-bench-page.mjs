// 面板基准（`tools/panels-bench.mjs`）在页面里跑的部分：宿主桥（代替 Electron 的预加载脚本）、量具函数，以及一次新载入里的整套测量。
// 宿主桥与量具都由 CDP 的 `Page.addScriptToEvaluateOnNewDocument` 在页面脚本之前注入（不受页面 CSP 的 `script-src 'self'` 限制）；
// 测量的每一步用 `Runtime.evaluate` 发进页面，在页面里等完再取结果。

/**
 * 宿主桥：形状与 `src/preload/index.ts` 一致。连接取隔离 Runtime 的端点与令牌；选文件、打开网址之类都是无害的空实现，
 * 更新的 `get` 永不返回（与 `bench:preview` 一样不查更新），订阅返回空的取消函数。
 */
export function hostBridgeSource(connection, platform) {
  return `(() => {
  const connection = ${JSON.stringify(connection)};
  const never = () => new Promise(() => {});
  const none = () => {};
  window.baocut = {
    platform: ${JSON.stringify(platform)},
    getConnection: async () => ({ endpoint: connection.endpoint, token: connection.token }),
    pickDirectory: async () => null,
    pickMediaFiles: async () => [],
    pathForFile: () => '',
    revealPath: async () => {},
    web: {
      create: async () => 'bench-web',
      navigate: async (_id, url) => ({ ok: true, url }),
      back: none, forward: none, reload: none, stop: none, setZoom: none, setBounds: none, setVisible: none, destroy: none,
      onState: () => none,
      clearData: async () => {},
    },
    updates: {
      get: never,
      onState: () => none,
      onNotice: () => none,
      configure: none,
      check: async () => {}, download: async () => {}, cancel: async () => {}, install: async () => {}, openDownloadPage: async () => {},
    },
    openExternal: async () => {},
    pickFiles: async () => [],
    pickSavePath: async () => null,
  };
})();`;
}

/**
 * 量具（在页面里求值）。心跳都用 MessageChannel，不受 setTimeout 的节流影响：
 * - `__measure(fn)`：在一个新任务里调 fn，等主线程安静 1.5 秒；longest 是 longtask 的最长（只报 ≥ 50 ms 的任务，没有时为 0），
 *   maxGap 是细心跳（间隔 > 8 ms 就记）测到的最长一段占用（含排版绘制），total 是粗心跳（> 50 ms）的总占用。
 * - `__frames(el, axis, px, frames)`：rAF 每帧滚 px 像素，到头折返，返回帧间隔。
 * - `__mountedList()` / `__mountedTl()`：当前列表与时间线挂了多少行、件、剪口带与元素，以及视口大小。
 */
export function installHelpers() {
  window.__sleep = (ms) =>
    new Promise((resolve) => {
      const end = performance.now() + ms;
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        if (performance.now() >= end) resolve();
        else ch.port2.postMessage(0);
      };
      ch.port2.postMessage(0);
    });
  window.__lt = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__lt.push(Math.round(entry.duration));
  }).observe({ type: 'longtask' });
  window.__tl = () => document.querySelector('[aria-label="时间线"]');
  window.__key = (key, opts) => {
    window.__tl().dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        code: opts.code,
        metaKey: !!opts.meta,
        altKey: !!opts.alt,
        ctrlKey: !!opts.ctrl,
        shiftKey: !!opts.shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  window.__snap = () => {
    const tl = window.__tl();
    const sc = tl.querySelector('.bc-scroll');
    return {
      nodes: tl.querySelectorAll('*').length,
      clips: tl.querySelectorAll('.bc-clip').length,
      bands: tl.querySelectorAll('.bc-cut-band').length,
      scroll: Math.round(sc.scrollLeft),
      width: sc.scrollWidth,
    };
  };
  window.__task = (fn) =>
    new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        fn();
        resolve();
      };
      ch.port2.postMessage(0);
    });
  // 时间线的缩放快捷键：⌘⌥1 整片入镜、⌘0 回 100%、⌘= 放大一级、⌘- 缩小一级。
  window.__z = {
    fit: () => window.__key('1', { code: 'Digit1', meta: true, alt: true }),
    z100: () => window.__key('0', { code: 'Digit0', meta: true }),
    zin: () => window.__key('=', { code: 'Equal', meta: true }),
    zout: () => window.__key('-', { code: 'Minus', meta: true }),
  };
  const heartbeat = (threshold) => {
    const gaps = [];
    let prev = performance.now();
    let stop = false;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      const now = performance.now();
      if (now - prev > threshold) gaps.push(threshold > 8 ? Math.round(now - prev) : now - prev);
      prev = now;
      if (!stop) ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
    return {
      gaps,
      end: () => {
        stop = true;
        return gaps;
      },
    };
  };
  // 粗心跳（> 50 ms）只用来判断「安静下来了」；细心跳（> 8 ms）量最长的一段占用。
  window.__hb = () => heartbeat(50);
  window.__fine = () => heartbeat(8);
  window.__quiet = async (hb) => {
    let quiet = performance.now();
    let n = -1;
    while (performance.now() - quiet < 1500) {
      await window.__sleep(100);
      if (hb.gaps.length !== n) {
        n = hb.gaps.length;
        quiet = performance.now();
      }
    }
    return hb.end();
  };
  window.__run = async (fn) => {
    const hb = window.__hb();
    await window.__sleep(200);
    hb.gaps.length = 0;
    await window.__task(fn);
    const gaps = await window.__quiet(hb);
    return { blocked: gaps, total: gaps.reduce((a, b) => a + b, 0), ...window.__snap() };
  };
  window.__measure = async (fn) => {
    const hb = window.__hb();
    const fine = window.__fine();
    await window.__sleep(200);
    hb.gaps.length = 0;
    fine.gaps.length = 0;
    window.__lt.length = 0;
    await window.__task(fn);
    const gaps = await window.__quiet(hb);
    const f = fine.end();
    return {
      longest: Math.max(0, ...window.__lt),
      maxGap: Math.round(Math.max(0, ...f)),
      total: gaps.reduce((a, b) => a + b, 0),
      tasks: window.__lt.length,
    };
  };
  // 在 Space 里按名字打开视频（列表的行以名字开头），等时间线出来、主线程安静下来。
  window.__open = async (name) => {
    [...document.querySelectorAll('button')]
      .find((b) => b.getAttribute('aria-label') === 'Space' || b.textContent.trim() === 'Space')
      ?.click();
    await window.__sleep(1500);
    const row = [...document.querySelectorAll('[role="row"]')].find((r) => r.textContent.startsWith(name));
    if (!row) throw new Error(`Space 里没有 ${name}`);
    row.focus();
    await window.__sleep(300);
    window.__lt.length = 0;
    const hb = window.__hb();
    for (const type of ['keydown', 'keyup'])
      row.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    for (let i = 0; i < 60 && !window.__tl(); i++) await window.__sleep(250);
    const gaps = await window.__quiet(hb);
    return { total: gaps.reduce((a, b) => a + b, 0), lt: [...window.__lt] };
  };
  window.__btn = (label) => {
    const b = [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === label);
    if (!b) throw new Error(`没有按钮 ${label}`);
    return b;
  };
  window.__byText = (text) => {
    const b = [...document.querySelectorAll('[role=radio],button,label')].find((el) => el.textContent.trim() === text);
    if (!b) throw new Error(`没有 ${text}`);
    return b;
  };
  window.__scroller = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) return e;
    }
    return null;
  };
  window.__list = () =>
    [...document.querySelectorAll('[role=list]')].find(
      (l) => l.querySelector('[role=listitem][aria-setsize]') && l.getBoundingClientRect().width > 0,
    );
  window.__frames = (el, axis, px, frames) =>
    new Promise((resolve) => {
      const prop = axis === 'x' ? 'scrollLeft' : 'scrollTop';
      const max = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      let dir = 1;
      const ts = [];
      const step = (t) => {
        ts.push(t);
        if (ts.length > frames) {
          resolve(ts.slice(1).map((v, i) => v - ts[i]));
          return;
        }
        let next = el[prop] + dir * px;
        if (next >= max || next <= 0) {
          dir = -dir;
          next = el[prop] + dir * px;
        }
        el[prop] = next;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  window.__stats = (d) => {
    const s = [...d].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return {
      n: s.length,
      p50: +q(0.5).toFixed(1),
      p95: +q(0.95).toFixed(1),
      max: +s[s.length - 1].toFixed(1),
      over50: s.filter((v) => v > 50).length,
    };
  };
  window.__mountedList = () => {
    const list = window.__list();
    const sc = window.__scroller(list);
    return {
      rows: list.querySelectorAll('[role=listitem]').length,
      setsize: Number(list.querySelector('[role=listitem]').getAttribute('aria-setsize')),
      elements: list.querySelectorAll('*').length,
      viewportH: sc.clientHeight,
      viewportW: sc.clientWidth,
      scrollH: sc.scrollHeight,
    };
  };
  window.__mountedTl = () => {
    const tl = window.__tl();
    const sc = tl.querySelector('.bc-scroll');
    return {
      clips: tl.querySelectorAll('.bc-clip').length,
      bands: tl.querySelectorAll('.bc-cut-band').length,
      elements: tl.querySelectorAll('*').length,
      viewportW: sc.clientWidth,
      viewportH: sc.clientHeight,
      scrollW: sc.scrollWidth,
    };
  };
  // 查找条上「第几 / 共几」的共几；没有命中时不显示，记 0。
  window.__hits = (find) => {
    let e = find;
    for (let i = 0; i < 5; i++) e = e.parentElement;
    const m = e.innerText.match(/\d+ \/ (\d+)/);
    return m ? Number(m[1]) : 0;
  };
  window.__setInput = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
}

/**
 * 一次新载入的整套测量（页面已经导航、宿主桥与量具已注入）：打开视频、热身后量页签切换、各列表与时间线连续滚动的帧间隔、
 * 各面板挂载数、字幕全部替换与撤销、时间线缩放一步与整片入镜。`page` 给 `ev(表达式)`（在页面里的 async 函数体）与 `sleep(ms)`。
 */
export async function runSuite(page, { video, px = 40, fast = 200, frames = 240, log = () => {} }) {
  const ev = (body) => page.ev(body);
  const J = async (body) => JSON.parse(await ev(body));
  const result = { px, fast, frames };

  // 打开：等界面出来（Space 按钮），再在 Space 里打开视频，等时间线出来。
  await page.sleep(5000);
  await ev(
    `for (let i = 0; i < 480 && ![...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Space' || b.textContent.trim() === 'Space'); i++) await window.__sleep(250);
     await window.__sleep(1500); return 1`,
  );
  result.open = await J(
    `const r = await window.__open(${JSON.stringify(video)}); for (let i = 0; i < 3000 && !window.__tl(); i++) await window.__sleep(100);
     if (!window.__tl()) throw new Error('时间线没有出来'); return JSON.stringify({ total: r.total, sheets: document.styleSheets.length })`,
  );
  await page.sleep(3000);

  // 浮层与侧栏：会话浮层最小化，Space 侧栏收起，编辑区宽一些（两档一致）。
  await ev(
    `for (const l of ['最小化', '隐藏侧边栏']) [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === l)?.click(); await window.__sleep(1500); return 1`,
  );
  result.window = await J(`return JSON.stringify({ innerW: innerWidth, innerH: innerHeight })`);

  // 侧栏与列表模式都是 radio：已选中的再点会收起面板，只点没选中的。
  const rail = (label) => `{ const b = window.__btn(${JSON.stringify(label)}); if (b.getAttribute('aria-checked') !== 'true') b.click(); }`;
  const mode = (text) =>
    `{ const b = window.__byText(${JSON.stringify(text)}); if (b.getAttribute('aria-checked') !== 'true') b.click(); }`;
  const go = (expr) => ev(`${expr}; await window.__sleep(800); return 1`);

  // 热身：每个面板与模式走一遍、各滚一下（生产构建按需载入的块在这里载完）。
  for (const step of [rail('字幕'), mode('原文 ＋ 译文'), mode('只看原文'), rail('元素'), rail('文稿'), rail('字幕')]) await go(step);
  for (const step of [rail('文稿'), rail('字幕'), mode('原文 ＋ 译文')]) {
    await go(step);
    await ev(
      `const sc = window.__scroller(window.__list()); await window.__frames(sc, 'y', ${px}, 60); sc.scrollTop = 0; await window.__sleep(300); return 1`,
    );
  }
  await go(mode('只看原文'));
  await go(rail('文稿'));

  // 页签切换：四种状态（文稿、字幕＝只看原文、译文＝原文＋译文、元素）之间的 12 个有序对，两轮。
  const pairs = [
    ['transcript-to-captions', rail('字幕')],
    ['captions-to-translation', mode('原文 ＋ 译文')],
    ['translation-to-transcript', rail('文稿')],
    ['transcript-to-translation', rail('字幕')],
    ['translation-to-elements', rail('元素')],
    ['elements-to-translation', rail('字幕')],
    ['translation-to-captions', mode('只看原文')],
    ['captions-to-elements', rail('元素')],
    ['elements-to-captions', rail('字幕')],
    ['captions-to-transcript', rail('文稿')],
    ['transcript-to-elements', rail('元素')],
    ['elements-to-transcript', rail('文稿')],
  ];
  result.tabs = {};
  for (let round = 0; round < 2; round++) {
    for (const [name, expr] of pairs) {
      (result.tabs[name] ??= []).push(await J(`return JSON.stringify(await window.__measure(() => ${expr}))`));
      await page.sleep(300);
    }
  }
  log('页签切换');

  // 列表：连续滚动的帧间隔（从 20% 处起，每帧 px 像素，先热身 60 帧；再按每帧 fast 像素快甩），再滚到 50% 处数挂载。
  result.lists = {};
  for (const [name, steps] of [
    ['transcript', [rail('文稿')]],
    ['captions', [rail('字幕'), mode('只看原文')]],
    ['translation', [rail('字幕'), mode('原文 ＋ 译文')]],
  ]) {
    for (const step of steps) await go(step);
    result.lists[name] = await J(
      `const sc = window.__scroller(window.__list()); sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * 0.2; await window.__sleep(800);
       await window.__frames(sc, 'y', ${px}, 60); await window.__sleep(500);
       const d = await window.__frames(sc, 'y', ${px}, ${frames}); await window.__sleep(500);
       const f = await window.__frames(sc, 'y', ${fast}, ${frames}); await window.__sleep(500);
       sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * 0.5; await window.__sleep(1000);
       return JSON.stringify({ scroll: window.__stats(d), fast: window.__stats(f), mounted: window.__mountedList() })`,
    );
  }
  log('列表滚动');
  await go(mode('只看原文'));

  // 字幕全部替换与撤销：查 marker、替换为 beacon，三轮（每轮撤销后回到原状）。
  await go(`window.__btn('查找和替换').click()`);
  result.replace = [];
  for (let i = 0; i < 3; i++) {
    result.replace.push(
      await J(
        `const find = document.querySelector('input[placeholder="在字幕里查找"]'); window.__setInput(find, 'marker'); await window.__sleep(1500);
         const rep = document.querySelector('input[placeholder="替换为"]'); window.__setInput(rep, 'beacon'); await window.__sleep(800);
         const hits = window.__hits(find);
         const before = window.__mountedList().rows;
         const all = await window.__measure(() => window.__byText('全部替换').click()); await window.__sleep(1000);
         const after = window.__hits(find);
         const undo = await window.__measure(() => window.__btn('撤销').click()); await window.__sleep(1500);
         const restored = window.__hits(find);
         return JSON.stringify({ hits, hitsAfterReplace: after, hitsAfterUndo: restored, replaceAll: all, undo, rowsMounted: before })`,
      ),
    );
  }
  log('全部替换');

  // 时间线：100% 时居中的挂载；缩放一步（100% → ⌘= → ⌘-）与整片入镜各三次；最大缩放（连按 ⌘= 到宽度不再变）所需步数；
  // 最大缩放与 100% 下的连续横向滚动（之后滚到 50% 处数挂载）。
  const z100 = () => ev(`await window.__run(window.__z.z100); await window.__sleep(800); return 1`);
  const zoomStep = (fn) =>
    J(
      `const sc = window.__tl().querySelector('.bc-scroll'); const w0 = sc.scrollWidth; const r = await window.__measure(window.__z.${fn});
       return JSON.stringify({ ...r, w0, w1: sc.scrollWidth, clips: window.__mountedTl().clips })`,
    );
  await ev(
    `await window.__run(window.__z.z100); const sc = window.__tl().querySelector('.bc-scroll'); sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2; await window.__sleep(1500); return 1`,
  );
  result.timeline = { mounted100: await J(`return JSON.stringify(window.__mountedTl())`), zoomIn: [], zoomOut: [], fit: [] };
  for (let i = 0; i < 3; i++) {
    await z100();
    result.timeline.zoomIn.push(await zoomStep('zin'));
    await page.sleep(800);
    result.timeline.zoomOut.push(await zoomStep('zout'));
    await page.sleep(800);
    result.timeline.fit.push(
      await J(`const r = await window.__measure(window.__z.fit); return JSON.stringify({ ...r, ...window.__mountedTl() })`),
    );
    await page.sleep(800);
  }
  log('缩放与整片入镜');
  await z100();
  result.timeline.maxSteps = await J(
    `const sc = window.__tl().querySelector('.bc-scroll'); let n = 0;
     for (; n < 20; n++) { const w = sc.scrollWidth; await window.__run(window.__z.zin); if (sc.scrollWidth === w) break; }
     return JSON.stringify(n)`,
  );
  for (const [name, back100] of [
    ['max', false],
    ['100%', true],
  ]) {
    if (back100) await z100();
    result.timeline[`scroll ${name}`] = await J(
      `const sc = window.__tl().querySelector('.bc-scroll'); sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) * 0.3; await window.__sleep(1000);
       await window.__frames(sc, 'x', ${px}, 60); await window.__sleep(500);
       const d = await window.__frames(sc, 'x', ${px}, ${frames}); await window.__sleep(500);
       const f = await window.__frames(sc, 'x', ${fast}, ${frames}); await window.__sleep(800);
       sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) * 0.5; await window.__sleep(1500);
       return JSON.stringify({ scroll: window.__stats(d), fast: window.__stats(f), mounted: window.__mountedTl() })`,
    );
  }
  log('时间线滚动');
  return result;
}
