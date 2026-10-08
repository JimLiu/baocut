/* 逐词渲染的**词这一侧** —— 分词、词位、块上的墨色。

   第 66 轮把动效那一摊整个搬去了 [model-subanim.js](model-subanim.js)：那边是
   17 条关键帧数据 ＋ 一个生成器，签名帧与真运动都从同一份轨上取。此前这里有一张**手写
   的取帧表**，与真运动各写一份——三次读错里有两次就是它跑偏了（卡拉OK 垫了块、落入
   停在中途）。一份数据一个来源之后，那种分叉不会再有。

   留在这里的三件都与「动效是哪一种」无关：怎么切词（中英规矩不同）、播放头落在第几个
   词上、以及块底色配什么墨色。 */
(function () {
  /* 汉字、假名与全角标点。分词与「两词之间补不补空格」都靠它判：
     汉字 / 假名直接相接、其余按词补空格——这条规则 data.js 里的段落合并也在用。
     **谚文不在里面**（2026-09-30）：韩文在空格处成词、词间补空格，和拉丁一样走
     下面的「按空白切」分支；它只在挨着汉字 / 假名 / 全角标点时不补空格。 */
  const CJK = /[㐀-鿿豈-﫿぀-ヿ　-〿＀-￯]/;
  const TAIL = /[，。、！？：；…—·》」』】）,.!?;:)\]}]/;

  /** 一句话切成词。真实实现里词是 transcript `words[]` 给的，不用切；这里切是为了
      让样例文字和演示 cue 也能有词——**切法必须确定**，原型不能每次刷新不一样。 */
  function split(text) {
    const s = String(text || '');
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      // 标点跟着前一个词走，不单独成词——它没有自己的起止
      if (TAIL.test(ch) && out.length) { out[out.length - 1] += ch; i++; continue; }
      if (CJK.test(ch)) {
        let w = ch; i++;
        if (i < s.length && CJK.test(s[i]) && !TAIL.test(s[i])) { w += s[i]; i++; }
        out.push(w);
      } else {
        let w = '';
        while (i < s.length && !/\s/.test(s[i]) && !CJK.test(s[i])) { w += s[i]; i++; }
        out.push(w);
      }
    }
    return out;
  }

  /** 两个词之间补不补空格。 */
  function joint(a, b) {
    if (!a || !b) return '';
    return CJK.test(a[a.length - 1]) || CJK.test(b[0]) ? '' : ' ';
  }

  /** 播放头落在第几个词上。`-1` = 这条 cue 还没开始，`n` = 已经念完。
      **均分是演示口径**：真实实现读 `words[]` 的起止，不是把 cue 的时长除以词数。 */
  function at(t, start, end, n) {
    if (!n) return -1;
    const dur = end - start;
    if (!(dur > 0) || t < start) return -1;
    if (t >= end) return n;
    return Math.min(n - 1, Math.floor(((t - start) / dur) * n));
  }

  /** 高亮块上的字色：块底色亮就落墨色、暗就落纸色。看不出字的高亮等于没有高亮。
      认不出的色（`var(--*)`、`rgba()`）一律当亮底处理——动画选择格里的那把默认
      accent 正是亮黄。 */
  function inkOn(color) {
    const m = /^#([0-9a-fA-F]{6})$/.exec(String(color || ''));
    if (!m) return '#131313';
    const n = parseInt(m[1], 16);
    const L = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return L > 0.6 ? '#131313' : '#FFFFFF';
  }

  window.BC_WA = {split, joint, at, inkOn};
})();
