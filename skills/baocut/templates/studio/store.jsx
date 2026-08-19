// BaoCut Subtitle Studio — app store (bcut 项目运行时版).
//
// 数据流（见项目 STUDIO.md / skill references/studio.md）：
//   studio/data.json  — CLI 从 transcript.json 派生，rev 变化即热更新。
//   studio/edits.json — Agent 请求、样式与旧版待应用覆盖层。
//   __bcut/transcript/apply — 页面正文/译文/时间/拆并的唯一 CAS 历史事务。
//   __bcut/media      — 项目媒体流（Range 拖动）。
//
// 覆盖层条目携带 base 值：Agent 的 data.json 追上（或偏离）base 后该条目自动失效，
// 由 Agent 的 apply 脚本统一清理 —— 页面从不删除服务端数据。
(() => {
const { useState, useEffect, useRef, useContext, useCallback, useMemo, createContext } = React;
const { toast } = window;
const T = window.BCS_TIMELINE;
const TR = window.BCS_TRANSPORT;  // tab → 样式上下文（transport.js styleCtx）
const PS = window.BCS_PROGRESS;   // 任务状态投影（progress-status.js）
const TP = window.BCS_TRANSLATION_PARAGRAPH;
const SCE = window.BCS_SOURCE_CUE_EDIT;
const SPE = window.BCS_SOURCE_PARAGRAPH_EDIT;
const SNE = window.BCS_SPEAKER_NAME_EDIT;
const CTE = window.BCS_CHAPTER_TITLE_EDIT;
const PANELS = window.BCS_PANELS;   // 外壳面板状态（panels.js）
const ELEMENT_ACTIONS = window.BCS_ELEMENT_ACTIONS;   // 叠加元素动作（element-actions.jsx）
const ET = window.BCS_ELEMENT_TIME;                   // 元素窗口/补丁语义（element-time.js）

const DATA_URL = 'studio/data.json';
const EDITS_FILE = 'studio/edits.json';
const HEALTHZ_URL = '/__bcut/healthz';
const WS_PATH = '/__bcut/ws';
const PUT_URL = '__bcut/put';
const TRANSCRIPT_APPLY_URL = '__bcut/transcript/apply';
const TIMELINE_APPLY_URL = '__bcut/timeline/apply';
const UNDO_URL = '__bcut/undo';
const REDO_URL = '__bcut/redo';
const LS_TIME = 'bcs:playhead';     // 播放头是观看状态而非编辑，留在 localStorage
// v0.3：trans 通道键分两形——"s-…#N" = 对齐片（piece）文本编辑；"s-…" =
// 整句译文改写（sentence，改写后该句降级整句上屏、待 Agent 重切）。
const EMPTY_OV = {
  edits: {}, trans: {}, timing: {}, struct: null, transStruct: null,
  style: null, requests: [],
};

const lsGet = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 写事务的传输层重试（apply-fetch.js；与 Mac / GPUI 客户端同款语义）：serve
// 被接管/重启的瞬间 fetch 会直接抛 TypeError，这不是对这笔写的裁决，先重试
// 再报「保存失败」。服务端给了状态码（含 409/413）都是最终答复，不重发。
const fetchApply = window.BCS_APPLY_FETCH.fetchApply;

// ---------- overlay merge（纯函数：不匹配的条目忽略，不在页面侧删除） ----------
function applyOverlays(data, ov) {
  const doc = JSON.parse(JSON.stringify(data));
  const edits = (ov && ov.edits) || {};
  const timing = (ov && ov.timing) || {};
  const struct = (ov && ov.struct) || null;

  // 结构操作（拆分/合并）只对发起时的 rev 重放（只动源文轨；译文轨由
  // sentences/transCues 表达，apply 后随 Agent 重同步）
  if (struct && struct.baseRev === data.rev && Array.isArray(struct.ops)) {
    struct.ops.forEach((op) => {
      const i = doc.cues.findIndex((c) => c.id === op.id);
      if (i < 0) return;
      if (op.kind === 'split') {
        const c = doc.cues[i];
        if (c.text !== op.baseText) return;
        const frac = Math.min(0.9, Math.max(0.1, op.offset / Math.max(1, c.text.length)));
        const mid = c.start + (c.end - c.start) * frac;
        const a = { ...c, id: c.id + 'a', end: mid, text: op.textA };
        const b = { ...c, id: c.id + 'b', start: mid, text: op.textB };
        delete a.words;
        delete b.words;
        doc.cues.splice(i, 1, a, b);
      } else if (op.kind === 'merge' && i > 0) {
        const p = doc.cues[i - 1], c = doc.cues[i];
        if (p.sp !== c.sp) return;
        p.end = c.end;
        p.text = (p.text + ' ' + c.text).replace(/\s+/g, ' ').trim();
        delete p.words;
        doc.cues.splice(i, 1);
      }
    });
  }

  let live = 0;
  doc.cues.forEach((c) => {
    const e = edits[c.id];
    if (e) {
      if (e.text && c.text === e.text.base) {
        c.text = e.text.value;
        delete c.words;
        c._edited = true;
        live++;
      }
    }
    const t = timing[c.id];
    if (t && t.base && t.base[0] === (data.cues.find((x) => x.id === c.id) || {}).start) {
      c.start = t.value[0];
      c.end = t.value[1];
      delete c.words;
      c._retimed = true;
      live++;
    }
  });

  // 译文覆盖：piece 编辑 patch 展示流并重拼句；sentence 改写降级整句上屏。
  const trans = (ov && ov.trans) || {};
  doc.transCues = doc.transCues || [];
  doc.sentences = doc.sentences || [];
  doc.transCues.forEach((tc) => {
    const e = trans[tc.id];
    if (e && e.kind === 'piece' && tc.kind === 'piece' && tc.text === e.base) {
      tc.text = e.value; tc._edited = true; live++;
    }
  });

  // 译文结构覆盖：manyToOne 展示片可沿源词边界拆分，也可与上一片合并；
  // seedUnaligned 的整句 split 会从 Sentence 的完整源词跨度建立第一版分片。
  // 操作只重放在发起时的 data.rev 上；每步都用源词跨度 + base 文本校验，
  // 因此 Agent 重切后不会把旧 UI 操作误套到新切法上。
  const transStruct = (ov && ov.transStruct) || null;
  if (transStruct && transStruct.baseRev === data.rev && Array.isArray(transStruct.ops)) {
    transStruct.ops.forEach((op) => {
      const rows = doc.transCues.filter((tc) => tc.sid === op.sid && tc.kind === 'piece')
        .sort((a, b) => (a.wordFrom || 0) - (b.wordFrom || 0));
      if (op.kind === 'split') {
        let tc = rows.find((row) => row.wordFrom === op.from && row.wordTo === op.to
          && row.text === op.baseText);
        if (!tc && op.seedUnaligned === true) {
          const sentence = doc.sentences.find((row) => row.id === op.sid);
          const whole = doc.transCues.find((row) => row.sid === op.sid
            && row.kind === 'sentence' && row.text === op.baseText);
          const wordsById = new Map(doc.cues.flatMap((cue) => (cue.words || []).map((word) => [
            word.id,
            { id: word.id, text: word.text, start: word.start ?? word.t0, end: word.end ?? word.t1 },
          ])));
          const words = (sentence && sentence.sourceWordIds || []).map((id) => wordsById.get(id))
            .filter(Boolean);
          if (whole && words.length >= 2 && op.from === 0 && op.to === words.length - 1) {
            tc = { ...whole, wordFrom: 0, wordTo: words.length - 1, sourceWords: words };
          }
        }
        if (!tc || !Array.isArray(tc.sourceWords) || op.at < tc.wordFrom || op.at >= tc.wordTo) return;
        const pos = op.at - tc.wordFrom + 1;
        const wordsA = tc.sourceWords.slice(0, pos), wordsB = tc.sourceWords.slice(pos);
        if (!wordsA.length || !wordsB.length || !op.textA || !op.textB) return;
        const at = doc.transCues.findIndex((row) => row === tc
          || (row.id === tc.id && row.sid === tc.sid && row.text === tc.text));
        if (at < 0) return;
        const make = (words, from, to, text) => ({
          ...tc, kind: 'piece', text, wordFrom: from, wordTo: to,
          start: words[0].start, end: words[words.length - 1].end,
          sourceWords: words, sourceWordIds: words.map((w) => w.id),
          sourceText: words.map((w) => w.text).join(' '),
          _edited: true,
        });
        doc.transCues.splice(at, 1,
          make(wordsA, tc.wordFrom, op.at, op.textA),
          make(wordsB, op.at + 1, tc.wordTo, op.textB));
        const sentence = doc.sentences.find((row) => row.id === op.sid);
        if (sentence) {
          sentence.aligned = true;
          sentence.mode = 'manyToOne';
          sentence.correspondence = 'block';
          sentence.blocks = [];
        }
        live++;
      } else if (op.kind === 'merge') {
        const upper = rows.find((row) => row.wordFrom === op.upperFrom && row.wordTo === op.upperTo
          && row.text === op.upperText);
        const lower = rows.find((row) => row.wordFrom === op.lowerFrom && row.wordTo === op.lowerTo
          && row.text === op.lowerText);
        if (!upper || !lower || upper.wordTo + 1 !== lower.wordFrom) return;
        const words = [...(upper.sourceWords || []), ...(lower.sourceWords || [])];
        if (!words.length) return;
        const merged = {
          ...upper, text: joinPieces([upper.text, lower.text]), wordTo: lower.wordTo,
          start: upper.start, end: lower.end, sourceWords: words,
          sourceWordIds: words.map((w) => w.id),
          sourceText: words.map((w) => w.text).join(' '), _edited: true,
        };
        const upperAt = doc.transCues.indexOf(upper), lowerAt = doc.transCues.indexOf(lower);
        if (upperAt < 0 || lowerAt < 0) return;
        doc.transCues.splice(Math.max(upperAt, lowerAt), 1);
        doc.transCues.splice(Math.min(upperAt, lowerAt), 1, merged);
        live++;
      }
      doc.transCues.filter((tc) => tc.sid === op.sid && tc.kind === 'piece')
        .sort((a, b) => a.wordFrom - b.wordFrom)
        .forEach((tc, index) => { tc.id = `${op.sid}#${index}`; });
    });
    doc.transCues.sort((a, b) => a.start - b.start);
  }

  doc.sentences.forEach((s) => {
    const e = trans[s.id];
    if (e && e.kind === 'sentence' && (s.trans || '') === e.base) {
      s.trans = e.value; s.aligned = false; s._editedTrans = true; live++;
      doc.transCues = doc.transCues.filter((tc) => tc.sid !== s.id)
        .concat([{ id: s.id, sid: s.id, kind: 'sentence', text: e.value, start: s.start, end: s.end, _edited: true }])
        .sort((a, b) => a.start - b.start);
    } else {
      const pieces = doc.transCues.filter((tc) => tc.sid === s.id && tc.kind === 'piece');
      if (pieces.some((tc) => tc._edited)) {
        s.trans = joinPieces(pieces.map((p) => p.text));
        s._editedTrans = true;
      }
    }
  });

  const st = ov && ov.style;
  const stylePatch = st && st.base === JSON.stringify(data.style) ? st.value : null;
  if (stylePatch) doc.style = { ...doc.style, ...stylePatch };
  // 舞台与样式层按 tab 取「上下文样式」：`style.voiceInkContexts` 是 Mac 的无损
  // 真相，扁平根键只是最后被编辑的那个 set 的投影（见 subtitle-rendering.js
  // `contextStyle` 的注释）。解析顺序固定为
  //   data.json style → 按 tab 的 voiceInkContexts 上下文 → edits.json 覆盖层
  // —— 覆盖层必须最后盖，否则用户在 Web 里改的字号/模式会被 contexts 压回去。
  // contexts 缺席时 `contextStyle` 逐比特返回原对象，ctxStyle 两支就等于 doc.style。
  // R 在这里懒取：subtitle-rendering.js 在 index.html 里排在 store.jsx 之后，
  // 但 applyOverlays 只在渲染期跑，那时它一定已经注册。
  const R = window.BCS_SUBTITLE;
  doc.ctxStyle = R ? {
    sub: R.applyStylePatch(R.contextStyle(data.style, 'sub'), stylePatch),
    bi: R.applyStylePatch(R.contextStyle(data.style, 'bi'), stylePatch),
  } : { sub: doc.style, bi: doc.style };
  doc._pendingEdits = live;
  return doc;
}

// CJK 邻接拼接（对拍 bcut join_word_texts）：两侧都是宽字符不加空格。
const CJK_ADJ = /[　-〿぀-ヿ一-鿿가-힯＀-￯—‘-”…]/;
function joinPieces(parts) {
  let out = '';
  parts.forEach((p) => {
    if (!p) return;
    if (out && !(CJK_ADJ.test(out[out.length - 1]) && CJK_ADJ.test(p[0]))) out += ' ';
    out += p;
  });
  return out;
}

function splitTextAt(text, fraction, exactOffset) {
  const raw = text || '';
  if (raw.length < 2) return null;
  let cut = Number.isInteger(exactOffset)
    ? exactOffset
    : Math.max(1, Math.min(raw.length - 1, Math.round(raw.length * fraction)));
  if (!Number.isInteger(exactOffset)) {
    const seams = [];
    for (let i = 1; i < raw.length; i++) {
      const left = raw[i - 1], right = raw[i];
      if (/\s/.test(left) || /[,，。！？!?;；:：、]/.test(left) || /[\(\[（【“‘]/.test(right)) seams.push(i);
    }
    if (seams.length) cut = seams.reduce((best, value) =>
      Math.abs(value - cut) < Math.abs(best - cut) ? value : best, seams[0]);
  }
  const a = raw.slice(0, cut).trim(), b = raw.slice(cut).trim();
  return a && b ? [a, b] : null;
}

function translationSplitTarget(doc, reference) {
  const piece = (doc.transCues || []).find((row) => row.id === reference && row.kind === 'piece');
  if (piece) return { ...piece, seedUnaligned: false };
  const whole = (doc.transCues || []).find((row) => row.id === reference && row.kind === 'sentence');
  const sentence = whole && (doc.sentences || []).find((row) => row.id === whole.sid);
  const wordCount = sentence && Array.isArray(sentence.sourceWordIds)
    ? sentence.sourceWordIds.length : 0;
  if (!whole || wordCount < 2) return null;
  return { ...whole, wordFrom: 0, wordTo: wordCount - 1, seedUnaligned: true };
}

// ---------- derived projections ----------
function paragraphs(doc) {
  const chOf = (t) => { const i = doc.chapters.findIndex((c) => t >= c.start && t < c.end); return i < 0 ? doc.chapters.length - 1 : i; };
  const out = [];
  doc.cues.forEach((c) => {
    const ch = chOf(c.start);
    const last = out[out.length - 1];
    const paraId = c.paraId || null;
    const samePara = paraId ? last && last.paraId === paraId : last && !c.paraStart;
    if (last && samePara && last.sp === c.sp && last.ch === ch && c.start - last.end < 14) {
      last.end = c.end; last.cues.push(c);
      last.text = (last.text + ' ' + c.text).replace(/\s+/g, ' ').trim();
    } else {
      const fallbackId = String(c.id || '').startsWith('q-')
        ? 'p-' + String(c.id).slice(2) : null;
      out.push({ id: paraId || fallbackId || ('p-' + out.length), paraId: paraId || fallbackId, sp: c.sp, ch, start: c.start, end: c.end, cues: [c], text: c.text });
    }
  });
  return out;
}
const cueAt = (doc, t) => doc.cues.find((c) => t >= c.start && t < c.end) || null;
const transCueAt = (doc, t) => (doc.transCues || []).find((tc) => t >= tc.start && t < tc.end) || null;
const sentenceAt = (doc, t) => (doc.sentences || []).find((s) => t >= s.start && t < s.end) || null;
const chapterOf = (doc, t) => {
  const i = doc.chapters.findIndex((c) => t >= c.start && t < c.end);
  return doc.chapters[i < 0 ? doc.chapters.length - 1 : i];
};
function cps(text, dur) {
  const chars = Array.from((text || '').replace(/\s/g, '')).length;
  return chars / Math.max(0.1, dur);
}
function cpsLevel(text, dur, lang) {
  const v = cps(text, dur);
  const warn = lang === 'zh' ? 9 : 17, bad = lang === 'zh' ? 12 : 21;
  return v > bad ? 'bad' : v > warn ? 'warn' : 'ok';
}

// ---------- SRT export ----------
// 单一真相在 export-text.js（导出对话框与 Agent API `bcsStudio.exportSRT` 共用），
// 事件构造与 CLI `render_subtitle_events` 同构。
function exportSRT(doc, mode) {
  return window.BCS_EXPORT_TEXT.subtitles(doc, { content: mode, format: 'srt' });
}

// ---------- store ----------
const AppCtx = createContext(null);
function useApp() { return useContext(AppCtx); }

// 播放时钟每帧都在变（≈60Hz）。它留在 AppCtx 里会让整棵树每帧重渲染，所以拆成
// 两个独立 Context：
//   · PlayerCtx —— 逐帧真值，只给真正需要连续时间的组件（播放头、Karaoke、
//     波形/时间轴、播放控件）。
//   · ActiveCtx —— 从时间派生的"当前是哪一条"，只在跨越 cue 边界时变化，
//     字幕列表这种成千上万行的表订阅它，一帧一次的重渲染就退化成一秒几次。
const PlayerCtx = createContext(null);
function usePlayer() { return useContext(PlayerCtx); }
const ActiveCtx = createContext(null);
function useActive() { return useContext(ActiveCtx); }

function ActiveProvider({ doc, children }) {
  const { t, playing } = usePlayer();
  const cue = doc ? cueAt(doc, t) : null;
  const cueId = cue ? cue.id : null;
  const value = useMemo(() => ({ cueId, playing }), [cueId, playing]);
  return <ActiveCtx.Provider value={value}>{children}</ActiveCtx.Provider>;
}

// tab 与样式层的深链解释在 style-route.js（纯函数 + 单测）：服务器对
// `/(transcript|subtitle|translation|translate|style)` 一律 SPA fallback 回本页面，
// 语义全在前端。`/style` 不再是第四个 tab（M89 之后样式是覆盖右侧 pane 的层），
// 它解释为「tab=transcript + 打开样式层」。
const ROUTE = window.BCS_STYLE_ROUTE;
if (!ROUTE) throw new Error('style-route.js failed to load');
if (!ELEMENT_ACTIONS) throw new Error('element-actions.jsx failed to load');

function AppStore({ children }) {
  const [data, setData] = useState(null);     // Agent 文档（studio/data.json）
  // studio/progress.json：只作为 WS 覆盖不到的三项细节的来源（阶段行 phases、
  // contentFingerprint、pct 的"不确定"），随 studio/poll 下发，不独立轮询。
  const [progress, setProgress] = useState(null);
  // serve 通知中枢的任务频道：link = connecting | open | offline，job = 本项目
  // 当前任务（全量帧里选出来的那条）。存活判定在中枢，页面不做。
  const [tasks, setTasks] = useState({ link: 'connecting', job: null });
  const [ov, setOv] = useState(EMPTY_OV);     // 用户覆盖层（studio/edits.json）
  const [err, setErr] = useState(null);
  // rate = 走带倍速（与 clip 自身的 rate 相乘），fullscreen = 舞台全屏（stage.jsx 驱动）。
  const [player, setPlayer] = useState(() => ({
    t: lsGet(LS_TIME, 0), playing: false, showSubs: true, vol: 0.8, muted: false, ratio: 'Original',
    rate: 1, fullscreen: false,
  }));
  const [sel, setSelState] = useState(null);
  // 选中的「第几次」：同一个对象被再选一次时 sel 本身不变，但那仍然是一次选中动作
  // （例如层被关掉之后再点同一个元素块，应该把它的面板重新打开）。所以副作用挂在这个
  // 计数上，而不是只挂在 sel 的值上。
  const [selSeq, setSelSeq] = useState(0);
  const setSel = useCallback((next) => {
    setSelState(next);
    setSelSeq((seq) => seq + 1);
  }, []);
  // 光速修正的导出基线（export-delta.js 快照）。持久化在 localStorage：
  // serve 的 doc 是服务器真相，刷新后基线仍应指向磁盘上那个已导出文件。
  const [exportBaseline, setExportBaseline] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bcs:export-baseline')) || null; } catch { return null; }
  });
  const stampExport = useCallback((docSnapshot, artifact) => {
    const ED = window.BCS_EXPORT_DELTA;
    if (!ED || !docSnapshot) return;
    const base = ED.snapshot(docSnapshot, artifact);
    setExportBaseline(base);
    try { localStorage.setItem('bcs:export-baseline', JSON.stringify(base)); } catch { /* 私有模式等场景忽略 */ }
  }, []);
  const initialRoute = ROUTE.routeFromPath(location.pathname);
  const [tab, setTabState] = useState(initialRoute.tab);
  // 样式层（原型 M89）：styleOpen 是层的开合真相，styleCtx 只决定层头部的标题
  // （'sub' 字幕样式 / 'bi' 翻译样式）。深链一律给字幕样式：ctx 不进 URL。
  const [styleOpen, setStyleOpen] = useState(initialRoute.styleOpen);
  const [styleCtx, setStyleCtx] = useState('sub');
  // 右侧 pane 上还有另外两个同款 slide-over（原型 M-transform / M105）：元素检查器
  // 与水印层。三层互斥（打开一个关掉另两个）—— 它们占同一个位置，同时开只会互相
  // 盖住，而且「当前编辑的是哪个对象」必须唯一。
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [wmOpen, setWmOpen] = useState(false);
  const wmOpenRef = useRef(wmOpen); wmOpenRef.current = wmOpen;
  // 元素补丁的本地草稿（滑块拖动期间的即时预览）：{ id, set, label }。
  // 叠在投影上，400ms 后合并成一条 patchElement 事务写出去，见 patchElementLive。
  const [elDraft, setElDraft] = useState(null);
  const tabRef = useRef(tab); tabRef.current = tab;
  const styleOpenRef = useRef(styleOpen); styleOpenRef.current = styleOpen;
  // URL 末段跟着 tab / 层走;pushState 不带尾斜杠,相对 fetch 基准目录不变。
  // 目标路径与当前相同时不推历史,免得同一个 tab 点两次留下两条一样的记录。
  const pushRoute = useCallback((nextTab, nextStyleOpen) => {
    if (!window.history || !window.history.pushState) return;
    const next = ROUTE.pathFor(location.pathname, nextTab, nextStyleOpen);
    if (next === location.pathname) return;
    try { history.pushState(null, '', next); } catch { /* file:// 等场景忽略 */ }
  }, []);
  const setTab = useCallback((next) => {
    setTabState(next);
    // 层打开时末段恒为 style（层盖着 tab 栏，URL 指向被盖住的 tab 刷新后自相矛盾）。
    pushRoute(next, styleOpenRef.current);
  }, [pushRoute]);
  useEffect(() => {
    const onPop = () => {
      const route = ROUTE.routeFromPath(location.pathname);
      setTabState(route.tab);
      setStyleOpen(route.styleOpen);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // 外壳面板显隐（侧栏 · 右侧 pane · 时间轴 · 舞台）。语义与限幅都在
  // panels.js（纯函数 + 单测），这里只做 React 接线与持久化。
  const [panels, setPanels] = useState(() => PANELS.loadPanels(window.localStorage));
  const setPanel = useCallback((name, on) => {
    setPanels((cur) => {
      const next = PANELS.setPanel(cur, name, on);
      PANELS.savePanels(window.localStorage, next);
      return next;
    });
  }, []);
  // 样式层的开合。入口可能在 pane 外（舞台工具条 / 样式选择器 / 深链），
  // 所以打开时先确保右侧 pane 在场，否则层没有容身之处。
  const openStyle = useCallback((ctx) => {
    setPanel('rpane', true);
    setStyleCtx(ctx === 'bi' ? 'bi' : 'sub');
    setStyleOpen(true);
    setInspectorOpen(false);
    setWmOpen(false);
    pushRoute(tabRef.current, true);
  }, [setPanel, pushRoute]);
  const closeStyle = useCallback(() => {
    setStyleOpen(false);
    pushRoute(tabRef.current, false);
  }, [pushRoute]);
  // 元素检查器 / 水印层：与样式层同一个位置、同一套互斥规则。只有样式层进 URL
  // （深链 /style 早就在契约里），这两层是选中态的附属面板，不改路由。
  const openInspector = useCallback(() => {
    setPanel('rpane', true);
    setInspectorOpen(true);
    setWmOpen(false);
    if (styleOpenRef.current) closeStyle();
  }, [setPanel, closeStyle]);
  const closeInspector = useCallback(() => setInspectorOpen(false), []);
  const openWatermark = useCallback(() => {
    setPanel('rpane', true);
    setWmOpen(true);
    setInspectorOpen(false);
    if (styleOpenRef.current) closeStyle();
  }, [setPanel, closeStyle]);
  const closeWatermark = useCallback(() => setWmOpen(false), []);
  const playerRef = useRef(player); playerRef.current = player;
  // 各 Pane 的滚动位置：Pane 现在按 tab 条件挂载（隐藏的那两个不再进 DOM，
  // 也就不再逐帧参与布局），切回来时靠这里恢复视口。可变对象、不触发渲染。
  const paneScroll = useRef({}).current;
  const dataRef = useRef(data); dataRef.current = data;
  const ovRef = useRef(ov); ovRef.current = ov;
  const ovServerText = useRef(null);          // 上次从服务器读到的 edits.json 原文
  const transcriptQueueRef = useRef(Promise.resolve()); // Transcript 事务串行，保持 rev 单调
  const mediaRef = useRef(null);

  const doc = useMemo(() => {
    if (!data) return null;
    const next = applyOverlays(data, ov);
    next.status = PS.projectStatus(next.status, tasks.job, progress, data.contentFingerprint);
    if (T && next.timeline) {
      const projection = T.fromStudio(next.timeline);
      if (projection) {
        const sourceDocs = {
          ...(next.sourceDocs || {}),
          main: {
            ...((next.sourceDocs || {}).main || {}),
            cues: next.cues || [],
            sentences: next.sentences || [],
            transCues: next.transCues || [],
            chapters: next.chapters || [],
          },
        };
        // 元素草稿叠在投影上：拖滑块 / 拖时间轴块时画布与面板立刻跟手，真正的
        // patchElement 事务 400ms 后才发（否则每帧一次事务）。ET.mergePatch 与
        // 服务端 merge_patch 同语义，所以「拖着看到的」就是「写进去的」。
        if (elDraft && ET) projection.tracks = ET.applyDraftToTracks(projection.tracks, elDraft);
        next.timelineProjection = projection;
        next.timelineCues = T.projectTimedItems(sourceDocs, projection, 'cues');
        next.timelineSentences = T.projectTimedItems(sourceDocs, projection, 'sentences');
        next.timelineTransCues = T.projectTimedItems(sourceDocs, projection, 'transCues');
        next.sourceChapters = next.chapters || [];
        const timelineChapters = T.projectTimedItems(sourceDocs, projection, 'chapters', 0);
        if (timelineChapters.length) next.chapters = timelineChapters;
      }
    }
    return next;
  }, [data, ov, progress, tasks, elDraft]);
  const docRef = useRef(doc); docRef.current = doc;
  // 已导出视频落后于当前字幕的差异（null = 尚无基线或基线属于其它项目）。
  const exportDelta = useMemo(() => {
    const ED = window.BCS_EXPORT_DELTA;
    return ED && doc ? ED.delta(doc, exportBaseline) : null;
  }, [doc, exportBaseline]);

  // ----- 同步：__bcut/studio/poll 合并长轮询 -----
  // 一个请求同步 data/edits/progress 三个文件：mtime 版本号随带（v 参数），
  // 无变化时服务端挂起 25s 后 204 空体（空闲 ≈ 2.4 请求/分钟且不回全量），
  // 任一文件变化 250ms 内返回、且只带变化的文件。旧服务器（端点 404）退回
  // 文件级轮询：data+edits 每 2s 一轮。
  useEffect(() => {
    let dead = false, timer = 0, lastRev = null, lastUpdated = null, gotData = false;
    const applyData = (d) => {
      if (d.rev !== lastRev || !gotData) {
        const isUpdate = gotData && lastRev != null && d.rev !== lastRev;
        lastRev = d.rev;
        gotData = true;
        setData(d);
        if (isUpdate) toast('已从 Agent 同步 · rev ' + d.rev, { variant: 'informative' });
      }
      setErr(null);
    };
    const applyEdits = (text) => {
      if (text !== ovServerText.current && !pendingMuts.current.length && !savingRef.current) {
        ovServerText.current = text;
        let next = EMPTY_OV;
        try { next = text ? JSON.parse(text) : EMPTY_OV; } catch (e) {}
        setOv(next);
      }
    };
    const applyProgress = (p) => {
      if (p && p.updatedAt !== lastUpdated) {
        lastUpdated = p.updatedAt;
        setProgress(p);
      }
    };
    const sleep = (ms) => new Promise((res) => { timer = setTimeout(res, ms); });

    // 旧服务器回退：与 poll 端点等价的文件级轮询
    const legacyLoop = async () => {
      while (!dead) {
        try {
          const r = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          applyData(await r.json());
        } catch (e) { if (!dead && !gotData) setErr(String(e)); }
        try {
          const r = await fetch(EDITS_FILE + '?t=' + Date.now(), { cache: 'no-store' });
          applyEdits(r.ok ? await r.text() : null);
        } catch (e) {}
        if (dead) return;
        await sleep(2000);
      }
    };

    (async () => {
      let v = '';
      while (!dead) {
        const t0 = Date.now();
        let r;
        try {
          r = await fetch(`__bcut/studio/poll?v=${encodeURIComponent(v)}&wait=25&t=${Date.now()}`,
            { cache: 'no-store' });
        } catch (e) {
          if (dead) return;
          if (!gotData) setErr(String(e));
          await sleep(3000);
          continue;
        }
        if (dead) return;
        if (r.status === 404) { legacyLoop(); return; }  // 旧服务器
        if (r.status === 204) {                          // 挂满无变化，立即续期
          if (Date.now() - t0 < 1000) await sleep(1000); // 防御异常快速 204 热循环
          continue;
        }
        if (!r.ok) { await sleep(3000); continue; }
        let j = null;
        try { j = await r.json(); } catch (e) {}
        if (dead || !j) continue;
        v = j.v || '';
        if (j.data) applyData(j.data);
        if ('edits' in j) applyEdits(typeof j.edits === 'string' ? j.edits : null);
        if (j.progress) applyProgress(j.progress);
      }
    })();
    return () => { dead = true; clearTimeout(timer); };
  }, []);

  // ----- 任务频道：serve 通知中枢 WS（/__bcut/ws） -----
  // 连上先收 hello（specVersion / serveGeneration），随后每次变化推一帧全量
  // jobs 快照；rev 单调，落后的帧丢弃。重连拿到的快照就是新真相，直接整体替换
  // 本地任务态；serveGeneration 变了说明 serve 重启过，先清空再接受新快照。
  // 项目归属靠 healthz 解析出的本页项目绝对路径过滤（见 progress-status.js）。
  useEffect(() => {
    let dead = false, socket = null, timer = 0, attempt = 0;
    let generation = null, rev = -1, projectPath = null;
    const setLink = (link) => setTasks((prev) => (prev.link === link ? prev : { ...prev, link }));
    const clearJobs = () => { rev = -1; setTasks({ link: 'open', job: null }); };

    const retry = () => {
      if (dead) return;
      setTasks({ link: 'offline', job: null });   // 断开期间不敢声称任务还在跑
      const wait = Math.min(30_000, 1000 * 2 ** attempt) * (0.7 + Math.random() * 0.6);
      attempt += 1;
      timer = setTimeout(() => { if (!dead) connect(); }, wait);
    };

    const onFrame = (frame) => {
      if (frame.type === 'hello') {
        if (generation != null && frame.serveGeneration !== generation) clearJobs();
        generation = frame.serveGeneration;
        return;
      }
      if (frame.type !== 'jobs') return;          // pong / 未知帧型忽略
      const next = Number(frame.rev);
      if (Number.isFinite(next)) {
        if (next <= rev) return;
        rev = next;
      }
      setTasks({ link: 'open', job: PS.selectJob(frame.jobs, projectPath) });
    };

    function connect() {
      if (dead) return;
      setLink('connecting');
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try { ws = new WebSocket(proto + '//' + location.host + WS_PATH); } catch (e) { retry(); return; }
      socket = ws;
      ws.onopen = () => { if (!dead) { attempt = 0; setLink('open'); } };
      ws.onmessage = (ev) => {
        if (dead) return;
        let frame = null;
        try { frame = JSON.parse(ev.data); } catch (e) { return; }
        if (frame && typeof frame === 'object') onFrame(frame);
      };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
      ws.onclose = () => { if (!dead && socket === ws) { socket = null; retry(); } };
    }

    (async () => {
      try {
        const r = await fetch(HEALTHZ_URL + '?t=' + Date.now(), { cache: 'no-store' });
        if (r.ok) projectPath = PS.resolveProjectPath(await r.json(), location.pathname);
      } catch (e) { /* 认不出项目就只连不显示，下面照常连 */ }
      if (!dead) connect();
    })();

    return () => {
      dead = true;
      clearTimeout(timer);
      if (socket) { try { socket.close(); } catch (e) {} }
    };
  }, []);

  // ----- 项目历史的可撤销/可重做位 -----
  // 服务端每一条写路径（transcript apply、undo/redo、覆盖层 put）的应答都带这两个
  // 字段，统一在 noteHistory 里收口 —— 两个写路径各记一份 flags 迟早分叉。初值给
  // canUndo=true：刷新页面时前端并不知道磁盘上的历史深度，宁可先亮着按钮、由 409
  // empty 应答自我纠正，也不要一进来就把有历史的项目的撤销按钮画成灰的。
  const [histFlags, setHistFlags] = useState({ canUndo: true, canRedo: false });
  const noteHistory = useCallback((result) => {
    if (!result || typeof result !== 'object') return;
    setHistFlags((h) => ({
      canUndo: typeof result.canUndo === 'boolean' ? result.canUndo : h.canUndo,
      canRedo: typeof result.canRedo === 'boolean' ? result.canRedo : h.canRedo,
    }));
  }, []);

  // ----- 覆盖层持久化：本地乐观更新 → 去抖 → CAS 写回（失配即拉最新重放） -----
  const pendingMuts = useRef([]);             // 待落盘的变换 (ov) => ov
  const savingRef = useRef(false);
  const flushTimer = useRef(null);
  const flush = useCallback(async (label) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      for (let attempt = 0; attempt < 4 && pendingMuts.current.length; attempt++) {
        let baseText = null;
        try {
          const r = await fetch(EDITS_FILE + '?t=' + Date.now(), { cache: 'no-store' });
          if (r.ok) baseText = await r.text();
        } catch (e) {}
        let next;
        try { next = baseText ? JSON.parse(baseText) : EMPTY_OV; } catch (e) { next = EMPTY_OV; }
        const muts = pendingMuts.current.slice();
        muts.forEach((m) => { next = m(next); });
        const content = JSON.stringify(next, null, 2);
        const base = baseText == null ? 'new' : await sha256(baseText);
        let resp, j = {};
        // 确定性失败（网络不可达、4xx/5xx 非 stale）不能留着 pendingMuts 让 finally
        // 每 400ms 重试一次并刷一条负面 toast：丢弃这批变换并回退到服务器已知
        // 状态，让用户明确知道刚才的改动没有落地（与 Mac 「已回退」语义一致）。
        const abandon = (message) => {
          pendingMuts.current.length = 0;
          let server = EMPTY_OV;
          try { server = ovServerText.current ? JSON.parse(ovServerText.current) : EMPTY_OV; } catch (e) {}
          ovRef.current = server;
          setOv(server);
          toast(message, { variant: 'negative' });
        };
        try {
          resp = await fetch(PUT_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: EDITS_FILE, base, content, label: label || '页面编辑' }),
          });
          j = await resp.json().catch(() => ({}));
        } catch (e) {
          abandon('保存失败（需要 bcut serve 服务本页），改动已回退');
          break;
        }
        if (resp.status === 409 && j.reason === 'stale') continue;   // 与 Agent 竞写：重拉重放
        if (!resp.ok || !j.ok) { abandon('保存失败，改动已回退：' + (j.error || resp.status)); break; }
        pendingMuts.current.splice(0, muts.length);
        // 覆盖层的写也进项目历史（服务端 put 会记一条），所以撤销按钮必须跟着亮：
        // 拖字幕、改样式走的都是这条路，过去撤销按钮一直是灰的。缺省值兼容还不带
        // canUndo/canRedo 的旧服务端 —— 刚写完必然有可撤销的一步，重做栈则被这一步
        // 顶掉；应答里带了字段就以服务端为准。
        noteHistory({ canUndo: true, canRedo: false, ...j });
        ovServerText.current = content;
        ovRef.current = next;
        setOv(next);
      }
    } finally {
      savingRef.current = false;
      if (pendingMuts.current.length) { clearTimeout(flushTimer.current); flushTimer.current = setTimeout(() => flush(label), 400); }
    }
  }, []);
  const mutate = useCallback((fn, label) => {
    pendingMuts.current.push(fn);
    const next = fn(ovRef.current);
    ovRef.current = next;
    setOv(next);
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => flush(label), 400);
  }, [flush]);

  // ----- Transcript 唯一写路径：Web / Mac / Agent 共用 CAS + history 事务 -----
  // apply 与 undo/redo 的应答（含错误应答）都带 canUndo/canRedo，收口见上面的
  // noteHistory。
  const applyTranscriptOps = useCallback((ops, label, requestFields) => {
    const run = async () => {
      const current = dataRef.current || {};
      const response = await fetchApply(TRANSCRIPT_APPLY_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseRev: current.rev || 0,
          ops,
          label: label || '页面编辑',
          ...(requestFields || {}),
        }),
      });
      const result = await response.json().catch(() => ({}));
      noteHistory(result);
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || result.reason || ('HTTP ' + response.status));
      }
      // poll 会随后替换整份 data；先推进 ref 供队列中的下一个事务使用。
      if (Number.isInteger(result.rev) && dataRef.current) {
        dataRef.current = { ...dataRef.current, rev: result.rev };
      }
      return result;
    };
    const queued = transcriptQueueRef.current.then(run, run);
    transcriptQueueRef.current = queued.catch((error) => {
      toast('保存编辑失败：' + String(error), { variant: 'negative' });
      return null;
    });
    return transcriptQueueRef.current;
  }, [noteHistory]);

  // ----- 项目级 undo/redo：与 Transcript 事务共用同一条串行队列 -----
  // 走队列是为了不和正在飞的 apply 抢 rev：先落地的先算。应答里的 rev 立刻推进
  // dataRef，否则紧接着的下一次编辑会拿旧 baseRev 撞 409。
  const historyStep = useCallback((redo) => {
    const run = async () => {
      const response = await fetch(redo ? REDO_URL : UNDO_URL, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      noteHistory(result);
      const verb = redo ? '重做' : '撤销';
      if (response.status === 423) {
        toast('项目正被其他任务占用，' + verb + '稍后再试', { variant: 'neutral' });
        return null;
      }
      if (!response.ok || result.ok === false) {
        if (result.reason === 'empty') toast('没有可' + verb + '的项目修改', { variant: 'neutral' });
        else toast(verb + '失败：' + (result.error || result.reason || ('HTTP ' + response.status)), { variant: 'negative' });
        return null;
      }
      if (Number.isInteger(result.rev) && dataRef.current) {
        dataRef.current = { ...dataRef.current, rev: result.rev };
      }
      // 正文由既有长轮询推回，这里不再额外拉一次 data.json。
      return result;
    };
    const queued = transcriptQueueRef.current.then(run, run);
    transcriptQueueRef.current = queued.catch((error) => {
      toast((redo ? '重做' : '撤销') + '失败：' + String(error), { variant: 'negative' });
      return null;
    });
    return transcriptQueueRef.current;
  }, [noteHistory]);
  const undoDoc = useCallback(() => historyStep(false), [historyStep]);
  const redoDoc = useCallback(() => historyStep(true), [historyStep]);

  // ----- 剪辑域（叠加元素）唯一写路径：POST __bcut/timeline/apply（设计 §5.3）-----
  // 与 Transcript 事务同构但**另一条队列**：两份文档各有独立 rev，串在一起只会让
  // 其中一个的 baseRev 被另一个的应答带偏。
  const timelineQueueRef = useRef(Promise.resolve());
  const timelineRevRef = useRef(null);
  // baseRev 取「已知最大值」：poll 推回来的投影 rev 与上一笔事务应答里的 rev 都可能
  // 更新（rev 单调），落后的那个会撞 409。老服务端没有 timeline 节时从 0 起。
  const timelineRev = useCallback(() => {
    const projection = (docRef.current || {}).timelineProjection;
    const projected = projection && Number.isInteger(projection.rev) ? projection.rev : 0;
    const local = Number.isInteger(timelineRevRef.current) ? timelineRevRef.current : 0;
    return Math.max(projected, local);
  }, []);
  const applyTimelineOps = useCallback((ops, label) => {
    const run = async () => {
      const response = await fetchApply(TIMELINE_APPLY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRev: timelineRev(), ops, label: label || '编辑时间轴' }),
      });
      const result = await response.json().catch(() => ({}));
      if (Number.isInteger(result.rev)) timelineRevRef.current = result.rev;
      if (response.status === 423) {
        toast('项目正被其他任务占用，稍后再试', { variant: 'neutral' });
        return null;
      }
      if (response.status === 409 && result.reason === 'stale') {
        // rev 已经就地纠正，poll 也会推回新投影：让用户重做这一步，而不是拿旧
        // baseRev 自动重放（自动重放会把别人刚写的改动当成自己的前提）。
        throw new Error('时间轴已被其他改动更新，请重试');
      }
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || result.reason || ('HTTP ' + response.status));
      }
      // 逐条 base 校验失败是 200 + `skipped[]`（不是错误）。一条都没落地时必须说出来，
      // 否则用户看到的是"点了没反应"。
      const skipped = Array.isArray(result.skipped) ? result.skipped : [];
      const applied = Array.isArray(result.applied) ? result.applied : [];
      if (skipped.length && !applied.length) {
        toast('数据已被其他改动更新，这一步没有生效', { variant: 'neutral' });
        return null;
      }
      // 应答不带 canUndo/canRedo：timeline.json 进的是同一个 .bcut/history journal，
      // 所以刚写完必然有可撤销的一步、重做栈被这一步顶掉（与覆盖层 put 同款兜底）。
      noteHistory({ canUndo: true, canRedo: false, ...result });
      // 正文不用自己重拉：服务端事务里已经重跑 studio 投影并推进 data.json 的 rev，
      // 长轮询会在 250ms 内把新 timeline 投影推回来。
      return result;
    };
    const queued = timelineQueueRef.current.then(run, run);
    timelineQueueRef.current = queued.catch((error) => {
      toast('保存编辑失败：' + (error.message || String(error)), { variant: 'negative' });
      return null;
    });
    return timelineQueueRef.current;
  }, [noteHistory, timelineRev]);

  // 投影里的元素（含求值后的 start/end）。面板/键盘/画布都用它按 id 取当前值。
  const findElement = useCallback((elementId) => {
    if (!elementId) return null;
    const tracks = ((docRef.current || {}).timelineProjection || {}).tracks || [];
    for (const track of tracks) {
      const found = (track.elements || []).find((element) => element.id === elementId);
      if (found) return { ...found, trackId: track.id || null };
    }
    return null;
  }, []);

  // 产品动作（新建文本/图片/水印、移动、改字、删除）在 element-actions.jsx：
  // 它们是这条管道之上的纯组合，store 只负责管道本身。
  const elementActions = ELEMENT_ACTIONS.useElementActions({
    applyTimelineOps, findElement, docRef, playerRef, setSel, undo: undoDoc,
  });

  // ----- 面板改元素：本地草稿 + 400ms 合并写（与覆盖层 mutate 同款节奏）-----
  // 检查器与水印层的滑块/色板/开关全部走这里：草稿让画布立刻跟手，事务合并成一条，
  // 一次拖动因此也只占一步撤销。草稿在**新投影推回来之后**才撤（应答落地 → 等
  // data 的下一次变化），否则 250ms 的轮询延迟会让控件回跳一次。
  const elDraftRef = useRef(null);
  const elFlushTimer = useRef(0);
  const elDraftPending = useRef(false);
  const writeDraft = useCallback((next) => {
    elDraftRef.current = next;
    setElDraft(next);
  }, []);
  const flushElementDraft = useCallback(() => {
    window.clearTimeout(elFlushTimer.current);
    const draft = elDraftRef.current;
    if (!draft || !draft.set) return Promise.resolve(null);
    return applyTimelineOps(
      [{ kind: 'patchElement', elId: draft.id, set: draft.set }],
      draft.label || ('修改元素 ' + draft.id),
    ).then((result) => {
      // 没落地（409 重试 / 全跳 / 失败）就地丢掉草稿：控件弹回服务端真值，
      // 比继续显示一个没写进去的数字诚实。
      if (!result) { writeDraft(null); return null; }
      elDraftPending.current = true;
      return result;
    });
  }, [applyTimelineOps, writeDraft]);
  const patchElementLive = useCallback((element, set, options) => {
    const elId = typeof element === 'string' ? element : (element && element.id);
    if (!elId || !set || !ET) return;
    const current = elDraftRef.current;
    // 换了对象就先把上一个草稿写出去 —— 直接丢会静默吞掉刚拖的那一下。
    if (current && current.id !== elId) flushElementDraft();
    const base = current && current.id === elId ? current.set : null;
    writeDraft({
      id: elId,
      set: ET.mergePatch(base, set),
      label: (options && options.label) || (current && current.id === elId ? current.label : null),
    });
    window.clearTimeout(elFlushTimer.current);
    elFlushTimer.current = window.setTimeout(() => flushElementDraft(), 400);
  }, [flushElementDraft, writeDraft]);
  // 投影已经带上这一步（服务端事务里已重跑投影、data.rev 前进）：撤草稿，回到真值。
  useEffect(() => {
    if (!elDraftPending.current) return;
    elDraftPending.current = false;
    writeDraft(null);
  }, [data, writeDraft]);

  // 选中即开对应的层。这张表就是 Mac `Editor/EditorPageView.swift:130-141` 的
  // `.sel` 观察者（M89）与原型 `designs/baocut-mac/app/editor.jsx:203-214` 的
  // `useEffect([selKind, selId])`：
  //   · { kind:'sub' }（舞台上的字幕对象 / 单行，Mac 的 .sub / .subLine）→ 样式层，
  //     上下文按当前 tab 取（Mac `styleSubjectForTab`：Transcript/Subtitle → sub，
  //     Translate → bi）。选中字幕就该看到它的样式面板，而不是把人拽去 Style tab。
  //   · { kind:'el' } role watermark → 水印层（列表 + 同一份编辑区，水印的家在那里）
  //   · { kind:'el' } 其它元素      → 检查器
  //     角色还未知（刚新建，投影要等 250ms）→ 先开检查器；水印层已经在场时不抢，
  //     免得「舞台工具条新建水印」被检查器截走。角色落地后这个 effect 会再跑一次。
  //   · 其余（null 清选中、{ cueId } 时间轴块/右侧面板点选）→ 关样式层与检查器，
  //     对应 Mac 的 default 分支。
  // 角色：null = 还不知道（投影里没有这个 id），'' = 知道且没有 role。
  const selectedElement = sel && sel.kind === 'el' ? findElement(sel.id) : null;
  const selectedRole = selectedElement ? (selectedElement.role || '') : null;
  useEffect(() => {
    // 挂载不是一次「选中变化」：深链 /style 带着层进来时 sel 恒为 null，跑 default
    // 分支会把刚开的层当场关掉。Mac 的观察者同理，只在 .sel 事件上触发。
    if (selSeq === 0) return;
    if (sel && sel.kind === 'el') {
      if (selectedRole === 'watermark') { openWatermark(); return; }
      if (selectedRole == null && wmOpenRef.current) return;
      openInspector();
      return;
    }
    setInspectorOpen(false);
    // 手动关层不清 sel、也不重开：副作用挂在 selSeq 上，下一次选中动作才再判一次。
    if (sel && sel.kind === 'sub') { openStyle(TR.styleCtx(tabRef.current)); return; }
    if (styleOpenRef.current) closeStyle();
  }, [sel, selSeq, selectedRole, openInspector, openWatermark, openStyle, closeStyle]);

  // ----- 播放：有真实媒体时元素是时钟主人，否则回退模拟时钟 -----
  const attachMedia = useCallback((el) => {
    mediaRef.current = el;
    if (el) {
      el.volume = playerRef.current.vol;
      el.muted = playerRef.current.muted;
      const projection = docRef.current && docRef.current.timelineProjection;
      const position = projection && T
        ? T.timelineToSource(projection, playerRef.current.t || 0, 'following')
        : null;
      const t0 = position ? position.sourceTime : (playerRef.current.t || 0);
      if (!position || el.dataset.srcId === position.srcId) {
        try { el.currentTime = Math.max(0, t0); } catch (e) {}
      }
      const clip = position && projection.clips.find((item) => item.id === position.clipId);
      el.playbackRate = (clip ? clip.rate : 1) * (playerRef.current.rate || 1);
      if (playerRef.current.playing) el.play().catch(() => {});
    }
  }, []);
  useEffect(() => {
    const el = mediaRef.current;
    if (el) { el.volume = player.vol; el.muted = player.muted; }
  }, [player.vol, player.muted]);
  // 走带倍速改动后重算 playbackRate。clip 的 rate 仍是底数：媒体元素按 clip 换
  // key 重挂，attachMedia 会在换 clip 时重新乘一次，这里只管 rate 这一维。
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const projection = docRef.current && docRef.current.timelineProjection;
    const position = projection && T
      ? T.timelineToSource(projection, playerRef.current.t || 0, 'following')
      : null;
    const clip = position && projection.clips.find((item) => item.id === position.clipId);
    el.playbackRate = (clip ? clip.rate : 1) * (player.rate || 1);
  }, [player.rate]);
  useEffect(() => {
    if (!player.playing || mediaRef.current) return;
    let raf, last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      // 高刷屏上 dt 可能只有 4ms。与媒体时钟同一个阈值：位移不到 3ms 就不发
      // 新的 player 对象，省掉一次整条订阅链的重渲染（累计的 dt 不会丢）。
      if (dt < 0.003) { raf = requestAnimationFrame(tick); return; }
      last = now;
      setPlayer((p) => {
        const dur = (docRef.current && docRef.current.meta.duration) || 0;
        // 没有媒体元素时由模拟时钟走带，倍速要自己乘进 dt。
        const nt = p.t + dt * (p.rate || 1);
        return nt >= dur ? { ...p, t: dur, playing: false } : { ...p, t: nt };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player.playing]);
  useEffect(() => { const iv = setInterval(() => lsSet(LS_TIME, playerRef.current.t), 800); return () => clearInterval(iv); }, []);

  const seek = useCallback((t) => {
    const duration = (docRef.current && docRef.current.meta.duration) || 0;
    const timelineTime = Math.max(0, Math.min(duration, t));
    const el = mediaRef.current;
    const projection = docRef.current && docRef.current.timelineProjection;
    const position = projection && T ? T.timelineToSource(projection, timelineTime, 'following') : null;
    if (el && (!position || el.dataset.srcId === position.srcId)) {
      try { el.currentTime = position ? position.sourceTime : timelineTime; } catch (e) {}
    }
    setPlayer((p) => ({ ...p, t: timelineTime }));
  }, []);
  const seekSource = useCallback((srcId, sourceTime, occurrence = 0) => {
    const projection = docRef.current && docRef.current.timelineProjection;
    let placements = projection && T ? T.sourceToTimeline(projection, srcId, sourceTime) : [];
    if (!placements.length && projection && T && projection.views[srcId]) {
      const view = projection.views[srcId];
      const seam = T.sourceToViewAtSeam(view, sourceTime);
      const keptSource = T.viewToSource(view, seam, 'following');
      placements = T.sourceToTimeline(projection, srcId, keptSource);
    }
    seek(placements[occurrence] == null ? sourceTime : placements[occurrence]);
  }, [seek]);
  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (el) { if (el.paused) { el.play().catch(() => {}); } else { el.pause(); } return; }
    setPlayer((p) => ({ ...p, playing: !p.playing }));
  }, []);

  // ----- 用户编辑（直接提交 Transcript，不再创建第二份文本真相） -----
  const editCue = useCallback((cueId, field, value, sourceId = 'main') => {
    if (field !== 'text') return;
    const d = docRef.current || dataRef.current || {};
    const rows = sourceId === 'main' ? (d.cues || []) : (d.timelineCues || []);
    const base = rows.find((c) => sourceId === 'main'
      ? c.id === cueId
      : c.sourceId === sourceId && (c.sourceItemId || c.id) === cueId) || {};
    const baseText = base.text || '';
    if (value === baseText) return;
    applyTranscriptOps(
      [{ kind: 'sourceText', cueId, base: baseText, value }],
      '改字幕 ' + cueId,
      sourceId === 'main' ? null : { srcId: sourceId },
    );
  }, [applyTranscriptOps]);

  // 译文编辑：kind='piece' 改对齐片（key = "s-…#N"），kind='sentence' 整句
  // 改写（key = 句 id，改写后降级整句上屏、由 Agent 重切）。
  const editTrans = useCallback((key, kind, value, sourceId = 'main') => {
    const d = docRef.current || dataRef.current || {};
    const projected = sourceId && sourceId !== 'main'
      ? (d.timelineTransCues || []).find((item) =>
        item.sourceId === sourceId && item.sourceItemId === key && item.kind === kind)
      : null;
    const base = projected
      ? (projected.text || '')
      : kind === 'sentence'
        ? (((d.sentences || []).find((s) => s.id === key) || {}).trans || '')
        : (((d.transCues || []).find((tc) => tc.id === key) || {}).text || '');
    if (value === base) return;
    const lang = d.meta && d.meta.targetLang && d.meta.targetLang.code;
    applyTranscriptOps(
      [{ kind: 'translation', scope: kind, ref: key, base, value }],
      (sourceId === 'main' ? '改译文 ' : '改附加源译文 ') + key,
      { ...(sourceId === 'main' ? {} : { srcId: sourceId }), ...(lang ? { lang } : {}) },
    );
  }, [applyTranscriptOps]);

  const splitTransPiece = useCallback((pieceId, afterWord, charOffset, liveText) => {
    const d = docRef.current || {};
    const tc = translationSplitTarget(d, pieceId);
    if (!tc || !Number.isInteger(tc.wordFrom) || !Number.isInteger(tc.wordTo)
      || afterWord < tc.wordFrom || afterWord >= tc.wordTo) return false;
    // 有块层时片边界只能落在块边界上（对齐块设计 §5）；apply 侧还会再验一次。
    const AB = window.BCS_ALIGN_BLOCKS;
    const sentence = (d.sentences || []).find((row) => row.id === tc.sid);
    if (!tc.seedUnaligned && AB && sentence && !AB.isBlockBoundary(sentence, afterWord)) return false;
    const wordFrac = (afterWord - tc.wordFrom + 1) / (tc.wordTo - tc.wordFrom + 1);
    const targetText = typeof liveText === 'string' ? liveText : tc.text;
    const texts = splitTextAt(targetText, wordFrac, charOffset);
    if (!texts) return false;
    const sid = tc.sid;
    const op = {
      kind: 'split', sid, from: tc.wordFrom, to: tc.wordTo, at: afterWord,
      baseText: tc.text, textA: texts[0], textB: texts[1],
      ...(tc.seedUnaligned ? { seedUnaligned: true } : {}),
    };
    applyTranscriptOps(
      [{ kind: 'translationStructure', operation: op }],
      '拆分译文片 ' + pieceId,
    );
    return true;
  }, [applyTranscriptOps]);

  const splitTransPieceAtCaret = useCallback((pieceId, charOffset, liveText) => {
    const d = docRef.current || {};
    const tc = translationSplitTarget(d, pieceId);
    const targetText = tc && typeof liveText === 'string' ? liveText : tc && tc.text;
    if (!tc || !Number.isInteger(tc.wordFrom) || !Number.isInteger(tc.wordTo)
      || tc.wordFrom >= tc.wordTo || !targetText) return false;
    // 块层：光标吸附到最近的片内块边界（词边界与字符切点同时由块给出）；
    // 单块片没有合法拆分点，直接拒绝。无块层走下面按比例估词的旧路径。
    const AB = window.BCS_ALIGN_BLOCKS;
    const sentence = (d.sentences || []).find((row) => row.id === tc.sid);
    if (!tc.seedUnaligned && AB && sentence && AB.hasBlocks(sentence)) {
      // 块的 tgt 按码点计（对拍 Rust chars()），光标偏移是 UTF-16 单位：两头换算。
      const current = { ...tc, text: targetText };
      const siblings = AB.sentencePieces(d.transCues, tc.sid)
        .map((piece) => piece.id === tc.id ? current : piece);
      const caretCp = Array.from(targetText.slice(0, Math.max(0, charOffset | 0))).length;
      const snap = AB.snapSplit(sentence, siblings, current, caretCp);
      if (!snap || !snap.ok) return false;
      const cutUtf16 = Array.from(targetText).slice(0, snap.cut).join('').length;
      return splitTransPiece(pieceId, snap.afterWord, cutUtf16, targetText);
    }
    const frac = Math.max(0.01, Math.min(0.99, charOffset / targetText.length));
    const count = tc.wordTo - tc.wordFrom + 1;
    const afterWord = tc.wordFrom + Math.max(0, Math.min(count - 2, Math.round(frac * count) - 1));
    return splitTransPiece(pieceId, afterWord, charOffset, targetText);
  }, [splitTransPiece]);

  const mergeTransPieces = useCallback((upperRef, lowerRef) => {
    const d = docRef.current || {};
    if (!upperRef || !lowerRef || upperRef.sid !== lowerRef.sid) return false;
    const rows = (d.transCues || []).filter((row) => row.sid === lowerRef.sid && row.kind === 'piece')
      .sort((a, b) => a.wordFrom - b.wordFrom);
    const upper = rows.find((row) => row.wordFrom === upperRef.wordFrom
      && row.wordTo === upperRef.wordTo);
    const tc = rows.find((row) => row.wordFrom === lowerRef.wordFrom
      && row.wordTo === lowerRef.wordTo);
    if (!upper || !tc || upper.wordTo + 1 !== tc.wordFrom) return false;
    const sid = tc.sid;
    const op = {
      kind: 'merge', sid,
      upperFrom: upper.wordFrom, upperTo: upper.wordTo, upperText: upper.text,
      lowerFrom: tc.wordFrom, lowerTo: tc.wordTo, lowerText: tc.text,
    };
    applyTranscriptOps(
      [{ kind: 'translationStructure', operation: op }],
      '向上合并译文片 ' + lowerRef.id,
    );
    return true;
  }, [applyTranscriptOps]);

  const canMergeTransParagraph = useCallback((upperRef, lowerRef) => {
    const d = dataRef.current || {};
    if (!TP || !upperRef || !lowerRef) return false;
    const upper = (d.sentences || []).find((sentence) => sentence.id === upperRef.id);
    const lower = (d.sentences || []).find((sentence) => sentence.id === lowerRef.id);
    return TP.canMerge(d, upper, lower);
  }, []);

  // 跨 Sentence 合并：正在编辑的 piece / 整句先折成当前整卡 value，再与 paragraph
  // pin 删除一起提交。服务端用 upperBase/lowerBase 做双 CAS，并折叠所有语言真相。
  const mergeTransParagraph = useCallback((upperRef, lowerRef, editedSid, editedRef, liveText) => {
    const d = dataRef.current || {};
    if (!TP || !upperRef || !lowerRef) return false;
    const upper = (d.sentences || []).find((sentence) => sentence.id === upperRef.id);
    const lower = (d.sentences || []).find((sentence) => sentence.id === lowerRef.id);
    if (!upper || !lower) return false;
    let upperValue = TP.sentenceText(d, upper), lowerValue = TP.sentenceText(d, lower);
    if (editedSid === upper.id && typeof liveText === 'string') {
      upperValue = TP.sentenceTextReplacing(d, upper, editedRef, liveText);
    } else if (editedSid === lower.id && typeof liveText === 'string') {
      lowerValue = TP.sentenceTextReplacing(d, lower, editedRef, liveText);
    }
    const op = TP.operation(d, upper, lower, upperValue, lowerValue);
    if (!op) return false;
    applyTranscriptOps([op], '合并译文段落 ' + lower.id);
    return true;
  }, [applyTranscriptOps]);

  const retimeCue = useCallback((cueId, s, e) => {
    const base = ((dataRef.current || {}).cues || []).find((c) => c.id === cueId);
    if (!base) return;
    applyTranscriptOps(
      [{ kind: 'timing', cueId, base: [base.start, base.end], value: [s, e] }],
      '改时间码 ' + cueId,
    );
  }, [applyTranscriptOps]);

  const deleteOriginalCue = useCallback((cue) => {
    const op = SCE && SCE.operation(cue);
    if (!op) return false;
    applyTranscriptOps(
      [op],
      '删除原文字幕 ' + op.cueId,
    ).then((result) => {
      if (!result) return;
      setSel((current) => current && current.cueId === op.cueId ? null : current);
      toast('Subtitle cue deleted', {
        variant: 'neutral', action: { label: 'Undo', onClick: () => historyStep(false) },
      });
    });
    return true;
  }, [applyTranscriptOps, historyStep]);

  const editParagraph = useCallback((paragraph, value) => {
    const op = SPE && SPE.operation('edit', paragraph, value);
    if (!op || value === paragraph.text) return false;
    applyTranscriptOps([op], '改转写段落 ' + op.operation.id);
    return true;
  }, [applyTranscriptOps]);

  const editSpeaker = useCallback((speakerId, value) => {
    const speaker = (((dataRef.current || {}).speakers || {})[speakerId]);
    const op = SNE && SNE.operation(speakerId, speaker, value);
    if (!op || value.trim() === String((speaker && speaker.name) || '').trim()) return false;
    applyTranscriptOps([op], '重命名说话人 ' + speakerId).then((result) => {
      if (!result) return;
      toast('Renamed speaker everywhere', {
        variant: 'neutral', action: { label: 'Undo', onClick: () => historyStep(false) },
      });
    });
    return true;
  }, [applyTranscriptOps, historyStep]);

  const editChapter = useCallback((chapterId, value) => {
    const chapters = (docRef.current || dataRef.current || {}).chapters || [];
    const chapter = chapters.find((item) => item.id === chapterId);
    const op = CTE && CTE.operation(chapters, chapterId, value);
    if (!op || value.trim() === String((chapter && chapter.title) || '').trim()) return false;
    applyTranscriptOps([op], '重命名章节 ' + chapterId);
    return true;
  }, [applyTranscriptOps]);

  const splitParagraphAtCaret = useCallback((paragraph, value, charOffset) => {
    const offset = Array.from(String(value || '').slice(0, Math.max(0, charOffset | 0))).length;
    const op = SPE && SPE.operation('split', paragraph, value, offset);
    if (!op) return false;
    applyTranscriptOps([op], '拆分转写段落 ' + op.operation.id).then((result) => {
      if (!result) return;
      toast('Split paragraph', {
        variant: 'neutral', action: { label: 'Undo', onClick: () => historyStep(false) },
      });
    });
    return true;
  }, [applyTranscriptOps, historyStep]);

  const mergeParagraph = useCallback((paragraph, value, direction) => {
    const kind = direction < 0 ? 'mergeUp' : 'mergeDown';
    const op = SPE && SPE.operation(kind, paragraph, value);
    if (!op) return false;
    applyTranscriptOps([op], '合并转写段落 ' + op.operation.id).then((result) => {
      if (!result) return;
      toast(direction < 0 ? 'Merged with previous paragraph' : 'Merged with next paragraph', {
        variant: 'neutral', action: { label: 'Undo', onClick: () => historyStep(false) },
      });
    });
    return true;
  }, [applyTranscriptOps, historyStep]);

  // ----- 字幕拆 / 合：未提交文本与结构改动合成一个事务 -----
  // 拆合之前编辑框里可能有还没 blur 提交的文本。旧实现直接丢弃它再拆，用户输入
  // 无声蒸发；现在按序发 [sourceText, sourceStructure]，后端按请求顺序执行，
  // 结构 op 看到的就是刚落地的新文本，撤销时也只是一步。
  // 光标交接：拆合完成后把光标放回新文档的对应位置（消费方是 SubtitlePane）。
  const [pendingCaret, setPendingCaret] = useState(null);
  const clearPendingCaret = useCallback(() => { setPendingCaret(null); }, []);

  // okToast 是成功文案：结构 op 能不能生效只有后端复跑派生才知道，所以调用方不要
  // 自己乐观弹提示——成败两条提示都在这里等应答之后二选一发出。
  const structTx = useCallback((ops, label, caret, okToast) => {
    applyTranscriptOps(ops, label).then((result) => {
      if (!result) return;
      // 不受 nobreak 抑制的派生边界（说话人切换、段落分隔）会把 merge 整个抵消：
      // 后端返回 200 但只把它记进 noops，不写 history。此时结构根本没变，caret 里的
      // 锚点指向的是一条并不存在的接缝，交接过去会把光标甩到相邻位置，所以只提示、
      // 不交接。同一事务里的文本 op 仍可能已落地（applied 非空），文本不需要回滚。
      const noops = Array.isArray(result.noops) ? result.noops : [];
      if (noops.length) {
        toast((noops[0] && noops[0].reason) || '该操作未生效', { variant: 'neutral' });
        return;
      }
      if (okToast) toast(okToast, { variant: 'neutral' });
      if (caret) {
        setPendingCaret({ ...caret, rev: Number.isInteger(result.rev) ? result.rev : 0 });
      }
    });
    return true;
  }, [applyTranscriptOps]);

  const textOpIfDirty = (cue, liveText) => (typeof liveText === 'string' && liveText !== cue.text
    ? [{ kind: 'sourceText', cueId: cue.id, base: cue.text, value: liveText }]
    : []);

  // 光标交接按时间锚定而不是 cue id——id 由首词派生，拆合后必然改变。
  // 拆分后第二条永远占据原区间的尾部，取 end 前一丁点必定落在它身上（比"拆分点
  // 词起始时间"稳：后者可能落在真实词边界之前，把光标带到第一条去）。
  const splitCueAtCaret = useCallback((cue, liveText, offset) => {
    if (!cue) return false;
    const text = typeof liveText === 'string' ? liveText : cue.text;
    if (!text || !(offset > 0 && offset < text.length)) return false;
    const dur = Math.max(0.02, cue.end - cue.start);
    return structTx(
      [
        ...textOpIfDirty(cue, text),
        { kind: 'sourceStructure',
          operation: { kind: 'split', id: cue.id, baseText: text, offset,
            textA: text.slice(0, offset).trim(), textB: text.slice(offset).trim() } },
      ],
      '拆分字幕 ' + cue.id,
      { anchorTime: cue.end - Math.min(0.002, dur / 50), offset: 0 },
    );
  }, [structTx]);

  // 后端的 merge 语义是"这一条并入上一条"，所以向下合并发的是下一条的 id。
  // 合并后光标落在缝上：锚点取下条起点（必在合并后的区间内），偏移取上条文本长度
  // （无论后端用空格还是 CJK 直接拼接，缝的位置都在上条末尾）。
  const mergeCues = useCallback((upper, lower, editedId, liveText, okToast) => {
    if (!upper || !lower) return false;
    const edited = editedId === upper.id ? upper : editedId === lower.id ? lower : null;
    const textOps = edited ? textOpIfDirty(edited, liveText) : [];
    const upperText = edited === upper && typeof liveText === 'string' ? liveText : upper.text;
    return structTx(
      [...textOps, { kind: 'sourceStructure', operation: { kind: 'merge', id: lower.id } }],
      '合并字幕 ' + lower.id,
      { anchorTime: lower.start, offset: (upperText || '').length },
      okToast,
    );
  }, [structTx]);

  // ctx（'sub' | 'bi'）是给 `bcut studio apply` 的上下文提示：覆盖层是一份扁平
  // 补丁，服务端把其中的键下沉回 style.voiceInkContexts 时要知道它属于哪个上下文
  // （不带提示时按扁平 mode 判定，bi 上下文切到「仅原文」会与 sub 撞车）。覆盖层
  // 只有一个 style 对象，所以记的是最后一次写入的上下文（后写者胜）。
  const setStyle = useCallback((patch, ctx) => {
    const baseStyle = JSON.stringify((dataRef.current || {}).style || {});
    mutate((o) => {
      const prev = ((o.style || {}).base === baseStyle && o.style) || {};
      const value = { ...(prev.value || {}), ...patch };
      const hint = ctx === 'sub' || ctx === 'bi' ? ctx : prev.ctx;
      return { ...o, style: hint ? { base: baseStyle, value, ctx: hint } : { base: baseStyle, value } };
    }, '改样式');
  }, [mutate]);
  const resetStyle = useCallback(() => { mutate((o) => ({ ...o, style: null }), '重置样式'); }, [mutate]);

  // ----- Agent 请求队列（也在覆盖层里，Agent 直接读 studio/edits.json） -----
  // 必须先冻结引用：ov.requests 缺失时 `|| []` 每次渲染都是新数组，
  // 直接写进下面 value 的依赖数组会让 useMemo 每帧失效，整层优化白做。
  const reqs = useMemo(() => ov.requests || [], [ov.requests]);
  const request = useCallback((action, label, params) => {
    const item = { id: 'r' + Date.now(), ts: new Date().toISOString(), action, label, params: params || {}, status: 'pending' };
    mutate((o) => ({ ...o, requests: [...(o.requests || []), item] }), '请求 Agent：' + label);
    return item;
  }, [mutate]);
  const dropRequest = useCallback((id) => {
    mutate((o) => ({ ...o, requests: (o.requests || []).filter((r) => r.id !== id) }), '撤销请求');
  }, [mutate]);

  // ----- window.BC — Agent 侧浏览器 API（等价数据也在 studio/edits.json 文件里） -----
  useEffect(() => {
    window.BC = {
      doc: () => docRef.current,
      overlay: () => ovRef.current,
      edits: () => ovRef.current.edits || {},
      trans: () => ovRef.current.trans || {},
      transStruct: () => ovRef.current.transStruct || null,
      timing: () => ovRef.current.timing || {},
      struct: () => ovRef.current.struct || null,
      styleOverride: () => ovRef.current.style || null,
      requests: () => ovRef.current.requests || [],
      clearRequests: (ids) => {
        mutate((o) => ({ ...o, requests: (o.requests || []).filter((r) => ids && ids.length ? !ids.includes(r.id) : false) }), '清空请求');
      },
      clearEdits: () => { mutate(() => ({ ...EMPTY_OV }), 'Agent 已应用编辑'); },
      exportSRT: (mode) => exportSRT(docRef.current, mode || 'bi'),
      seek: (t) => seek(t),
      seekSource: (srcId, t, occurrence) => seekSource(srcId, t, occurrence),
    };
  }, [mutate, seek, seekSource]);

  // player 不在这里：它每帧都变，进来会让所有 useApp() 消费者跟着每帧重渲染。
  // 需要连续时间的组件用 usePlayer()，只需要"当前是哪一条"的用 useActive()，
  // 非渲染路径（键盘快捷键之类）读 playerRef.current。
  // 依赖顺序与下面的字段顺序一一对应，漏一个就是难查的过期闭包。
  const value = useMemo(() => ({
    data, doc, err, setPlayer, playerRef, paneScroll, seek, seekSource, togglePlay, attachMedia,
    sel, setSel, tab, setTab, panels, setPanel,
    styleOpen, styleCtx, openStyle, closeStyle,
    inspectorOpen, openInspector, closeInspector,
    wmOpen, openWatermark, closeWatermark,
    editCue, editTrans, splitTransPiece, splitTransPieceAtCaret, mergeTransPieces,
    canMergeTransParagraph, mergeTransParagraph,
    retimeCue, deleteOriginalCue, editParagraph, editSpeaker, editChapter, splitParagraphAtCaret, mergeParagraph,
    splitCueAtCaret, mergeCues, setStyle, resetStyle,
    // 叠加元素（文本 / 图片 / 水印）：写路径全部经 applyTimelineOps，
    // 动作层见 element-actions.jsx。
    applyTimelineOps, findElement, ...elementActions, patchElementLive, flushElementDraft,
    history: histFlags, undoDoc, redoDoc, pendingCaret, clearPendingCaret,
    reqs, request, dropRequest,
    exportBaseline, exportDelta, stampExport,   // 光速修正
    tasksLink: tasks.link,                      // 任务频道连接态
    paragraphs, cueAt, transCueAt, sentenceAt, chapterOf, cps, cpsLevel, exportSRT,
  }), [
    data, doc, err, setPlayer, seek, seekSource, togglePlay, attachMedia,
    sel, setSel, tab, setTab, panels, setPanel,
    styleOpen, styleCtx, openStyle, closeStyle,
    inspectorOpen, openInspector, closeInspector,
    wmOpen, openWatermark, closeWatermark,
    editCue, editTrans, splitTransPiece, splitTransPieceAtCaret, mergeTransPieces,
    canMergeTransParagraph, mergeTransParagraph,
    retimeCue, deleteOriginalCue, editParagraph, editSpeaker, editChapter, splitParagraphAtCaret, mergeParagraph,
    splitCueAtCaret, mergeCues, setStyle, resetStyle,
    applyTimelineOps, findElement, elementActions, patchElementLive, flushElementDraft,
    histFlags, undoDoc, redoDoc, pendingCaret, clearPendingCaret,
    reqs, request, dropRequest,
    exportBaseline, exportDelta, stampExport, tasks.link,
  ]);
  return (
    <AppCtx.Provider value={value}>
      <PlayerCtx.Provider value={player}>
        <ActiveProvider doc={doc}>{children}</ActiveProvider>
      </PlayerCtx.Provider>
    </AppCtx.Provider>
  );
}

Object.assign(window, { AppStore, useApp, usePlayer, useActive, BCS_MODEL: { paragraphs, cueAt, transCueAt, sentenceAt, chapterOf, cps, cpsLevel, exportSRT } });
})();
