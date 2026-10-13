/* 下载来源：可以存多个，按种类各选一个在用（2026-10-13 设计稿；对应 architecture-design §5.10 `models.downloadEndpoint` /
   `tools.downloadEndpoint`、§6.3「来源」，规格目前只有一个基址，差异见交付说明）。
   · 两种来源，地址的拼法不同，不能混用：
     models   模型仓库 —— 模型权重与大多数组件，镜像按 Hugging Face 的路径提供文件（内置 Hugging Face、ModelScope）；
     releases 发布页   —— yt-dlp 等外部工具与 LiteRT-LM 运行时、audio.cpp 引擎这类 GitHub 发布的文件，
                          镜像按「基址/名称/版本/文件名」提供（内置 GitHub）。
   · 每种来源：内置几个 + 用户添加的镜像（名字可留空，留空显示主机名），其中一个在用；删掉在用的那个退回默认。
   · 环境变量（BAOCUT_MODELS_ENDPOINT / BAOCUT_TOOLS_ENDPOINT）优先于选择，设了以后这一种只读。
   · 下载确认框按种类分组列出这次要下的部分，每组一个来源选择器，改的就是这里的「在用」。
   不碰 React、不碰 DOM，`node --test` 直接跑。 */
(function () {
  const LM = (typeof window !== 'undefined' && window.BC_LOCALMODELS) || require('./model-local-models.js');

  const KINDS = [
    {k: 'models', title: '模型仓库', env: LM.ENDPOINT_ENV, placeholder: 'https://hf-mirror.example.com',
     desc: '模型权重与大多数组件从这里下载。镜像要按 Hugging Face 的路径提供文件。',
     builtin: [
       {id: 'hf', name: 'Hugging Face', base: LM.HF_ENDPOINT, hint: '默认'},
       {id: 'ms', name: 'ModelScope', base: LM.MS_ENDPOINT, hint: '中国大陆通常更快',
        note: 'ModelScope 上没有的少数文件（whisper.cpp、GPT-SoVITS）仍从 Hugging Face 下载。'},
     ]},
    {k: 'releases', title: '工具与运行库', env: 'BAOCUT_TOOLS_ENDPOINT', placeholder: 'https://gh-mirror.example.com',
     desc: 'yt-dlp 等外部工具，以及 LiteRT-LM 运行时、audio.cpp 引擎这类从 GitHub 发布页下载的文件。镜像按「基址/名称/版本/文件名」提供。',
     builtin: [{id: 'gh', name: 'GitHub', base: 'https://github.com', hint: '官方发布页 · 默认'}]},
  ];
  const kindOf = (k) => KINDS.find((x) => x.k === k) || KINDS[0];
  const trimSlash = (v) => String(v || '').trim().replace(/\/+$/, '');
  const hostOf = (base) => { try { return new URL(base).host; } catch (e) { return trimSlash(base); } };
  const sameBase = (a, b) => trimSlash(a).toLowerCase() === trimSlash(b).toLowerCase();

  function blank() {
    const st = {};
    KINDS.forEach((x) => { st[x.k] = {active: x.builtin[0].id, mirrors: []}; });
    return st;
  }

  /** 存着的值 → 完整的状态。`legacy` 是旧的单个基址（prefs.modelsEndpoint）：没有新状态时按它认回在用的来源。 */
  function normalize(raw, legacy) {
    const st = blank();
    if (raw && typeof raw === 'object') {
      KINDS.forEach((x) => {
        const r = raw[x.k] || {};
        const mirrors = Array.isArray(r.mirrors) ? r.mirrors.filter((m) => m && m.id && m.base).map((m) => ({id: m.id, name: m.name || '', base: trimSlash(m.base)})) : [];
        const ids = x.builtin.map((b) => b.id).concat(mirrors.map((m) => m.id));
        st[x.k] = {active: ids.indexOf(r.active) >= 0 ? r.active : x.builtin[0].id, mirrors};
      });
      return st;
    }
    const id = LM.sourceOf(legacy);
    if (id === 'ms') st.models.active = 'ms';
    else if (id === 'custom') st.models = {active: 'm1', mirrors: [{id: 'm1', name: '', base: trimSlash(legacy)}]};
    return st;
  }

  /** 一种来源的全部选项：内置的在前，添加的镜像按添加顺序 */
  function list(st, k) {
    const x = kindOf(k);
    return x.builtin.map((b) => Object.assign({builtin: true, host: hostOf(b.base)}, b))
      .concat((st[k] || {mirrors: []}).mirrors.map((m) => ({id: m.id, name: m.name || hostOf(m.base), base: m.base, host: hostOf(m.base),
        hint: '镜像', builtin: false, custom: !!m.name})));
  }

  /** 这一种此刻从哪里下载：环境变量 > 选中的那个。`locked` 时入口只读 */
  function active(st, k, env) {
    const all = list(st, k);
    const e = trimSlash(env);
    if (e) {
      const hit = all.find((s) => sameBase(s.base, e));
      return {src: hit || {id: 'env', name: hostOf(e), base: e, host: hostOf(e), hint: '环境变量', builtin: false}, locked: true};
    }
    return {src: all.find((s) => s.id === st[k].active) || all[0], locked: false};
  }

  function setActive(st, k, id) {
    if (!list(st, k).some((s) => s.id === id)) return st;
    return Object.assign({}, st, {[k]: Object.assign({}, st[k], {active: id})});
  }

  /** 添加 / 编辑镜像时的问题；null 可以保存。`except` 是正在编辑的那一个（和自己重复不算） */
  function mirrorError(st, k, draft, except) {
    const base = trimSlash(draft && draft.base);
    if (!base) return '填镜像的基址';
    const bad = LM.endpointError(base);
    if (bad) return bad;
    const dup = list(st, k).find((s) => s.id !== except && sameBase(s.base, base));
    if (dup) return `和「${dup.name}」的地址重复`;
    if (String(draft.name || '').trim().length > 40) return '名字太长（最多 40 个字）';
    return null;
  }

  /** 添加一个镜像并直接改用它（加镜像多半就是为了用）；返回 {st, id}。不合规时原样返回、id 为 null */
  function addMirror(st, k, draft) {
    if (mirrorError(st, k, draft)) return {st, id: null};
    const used = st[k].mirrors.map((m) => Number(String(m.id).slice(1)) || 0);
    const id = 'm' + (Math.max(0, ...used) + 1);
    const m = {id, name: String(draft.name || '').trim(), base: trimSlash(draft.base)};
    return {st: Object.assign({}, st, {[k]: {active: id, mirrors: st[k].mirrors.concat(m)}}), id};
  }

  function updateMirror(st, k, id, draft) {
    if (mirrorError(st, k, draft, id)) return st;
    const mirrors = st[k].mirrors.map((m) => (m.id === id ? {id, name: String(draft.name || '').trim(), base: trimSlash(draft.base)} : m));
    return Object.assign({}, st, {[k]: Object.assign({}, st[k], {mirrors})});
  }

  /** 删掉一个镜像；删的是在用的那个就退回这一种的默认。`fellBack` 告诉界面要不要多说一句 */
  function removeMirror(st, k, id) {
    const x = kindOf(k);
    const was = st[k].active === id;
    const mirrors = st[k].mirrors.filter((m) => m.id !== id);
    return {st: Object.assign({}, st, {[k]: {active: was ? x.builtin[0].id : st[k].active, mirrors}}), fellBack: was ? x.builtin[0].name : null};
  }

  /* ---------- 下载确认框 ---------- */

  /** 一个部分属于哪种来源：GitHub 发布的（`release`）走发布页，其余走模型仓库 */
  const kindOfPart = (p) => (p.release ? 'releases' : 'models');

  /** 一个部分从这个来源下载时的地址（给人看的，不是逐个文件）。发布页官方是 `…/releases`，镜像是「基址/名称/版本」 */
  function partUrl(src, p) {
    if (p.release) {
      const [repo, ver] = String(p.release).split(' ');
      if (src.id === 'gh') return `https://github.com/${repo}/releases`;
      return `${trimSlash(src.base)}/${repo.split('/').pop()}/${String(ver || '').replace(/^v/, '')}`;
    }
    if (src.id === 'ms') return `${LM.MS_ENDPOINT}/models/${p.repo}`;
    return `${trimSlash(src.base)}/${p.repo}`;
  }

  /**
   * 这次下载的计划：按种类分组（顺序同 KINDS，没有的种类不出组），盘上已有的部分标 keep、不计入大小。
   * parts：[{id, name, size(MB), repo | release}]；on：id → 已在盘上。
   */
  function plan(parts, on) {
    const have = on || {};
    const groups = KINDS.map((x) => ({k: x.k, title: x.title,
      parts: parts.filter((p) => kindOfPart(p) === x.k).map((p) => Object.assign({}, p, {keep: !!have[p.id]}))}))
      .filter((g) => g.parts.length);
    groups.forEach((g) => { g.need = g.parts.filter((p) => !p.keep).reduce((s, p) => s + p.size, 0); });
    const need = groups.reduce((s, g) => s + g.need, 0);
    const kept = parts.filter((p) => have[p.id]).length;
    return {groups, need, kept, upToDate: need === 0};
  }

  /**
   * 演示下载：部分按顺序一个一个下，每个下完就存下；`failKind` 指定的那种来源下不成（原型开关）。
   * 返回 {done: [已下好的 id], failed: {id, name, host} | null}——失败不回滚前面下好的，补齐时只下缺的。
   */
  function simulate(p, srcOf, failKind) {
    const done = [];
    for (const g of p.groups) {
      for (const part of g.parts) {
        if (part.keep) continue;
        if (failKind && g.k === failKind) return {done, failed: {id: part.id, name: part.name, kind: g.k, host: srcOf(g.k).host}};
        done.push(part.id);
      }
    }
    return {done, failed: null};
  }

  /** 失败那一句：哪一部分、连的哪里；已下好的还在、补齐只下缺的 */
  function failLine(failed, doneNames) {
    const head = `${failed.name}没下成：连不上 ${failed.host}。`;
    return doneNames.length ? `${head}${doneNames.join('、')}已经下好并留着，补齐时只下缺的这一部分，可以换个来源。` : `${head}可以换个来源再试。`;
  }

  const BC_DLSRC = {KINDS, kindOf, hostOf, blank, normalize, list, active, setActive, mirrorError, addMirror, updateMirror, removeMirror,
    kindOfPart, partUrl, plan, simulate, failLine};
  if (typeof module !== 'undefined') module.exports = BC_DLSRC;
  if (typeof window !== 'undefined') Object.assign(window, {BC_DLSRC});
})();
