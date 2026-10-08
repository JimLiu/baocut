/* 智能裁剪（§15.9）纯模型：画幅换算、取景窗几何、镜头 / 关键帧、场景与本机模型需求、
   演示计划与任务文案。不碰 DOM，不依赖 React；node --test 直接 require。

   核心概念（用户视角的三个词）：
   - 重点（subject）：画面里认出来的人、白板或屏幕，位置用源画面的比例坐标（0..1）。
   - 镜头（shot）：一段时间里镜头「跟着谁」——某个重点、两人同框（split）或手动。
   - 关键帧（keyframe）：某一刻取景窗的中心与松紧；自动关键帧由镜头派生，手动关键帧
     用户拖出来，重算镜头时保留。 */
(function () {
  const RATIOS = [
    {id: '9:16', w: 9, h: 16, name: '竖屏', use: '手机全屏、短视频'},
    {id: '4:5', w: 4, h: 5, name: '竖幅', use: '图文信息流'},
    {id: '1:1', w: 1, h: 1, name: '方形', use: '信息流、头像位'},
    {id: '16:9', w: 16, h: 9, name: '横屏', use: '网页、电视'},
    {id: '4:3', w: 4, h: 3, name: '4:3', use: '课件、投影'},
    {id: '3:4', w: 3, h: 4, name: '3:4', use: '竖版海报'},
  ];

  /* 画面里有什么：决定要哪些本机模型。needs 里的键对应 MODELS。 */
  const SCENES = [
    {id: 'auto', name: '让它自己判断', desc: '先看一遍画面，认出人物和白板、屏幕，再决定跟谁', needs: ['person', 'speaker', 'content']},
    {id: 'talk', name: '一个人讲', desc: '演讲、口播、课程，镜头始终跟着这个人', needs: ['person']},
    {id: 'podcast', name: '多人对谈', desc: '播客、访谈，谁在说就切到谁，也可以同框', needs: ['person', 'speaker']},
    {id: 'board', name: '讲解加白板或屏幕', desc: '有人在写字、指屏幕时，把内容留在框里', needs: ['person', 'content']},
  ];
  const MODELS = {
    person: {id: 'vision-person', name: '人物定位', what: '找出画面里的人和脸'},
    speaker: {id: 'vision-speaker', name: '发言人判断', what: '对照声音，判断谁在说话'},
    content: {id: 'vision-content', name: '内容区域', what: '认出白板、投视频上的文字区域'},
  };
  const MULTI = [
    {id: 'switch', name: '跟着说话的人切'},
    {id: 'split', name: '两人同框'},
  ];
  const MOTIONS = [
    {id: 'smooth', name: '平滑跟随', desc: '像摄影师慢慢摇镜头'},
    {id: 'cut', name: '定点切换', desc: '每个镜头固定不动，到点直接切'},
  ];
  const ZOOM = {min: 1, max: 1.5, step: 0.05};

  const DEFAULTS = {ratio: '9:16', scene: 'auto', multi: 'switch', motion: 'smooth', zoom: 1.1, fill: 'zoom'};

  const ANALYSIS_STAGES = ['读取画面', '找重点', '规划镜头'];
  const RENDER_STAGES = ['裁剪画面', '编码', '存入素材库'];

  /* ---------- 画幅 ---------- */
  function parseRatio(id) {
    if (typeof id === 'number') return id;
    if (!id || typeof id !== 'string') return NaN;
    const m = id.trim().match(/^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/);
    if (!m) return NaN;
    const w = parseFloat(m[1]), h = parseFloat(m[2]);
    return w > 0 && h > 0 ? w / h : NaN;
  }
  function ratioOf(x) {
    const r = RATIOS.find((it) => Math.abs(it.w / it.h - x) < 0.0005);
    return r || null;
  }
  function ratioId(value) {
    const r = ratioOf(value);
    if (r) return r.id;
    if (!(value > 0)) return '';
    /* 自定义：找 1..40 内最短的整数对。 */
    let best = null;
    for (let h = 1; h <= 40; h++) {
      const w = Math.round(value * h);
      if (w < 1) continue;
      const err = Math.abs(w / h - value);
      if (!best || err < best.err - 1e-9) best = {w, h, err};
      if (err < 1e-4) break;
    }
    return best ? `${best.w}:${best.h}` : value.toFixed(2) + ':1';
  }
  function fileTag(id) { return String(id).replace(':', 'x'); }
  /* 短边 1080 的输出尺寸。 */
  function dimensions(idOrValue) {
    const ratio = parseRatio(idOrValue);
    if (!(ratio > 0)) return null;
    const w = ratio >= 1 ? Math.round(1080 * ratio / 2) * 2 : 1080;
    const h = ratio >= 1 ? 1080 : Math.round(1080 / ratio / 2) * 2;
    return {w, h, ratio, id: ratioId(ratio)};
  }
  /* 从源画幅裁到目标画幅，每一帧留下多少。 */
  function coverage(srcRatio, dstRatio) {
    if (!(srcRatio > 0) || !(dstRatio > 0)) return {axis: 'same', keep: 1, cut: 0};
    if (Math.abs(srcRatio - dstRatio) < 0.0005) return {axis: 'same', keep: 1, cut: 0};
    if (dstRatio < srcRatio) { const keep = dstRatio / srcRatio; return {axis: 'width', keep, cut: 1 - keep}; }
    const keep = srcRatio / dstRatio; return {axis: 'height', keep, cut: 1 - keep};
  }
  function coverageText(srcRatio, dstRatio) {
    const c = coverage(srcRatio, dstRatio);
    if (c.axis === 'same') return '画幅相同，只需要重新取景';
    const pct = Math.round(c.keep * 100);
    return c.axis === 'width' ? `每一帧只保留 ${pct}% 的宽度，模型决定留哪一段`
                              : `每一帧只保留 ${pct}% 的高度，模型决定留哪一段`;
  }
  /* 取景窗大小（源画面比例坐标）。zoom > 1 时窗更小、画面更紧。 */
  function windowSize(srcRatio, dstRatio, zoom) {
    const z = Math.max(ZOOM.min, Math.min(ZOOM.max, zoom || 1));
    if (dstRatio <= srcRatio) return {w: dstRatio / srcRatio / z, h: 1 / z};
    return {w: 1 / z, h: srcRatio / dstRatio / z};
  }
  function clampCenter(cx, cy, size) {
    const hx = size.w / 2, hy = size.h / 2;
    return {cx: Math.min(1 - hx, Math.max(hx, cx)), cy: Math.min(1 - hy, Math.max(hy, cy))};
  }
  /* 两人同框：竖画幅上下堆，横画幅左右并排；每半块自己的画幅。 */
  function splitLayout(dstRatio) {
    return dstRatio < 1 ? {dir: 'v', halfRatio: dstRatio * 2} : {dir: 'h', halfRatio: dstRatio / 2};
  }

  /* ---------- 重点 ---------- */
  function subjectCenter(s) {
    /* 人的构图重心偏上（脸），白板 / 屏幕取几何中心。 */
    return s.kind === 'person' ? {cx: s.x, cy: s.y - s.h * 0.14} : {cx: s.x, cy: s.y};
  }
  function subject(plan, id) { return plan.subjects.find((s) => s.id === id) || null; }
  function followName(plan, follow) {
    if (follow === 'split') return '两人同框';
    if (follow === 'manual') return '手动';
    const s = subject(plan, follow);
    return s ? s.name : follow;
  }

  /* ---------- 镜头与关键帧 ---------- */
  function sortShots(shots) { return shots.slice().sort((a, b) => a.start - b.start); }
  function shotAt(plan, t) {
    const list = sortShots(plan.shots);
    return list.find((s) => t >= s.start && t < s.end) || list[list.length - 1] || null;
  }
  function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

  /* 由镜头派生自动关键帧。手动镜头不派生；同框镜头带 split。 */
  function autoKeyframesFor(shot, plan) {
    const persons = plan.subjects.filter((s) => s.kind === 'person');
    if (shot.follow === 'manual') return [];
    if (shot.follow === 'split') {
      const a = persons[0], b = persons[1] || persons[0];
      if (!a) return [];
      const ca = subjectCenter(a), cb = subjectCenter(b);
      return [{t: shot.start, cx: (ca.cx + cb.cx) / 2, cy: (ca.cy + cb.cy) / 2, zoom: 1, shot: shot.id, auto: true,
        split: [{cx: ca.cx, cy: ca.cy}, {cx: cb.cx, cy: cb.cy}]}];
    }
    const s = subject(plan, shot.follow);
    if (!s) return [];
    const c = subjectCenter(s);
    const drift = shot.drift == null ? 0.012 : shot.drift;
    if (shot.motion === 'cut' || shot.end - shot.start < 2) return [{t: shot.start, cx: c.cx, cy: c.cy, zoom: 1, shot: shot.id, auto: true}];
    return [
      {t: shot.start, cx: c.cx - drift, cy: c.cy, zoom: 1, shot: shot.id, auto: true},
      {t: shot.end, cx: c.cx + drift, cy: c.cy, zoom: 1, shot: shot.id, auto: true},
    ];
  }
  /* 重算所有自动关键帧，手动关键帧原样保留并重新归属到所在镜头。 */
  function rebuild(plan) {
    const shots = sortShots(plan.shots);
    const manual = (plan.keyframes || []).filter((k) => !k.auto).map((k) => {
      const sh = shots.find((s) => k.t >= s.start && k.t < s.end) || shots[shots.length - 1];
      return {...k, shot: sh ? sh.id : k.shot};
    });
    const auto = [];
    shots.forEach((sh) => autoKeyframesFor(sh, plan).forEach((k) => auto.push(k)));
    const keyframes = auto.concat(manual).sort((a, b) => a.t - b.t || (a.auto ? -1 : 1));
    return {...plan, shots, keyframes};
  }
  function keyframesIn(plan, shotId) { return (plan.keyframes || []).filter((k) => k.shot === shotId); }
  function manualCount(plan, shotId) { return keyframesIn(plan, shotId).filter((k) => !k.auto).length; }
  const SNAP = 0.2;
  function keyframeAt(plan, t) {
    return (plan.keyframes || []).find((k) => !k.auto && Math.abs(k.t - t) <= SNAP) || null;
  }

  /* 某一刻的取景：在所在镜头的关键帧之间插值；定点切换不插值。 */
  function windowAt(plan, t, geom) {
    const sh = shotAt(plan, t);
    const size0 = windowSize(geom.srcRatio, geom.dstRatio, geom.zoom);
    if (!sh) return {...clampCenter(0.5, 0.5, size0), zoom: 1, ...size0, shot: null};
    const ks = keyframesIn(plan, sh.id).sort((a, b) => a.t - b.t);
    let cx = 0.5, cy = 0.5, zoom = 1, split = null;
    if (ks.length) {
      let prev = ks[0], next = null;
      for (const k of ks) { if (k.t <= t) prev = k; else { next = k; break; } }
      if (next && sh.motion !== 'cut' && next.t > prev.t) {
        const p = easeInOut((t - prev.t) / (next.t - prev.t));
        cx = prev.cx + (next.cx - prev.cx) * p; cy = prev.cy + (next.cy - prev.cy) * p;
        zoom = (prev.zoom || 1) + ((next.zoom || 1) - (prev.zoom || 1)) * p;
      } else { cx = prev.cx; cy = prev.cy; zoom = prev.zoom || 1; }
      split = prev.split || null;
    } else {
      const s = subject(plan, sh.follow);
      if (s) ({cx, cy} = subjectCenter(s));
    }
    const size = windowSize(geom.srcRatio, geom.dstRatio, geom.zoom * zoom);
    if (sh.follow === 'split' && split) {
      const lay = splitLayout(geom.dstRatio);
      const hs = windowSize(geom.srcRatio, lay.halfRatio, geom.zoom * zoom);
      return {...clampCenter(cx, cy, size), zoom, ...size, shot: sh, split: split.map((c) => ({...clampCenter(c.cx, c.cy, hs), w: hs.w, h: hs.h})), layout: lay};
    }
    return {...clampCenter(cx, cy, size), zoom, ...size, shot: sh, split: null};
  }

  /* ---------- 编辑操作（都返回新计划） ---------- */
  function setShotFollow(plan, shotId, follow) {
    return rebuild({...plan, shots: plan.shots.map((s) => s.id === shotId ? {...s, follow, edited: true} : s)});
  }
  function setShotMotion(plan, shotId, motion) {
    return rebuild({...plan, shots: plan.shots.map((s) => s.id === shotId ? {...s, motion, edited: true} : s)});
  }
  function splitShot(plan, t) {
    const sh = shotAt(plan, t);
    if (!sh || t - sh.start < 0.5 || sh.end - t < 0.5) return plan;
    const seq = Math.max(0, ...plan.shots.map((s) => Number(String(s.id).replace(/\D/g, '')) || 0)) + 1;
    const left = {...sh, end: t, edited: true}, right = {...sh, id: 's' + seq, start: t, edited: true};
    return rebuild({...plan, shots: plan.shots.filter((s) => s.id !== sh.id).concat([left, right])});
  }
  function mergeWithNext(plan, shotId) {
    const shots = sortShots(plan.shots);
    const i = shots.findIndex((s) => s.id === shotId);
    if (i < 0 || i === shots.length - 1) return plan;
    const merged = {...shots[i], end: shots[i + 1].end, edited: true};
    const rest = shots.filter((_, j) => j !== i && j !== i + 1).concat([merged]);
    const keyframes = (plan.keyframes || []).filter((k) => k.auto || k.shot !== shots[i + 1].id).concat(
      (plan.keyframes || []).filter((k) => !k.auto && k.shot === shots[i + 1].id).map((k) => ({...k, shot: merged.id})));
    return rebuild({...plan, shots: rest, keyframes});
  }
  /* 清掉这段镜头里的手动关键帧，回到自动构图。 */
  function resetShot(plan, shotId) {
    return rebuild({...plan, keyframes: (plan.keyframes || []).filter((k) => k.auto || k.shot !== shotId)});
  }
  function setKeyframe(plan, t, patch) {
    const sh = shotAt(plan, t);
    const existing = keyframeAt(plan, t);
    const base = existing || {...windowAt(plan, t, {srcRatio: 16 / 9, dstRatio: 9 / 16, zoom: 1}), t, auto: false, shot: sh ? sh.id : null};
    const next = {t: existing ? existing.t : t, cx: base.cx, cy: base.cy, zoom: base.zoom || 1, shot: sh ? sh.id : null, auto: false, ...patch};
    const keyframes = (plan.keyframes || []).filter((k) => k !== existing).concat([next]);
    return rebuild({...plan, keyframes});
  }
  function removeKeyframe(plan, t) {
    const k = keyframeAt(plan, t);
    if (!k) return plan;
    return rebuild({...plan, keyframes: plan.keyframes.filter((x) => x !== k)});
  }

  /* ---------- 检查提示 ---------- */
  function flags(plan, geom) {
    const out = [];
    const size = windowSize(geom.srcRatio, geom.dstRatio, geom.zoom || 1);
    sortShots(plan.shots).forEach((sh) => {
      if (sh.end - sh.start < 2.5 && sh.follow !== 'manual') out.push({shot: sh.id, t: sh.start, text: '镜头太短，可能闪切'});
      if (sh.conf != null && sh.conf < 0.6) out.push({shot: sh.id, t: sh.start, text: '不太确定这时谁在说'});
      const s = subject(plan, sh.follow);
      if (s && s.kind !== 'person' && (s.w > size.w + 0.02 || s.h > size.h + 0.02)) out.push({shot: sh.id, t: sh.start, text: `${s.name}比取景框宽，只留有内容的一侧`});
    });
    return out;
  }
  function summary(plan) {
    const persons = plan.subjects.filter((s) => s.kind === 'person').length;
    const boards = plan.subjects.filter((s) => s.kind !== 'person').length;
    const follows = {};
    plan.shots.forEach((s) => { follows[s.follow] = (follows[s.follow] || 0) + 1; });
    const manual = (plan.keyframes || []).filter((k) => !k.auto).length;
    return {persons, boards, shots: plan.shots.length, follows, manual, edited: plan.shots.filter((s) => s.edited).length};
  }
  function subjectsText(plan) {
    const s = summary(plan);
    const parts = [];
    if (s.persons) parts.push(`${s.persons} 位人物`);
    plan.subjects.filter((x) => x.kind !== 'person').forEach((x) => parts.push(`1 块${x.name}`));
    return parts.join('、') || '没有认出重点';
  }
  function summaryText(plan, dur) {
    return `${mmss(dur)} 里认出 ${subjectsText(plan)} · 规划了 ${plan.shots.length} 个镜头`;
  }

  /* ---------- 场景与模型 ---------- */
  function needs(scene, multi) {
    const sc = SCENES.find((s) => s.id === scene) || SCENES[0];
    let keys = sc.needs.slice();
    if (scene === 'podcast' && multi === 'split') keys = ['person'];
    return keys.map((k) => MODELS[k]);
  }
  function readiness(scene, multi, installed) {
    const list = needs(scene, multi).map((m) => ({...m, ok: !!installed(m.id)}));
    return {list, missing: list.filter((m) => !m.ok), ok: list.every((m) => m.ok)};
  }
  function sizeText(mb) {
    if (!(mb > 0)) return '';
    return mb < 1 ? `${Math.round(mb * 1000)} KB` : mb < 10 ? `${mb.toFixed(1).replace(/\.0$/, '')} MB` : `${Math.round(mb)} MB`;
  }

  /* ---------- 演示计划（确定性；原型里没有模型） ---------- */
  const PATTERNS = {
    talk: [['p1', 1]],
    podcast: [['p1', 14], ['p2', 9], ['p1', 6], ['split', 12], ['p2', 17], ['p1', 2], ['p2', 11], ['split', 9], ['p1', 13], ['p2', 7], ['p1', 10]],
    board: [['p1', 10], ['b1', 16], ['p1', 6], ['b1', 22], ['p1', 9], ['b1', 14], ['p1', 12]],
    auto: [['p1', 12], ['p2', 8], ['b1', 15], ['p1', 6], ['split', 10], ['p2', 14], ['b1', 9], ['p1', 2], ['p2', 12], ['split', 7], ['p1', 9]],
  };
  function demoSubjects(scene, names) {
    const n = names || ['林澈', '周远'];
    const p = (id, name, x) => ({id, kind: 'person', name, x, y: 0.56, w: 0.2, h: 0.7});
    if (scene === 'talk') return [{...p('p1', n[0], 0.46), w: 0.24, h: 0.78}];
    if (scene === 'podcast') return [p('p1', n[0], 0.3), p('p2', n[1], 0.7)];
    if (scene === 'board') return [p('p1', n[0], 0.26), {id: 'b1', kind: 'board', name: '白板', x: 0.66, y: 0.42, w: 0.54, h: 0.58}];
    return [p('p1', n[0], 0.24), p('p2', n[1], 0.78), {id: 'b1', kind: 'screen', name: '屏幕', x: 0.51, y: 0.36, w: 0.34, h: 0.44}];
  }
  function demoPlan(opts) {
    const o = {scene: 'auto', multi: 'switch', motion: 'smooth', start: 0, end: 60, ...opts};
    const scene = o.scene;
    const subjects = demoSubjects(scene, o.names);
    const persons = subjects.filter((s) => s.kind === 'person').length;
    let pattern = PATTERNS[scene] || PATTERNS.auto;
    if (o.multi === 'split' && persons > 1) pattern = pattern.map(([f, d]) => [f === 'p1' || f === 'p2' ? 'split' : f, d]);
    /* 相邻同一目标合并（同框改写后会出现）。 */
    const merged = [];
    pattern.forEach(([f, d]) => { const last = merged[merged.length - 1]; if (last && last[0] === f) last[1] += d; else merged.push([f, d]); });
    const total = merged.reduce((a, [, d]) => a + d, 0);
    const span = Math.max(1, o.end - o.start);
    let t = o.start;
    const shots = merged.map(([f, d], i) => {
      const len = i === merged.length - 1 ? o.end - t : Math.round(span * d / total * 10) / 10;
      const sh = {id: 's' + (i + 1), start: t, end: t + len, follow: f, motion: o.motion, reason: f === 'split' ? '两人同时在说' : f === 'b1' ? '正在往上写字' : '在说话'};
      if (i === 4 || i === 8) sh.conf = 0.55;
      t += len;
      return sh;
    });
    if (scene === 'talk') {
      /* 单人：一个镜头，按时长铺几个自动关键帧模拟讲者走动。 */
      const s = subjects[0], c = subjectCenter(s);
      const n = Math.max(2, Math.min(9, Math.round(span / 25) + 1));
      const keyframes = [];
      for (let i = 0; i < n; i++) {
        const tt = o.start + span * i / (n - 1);
        keyframes.push({t: tt, cx: c.cx + Math.sin(i * 1.7) * 0.05, cy: c.cy, zoom: 1, shot: 's1', auto: true});
      }
      return {subjects, shots: [{...shots[0], start: o.start, end: o.end}], keyframes};
    }
    return rebuild({subjects, shots, keyframes: []});
  }

  /* ---------- 任务文案 ---------- */
  function mmss(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }
  function stageAt(stages, pct) {
    const i = Math.min(stages.length - 1, Math.floor((pct || 0) / (100 / stages.length)));
    return {index: i, name: stages[i]};
  }
  function analysisActivity(pct, info) {
    const dur = info.dur || 0;
    if (pct < 34) return `读取画面 · ${mmss(dur * pct / 34)} / ${mmss(dur)}`;
    if (pct < 67) return `找重点 · 认出 ${info.subjects || '画面里的人'} · 正在判断谁在说`;
    const n = Math.max(1, Math.round((pct - 67) / 33 * (info.shots || 8)));
    return `规划镜头 · 第 ${n} 个镜头`;
  }
  function renderActivity(pct, info) {
    const dur = info.dur || 0;
    if (pct < 60) return `裁剪画面 · ${mmss(dur * pct / 60)} / ${mmss(dur)}`;
    if (pct < 92) return `编码 · ${info.dims ? `${info.dims.w} × ${info.dims.h}` : ''}`.replace(/ · $/, '');
    return '存入素材库';
  }
  function taskTitle(sourceName, ratio) { return `智能裁剪 · ${sourceName} → ${ratioId(parseRatio(ratio)) || ratio}`; }
  function outputName(sourceName, ratio, version) {
    const base = String(sourceName || 'video').replace(/\.[^.]+$/, '');
    const v = version > 1 ? ` v${version}` : '';
    return `${base} · ${fileTag(ratioId(parseRatio(ratio)) || ratio)}${v}.mp4`;
  }
  function tookText(sec) {
    const s = Math.round(sec || 0);
    return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  }

  /* ---------- 与时间轴 / 素材库的接口 ---------- */
  function sourceRatio(src) {
    if (!src) return 16 / 9;
    if (src.naturalW > 0 && src.naturalH > 0) return src.naturalW / src.naturalH;
    if (src.crop && src.crop.ratio > 0) return src.crop.ratio;
    const m = String(src.meta || '').match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/);
    if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);
    if (/1080p|720p|4k/i.test(src.meta || '')) return 16 / 9;
    return 16 / 9;
  }
  function rangeFromInstance(el) {
    if (!el) return null;
    const rate = el.rate || 1;
    const start = el.srcStart || 0;
    return {start, end: start + (el.end - el.start) * rate};
  }
  /* 输出素材记录：和普通视频一样进 Video，多一个 crop 描述（时间与原片对齐）。 */
  function outputRecord(o) {
    const dims = dimensions(o.ratio);
    const dur = o.range.end - o.range.start;
    return {
      id: o.id, kind: 'video',
      name: outputName(o.source.name, o.ratio, o.version),
      meta: `${dims.w} × ${dims.h} · ${mmss(dur)} · 智能裁剪`,
      dur, grad: o.source.grad, poster: o.source.poster,
      naturalW: dims.w, naturalH: dims.h,
      crop: {
        sourceId: o.source.id, sourceName: o.source.name, sourceUrl: o.source.url || null,
        srcRatio: sourceRatio(o.source), ratio: dims.ratio, ratioId: dims.id,
        range: {start: o.range.start, end: o.range.end},
        scene: o.scene, multi: o.multi, motion: o.motion, zoom: o.zoom, fill: o.fill,
        plan: o.plan, version: o.version || 1, took: o.took || 0,
      },
    };
  }

  const api = {
    RATIOS, SCENES, MODELS, MULTI, MOTIONS, ZOOM, DEFAULTS, ANALYSIS_STAGES, RENDER_STAGES,
    parseRatio, ratioOf, ratioId, fileTag, dimensions, coverage, coverageText, windowSize, clampCenter, splitLayout,
    subjectCenter, subject, followName,
    shotAt, rebuild, keyframesIn, manualCount, keyframeAt, windowAt,
    setShotFollow, setShotMotion, splitShot, mergeWithNext, resetShot, setKeyframe, removeKeyframe,
    flags, summary, subjectsText, summaryText,
    needs, readiness, sizeText,
    demoPlan, demoSubjects,
    mmss, stageAt, analysisActivity, renderActivity, taskTitle, outputName, tookText,
    sourceRatio, rangeFromInstance, outputRecord,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.BC_CROP = api;
})();
