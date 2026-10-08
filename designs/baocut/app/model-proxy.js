/* BaoCut 原型 — BCF 预览代理的舞台胶囊（§11.2）
   window.BC_PROXY。纯函数，无 React、无 DOM。

   背景：BCF 动画文档的预览先走实时渲染，同时在后台把当前修订烧成一段 MP4 代理
   （core `bcut-bcf-host` 的 `bcf_document/proxy.rs`），烧好之后播放改读代理。
   这段后台工作用户看不见，只有播放「变顺了」的那一刻才察觉——所以舞台左下角挂一枚
   只读胶囊「正在优化播放 · 37%」，告诉人「卡是暂时的，正在变好」。

   这一层只管判据：什么时候出现、百分比怎么算、和「上一版画面」提示怎么叠。
   视图（stage.jsx 的 StageChips）只负责按这里的结论画出来。

   三个表面的数据来路不同，判据同源：
     原型  → 「原型开关」里的静态演示状态（store.jsx `proxyDemo`）
     App   → 进程内直接查代理状态
     Web   → 轮询 `bcut serve` 的状态端点
   三者都按 1 秒刷新一次（TICK_MS）。 */
(function () {
  /* 生成要连续持续满 1 秒才露面：代理通常几百毫秒就烧好的短文档，
     闪一下就没的胶囊只会让人以为出了什么事。 */
  const SHOW_AFTER_MS = 1000;
  /* 百分比刷新节拍。逐帧刷新既没有信息量，也会让数字跳得像在倒计时。 */
  const TICK_MS = 1000;
  /* 烧完之前最多显示 99%：「100%」却还挂着，读起来像卡死。
     真正烧好时胶囊直接消失，不停留在 100%。 */
  const MAX_PCT = 99;

  const COPY = {
    zh: {optimizing: '正在优化播放', stale: '显示的是上一版能用的画面'},
    en: {optimizing: 'Optimizing playback', stale: 'Showing the last version that worked'},
  };
  /* 分隔符与标题栏任务胶囊「任务 · N%」同一个：空格 + 中点 + 空格。 */
  const SEP = ' · ';

  const copyOf = (lang) => COPY[lang === 'en' ? 'en' : 'zh'];

  /**
   * 多个来源同时在烧（一个文档引用了几段 BCF 素材）时，胶囊只有一枚：
   * 只数 status === 'generating'（排队中也算，done 记 0），帧数求和。
   * 已就绪 / 失败的来源不参与——它们已经不在「正在变好」里了。
   */
  function tally(sources) {
    let done = 0, total = 0, any = false, since = null;
    for (const s of sources || []) {
      if (!s || (s.status !== 'generating' && s.status !== 'queued')) continue;
      any = true;
      done += Math.max(0, s.done || 0);
      total += Math.max(0, s.total || 0);
      if (s.since != null && (since == null || s.since < since)) since = s.since;
    }
    return any ? {status: 'generating', since, done, total} : null;
  }

  /** 已生成帧数 / 总帧数，向下取整，封顶 99。总帧数未知或为 0 → null（不显示）。 */
  function pct(done, total) {
    if (!(total > 0)) return null;
    const p = Math.floor((Math.max(0, done || 0) / total) * 100);
    return Math.min(MAX_PCT, Math.max(0, p));
  }

  /**
   * 「从什么时候开始算在生成」。修订切换（又改了一笔）时，如果上一修订还在生成，
   * 计时接着算，不把已经露面的胶囊收回去再等 1 秒；百分比则按新修订重新算。
   * 上一状态不在生成（已就绪 / 失败 / 没有）→ 从现在重新计 1 秒门槛。
   */
  function since(prev, now) {
    const busy = prev && (prev.status === 'generating' || prev.status === 'queued');
    return busy && prev.since != null ? prev.since : now;
  }

  const busy = (st) => !!st && (st.status === 'generating' || st.status === 'queued');

  /** 胶囊此刻该不该出现。 */
  function visible(st, now) {
    if (!busy(st) || st.since == null) return false;
    if (now - st.since < SHOW_AFTER_MS) return false;
    return pct(st.done, st.total) != null;
  }

  /**
   * 还要等多久才该露面（给视图排一次性计时器用）。已经该露面、或根本不会露面 → null。
   */
  function waitMs(st, now) {
    if (!busy(st) || st.since == null) return null;
    const left = SHOW_AFTER_MS - (now - st.since);
    return left > 0 ? left : null;
  }

  function label(p, lang) {
    return copyOf(lang).optimizing + SEP + p + '%';
  }

  function staleLabel(error, lang) {
    const head = copyOf(lang).stale;
    return error ? head + SEP + error : head;
  }

  /** 单枚「正在优化播放」胶囊；不该出现 → null。 */
  function chip(st, now, lang) {
    if (!visible(st, now)) return null;
    const p = pct(st.done, st.total);
    return {key: 'optimizing', text: label(p, lang), pct: p};
  }

  /**
   * 舞台左下角的一列胶囊，**自上而下**：优化播放在上，「上一版画面」在下
   * （后者贴着 12px 底边不动，前者叠在它上面，出现与消失都不推动它）。
   * `staleError` 为 null / undefined 表示没有「上一版画面」提示。
   */
  function column(st, staleError, now, lang) {
    const out = [];
    const c = chip(st, now, lang);
    if (c) out.push(c);
    if (staleError != null) out.push({key: 'stale', text: staleLabel(staleError, lang)});
    return out;
  }

  window.BC_PROXY = {
    SHOW_AFTER_MS, TICK_MS, MAX_PCT, SEP,
    tally, pct, since, visible, waitMs, label, staleLabel, chip, column,
  };
})();
