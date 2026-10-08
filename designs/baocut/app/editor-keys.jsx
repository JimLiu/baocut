/* 快捷键与剪贴板 —— 第 115 轮（§4 / §5）。
   ============================================================================
   编辑器这一屏此前**一个编辑快捷键都没有**：Delete 不删、⌘Z 不撤销、⌘C/⌘V 没有，
   `main.jsx` 里那条 `s` 分支还是个空壳（注释写着「这里只保证不误触」）。这一份把
   键盘层收成一处：一个 window keydown，读的选中、历史、剪贴板与其它入口是同一份。

   守卫两条：焦点在输入框（INPUT / TEXTAREA / SELECT / contentEditable）里不接；
   有 `.scrim`（确认框、快捷键清单）时整层让开——弹层自己接 Esc。

   剪贴板是**进程内**的（不碰系统剪贴板：这里复制的是元素文档，不是文本）。

   播放中借全屏播放器的键（2026-09-24）：没有选中可推的东西、正在播放（段落预览不算）时，
   ←/→ 跳 5 秒、↑/↓ 调音量，步长与全屏同一组（model-player.js `stepTime` / `stepVolume`）；
   ⇧←/⇧→ 仍是 1 秒。K / J / L / M 不看播放态：播放 / 暂停、跳 10 秒、静音。选中压过播放——
   选中了元素或版面图层，方向键照旧推它。C、0–9、⇧←/→ 跳章节只留在全屏。
   ============================================================================ */
(function () {
  const {useState, useRef, useEffect} = React;
  const SEL = window.BC_SELECT;
  const POSE = window.BC_POSE;
  const D = window.BC_DATA;
  const TL = window.BC_TL;
  const SUB = window.BC_SUB;
  const PL = window.BC_PLAYER;

  const SHEET = [
    ['删除选中', 'Delete'],
    ['取消选中 / 关闭弹层', 'Esc'],
    ['播放 / 暂停', 'Space / K'],
    ['撤销 / 重做', '⌘Z / ⇧⌘Z'],
    ['复制 / 剪切 / 粘贴', '⌘C / ⌘X / ⌘V'],
    ['再制', '⌘D'],
    ['全选播放头下的元素', '⌘A'],
    ['播放头前后一帧（播放中：前后 5 秒）', '← / →'],
    ['播放头前后一秒', '⇧← / ⇧→'],
    ['后退 / 前进 10 秒', 'J / L'],
    ['播放中：音量 +10 / −10（调大自动取消静音）', '↑ / ↓'],
    ['静音 / 取消静音', 'M'],
    ['微调选中元素的位置', '方向键（⇧ 走 5%，⌥↑ / ⌥↓ 走 0.1%）'],
    ['版面编辑器里微调选中图层', '方向键（⇧ 走 5%，⌥ 走 0.1%）'],
    ['微调选中元素的时间', '⌥← / ⌥→'],
    ['时间轴放大 / 缩小 / 100%', '⌘= / ⌘− / ⌘0'],
    ['时间轴适应窗口 / 当前片段 / 播放头 / 所选', '⌥⌘1 / ⌥⌘2 / ⌥⌘3 / ⌥⌘4'],
    ['在播放头处分割', 'S'],
    ['进入全屏播放（没选中元素时）', 'F'],
    ['选中的画面元素移到最前 / 移到最后', 'F / B'],
    ['选中的画面元素前移 / 后移一层', '⌘↑ / ⌘↓'],
    ['跳到片头 / 片尾', 'Home / End'],
    ['打开编辑器快捷键清单', '?'],
  ];

  const inField = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

  function useEditorKeys(ctx) {
    const app = useApp();
    const [sheet, setSheet] = useState(false);
    /* 事件处理器只挂一次，靠这几个 ref 读当下的真相。 */
    const ref = useRef(ctx);
    ref.current = ctx;
    const clipRef = useRef([]);
    const sheetRef = useRef(false);
    sheetRef.current = sheet;
    const genRef = useRef(0);

    const elSels = () => ref.current.sels.filter((s) => s.kind === 'element');

    /* 选中的元素打包成可粘贴的条目：记录 + 它的文档（文字、样式、摆位都在文档里）。 */
    const pack = () => ref.current.sels.map((s) => {
      const c = ref.current;
      if (s.kind !== 'element') return null;
      const el = (c.elements || []).find((e) => e.id === s.id);
      return el ? {el, doc: Object.assign({}, c.elDocs[s.id])} : null;
    }).filter(Boolean);

    /* 没有元素可操作时说清楚为什么。 */
    const excuse = (verb) => {
      const s = ref.current.sel;
      if (s && s.kind === 'cue') app.toast('选中的是一条字幕 · 在 Subtitle 面板里改');
      else app.toast(`先选中要${verb}的元素`);
    };

    /* 造副本：粘贴与再制走同一条，多件是**一条**历史。 */
    const spawn = (items) => {
      const c = ref.current;
      if (!items.length) return 0;
      const n = (genRef.current += 1);
      c.history.begin();
      const made = items.map(({el, doc}) => {
        const span = SEL.pasteSpan({start: doc.start, end: el.endAnchor ? null : doc.end}, c.playT, D.DUR);
        const pose = SEL.pasteOffset(POSE.poseOf(doc), n);
        /* 成员 id 一起换：文本组照抄成员 id 的话，两组会写进同一份成员文档。 */
        const mem = (doc.members || el.members || null);
        return c.addElement(Object.assign({}, el, {
          id: SEL.pasteId(el.id, n), added: true, endAnchor: undefined,
          name: String(el.name || '元素').replace(/ · 副本$/, '') + ' · 副本',
          text: doc.text, asset: doc.asset || el.asset, style: doc.style || null, anim: doc.anim || null,
          transitions: doc.transitions || null,
          keyframes: doc.keyframes || null, duck: doc.duck || null,
          members: mem ? mem.map((m) => Object.assign({}, m, {id: SEL.pasteId(m.id, n)})) : null,
          start: span.start, end: span.end, place: null, pose,
        }), {quiet: true});
      });
      c.history.commit();
      c.pickMany(made.map((e) => ({kind: 'element', id: e.id, elKind: e.kind})));
      return made.length;
    };

    const undoAction = () => ({label: '撤销', undo: true, run: () => ref.current.history.undo()});

    const copy = (quiet) => {
      const items = pack();
      if (!items.length) { if (!quiet) excuse('复制'); return 0; }
      clipRef.current = items;
      if (!quiet) app.toast(items.length > 1 ? `已复制 ${items.length} 个元素` : '已复制元素', 'positive');
      return items.length;
    };

    const del = () => {
      const c = ref.current;
      /* 就地改字时按 Delete 是删字符，不是删元素——这里能走到，说明编辑态该收了
         （contentEditable 上的键已经被守卫拦在外面）。 */
      if (c.stopEdit) c.stopEdit();
      /* 删什么由 `BC_SELECT.removeTarget` 定——transport 的删除钮读同一条判据决定灰不灰 */
      const target = SEL.removeTarget(c.sels, c.sel);
      if (!target) { excuse('删除'); return; }
      if (target.kind === 'subs') {
        const track = SUB.byId(c.subStyle, target.trackId);
        c.removeSubTrack(target.trackId);
        c.clearSel();
        app.toast(`已移除字幕轨「${(track || {}).name || target.trackId}」`, 'positive',
          {label: '撤销', undo: true, run: () => track && c.addSubTrackBack(track)});
        return;
      }
      const ids = target.ids;
      c.history.begin();
      c.removeElements(ids);
      c.history.commit();
      c.clearSel();
      app.toast(ids.length > 1 ? `已删除 ${ids.length} 个元素` : '已删除元素', 'positive', undoAction());
    };

    const paste = () => {
      if (!clipRef.current.length) { app.toast('剪贴板是空的 · 先按 ⌘C 复制一个元素'); return; }
      const n = spawn(clipRef.current);
      app.toast(n > 1 ? `已粘贴 ${n} 个元素` : '已粘贴元素', 'positive', undoAction());
    };

    const cut = () => {
      if (!copy(true)) { excuse('剪切'); return; }
      const c = ref.current;
      const ids = elSels().map((s) => s.id);
      c.history.begin();
      c.removeElements(ids);
      c.history.commit();
      c.clearSel();
      app.toast(ids.length > 1 ? `已剪切 ${ids.length} 个元素` : '已剪切元素', 'positive', undoAction());
    };

    const duplicate = () => {
      const items = pack();
      if (!items.length) { excuse('再制'); return; }
      const n = spawn(items);
      app.toast(n > 1 ? `已再制 ${n} 个元素` : '已再制元素', 'positive', undoAction());
    };

    const clipboard = {copy, cut, paste, duplicate, remove: del, openSheet: () => setSheet(true)};

    useEffect(() => {
      const onKey = (e) => {
        const c = ref.current;
        if (inField(e.target)) return;
        /* 全屏播放时键盘整个让给播放器（第 222 轮，player.jsx 自己在捕获阶段接）：
           这一层的键都要有一个「被选中的东西」才有意义，观看面上没有——继续接只会
           让人在看片时按 ⌫ 删掉一件元素，而画面上根本看不见它没了。 */
        if (c.fs) return;
        // 弹层自己接键：对话框 / sheet 铺 `.scrim`，Popover（含右键菜单）挂 `data-pop`
        if (document.querySelector('.scrim, [data-pop], dialog[open], [role="dialog"][data-rac], [role="alertdialog"]')) return;
        const meta = e.metaKey || e.ctrlKey;
        const k = e.key;
        const low = k.length === 1 ? k.toLowerCase() : k;
        const stop = () => { e.preventDefault(); e.stopPropagation(); };
        const elIds = c.sels.filter((s) => s.kind === 'element').map((s) => s.id);

        if (meta) {
          /* 时间轴缩放：⌘= / ⌘− / ⌘0、⌥⌘1–4（菜单提示的同一组），动作与菜单共用 `timelineZoom`。 */
          const zk = TL.zoomKey(e);
          if (zk) { stop(); window.timelineZoom(c, zk, app.toast); return; }
          /* ⌘↑ / ⌘↓：选中的一件画面元素前移 / 后移一层（画布「层级」的两行，timeline-trackorder.jsx） */
          if ((k === 'ArrowUp' || k === 'ArrowDown') && !e.shiftKey && !e.altKey) {
            if (elIds.length === 1) { stop(); window.arrangeElement(c, elIds[0], k === 'ArrowUp' ? 'forward' : 'backward', app.toast); }
            return;
          }
          if (low === 'z') {
            stop();
            const ok = e.shiftKey ? c.history.redo() : c.history.undo();
            if (!ok) app.toast(e.shiftKey ? '没有可重做的操作' : '没有可撤销的操作');
          } else if (low === 'y') {
            stop();
            if (!c.history.redo()) app.toast('没有可重做的操作');
          } else if (low === 'c') { stop(); copy(); }
          else if (low === 'x') { stop(); cut(); }
          else if (low === 'v') { stop(); paste(); }
          else if (low === 'd') { stop(); duplicate(); }
          else if (low === 'a' && !e.shiftKey) {
            stop();
            const n = c.selectAll();
            app.toast(n ? `已选中 ${n} 个元素` : '播放头这一刻画面上没有元素');
          }
          return;
        }

        /* 成片时钟上跳（剪辑折叠后与全屏同口径），夹在成片时长内。 */
        const jumpOut = (d) => {
          const tm = c.tmap, dur = c.outDuration || D.DUR;
          const o = PL.stepTime(tm ? tm.fold(c.playT) : c.playT, d, dur);
          c.seek(tm ? tm.unfold(o) : o);
        };
        const stepVol = (dir) => {
          const v = PL.stepVolume(c.vol, dir * 10);
          c.setVol(v);
          c.setMuted(dir > 0 ? false : v === 0);
        };
        /* 真在播：段落预览（peek）借用了传输，不算。 */
        const playing = c.playing && !c.peek;

        if (k === ' ') { stop(); c.setPlaying(!c.playing); return; }
        if (!e.altKey && !e.shiftKey) {
          if (low === 'k') { stop(); c.setPlaying(!c.playing); return; }
          if (low === 'j') { stop(); jumpOut(-10); return; }
          if (low === 'l') { stop(); jumpOut(10); return; }
          if (low === 'm') { stop(); c.setMuted(!c.muted); return; }
        }
        if (k === 'Escape') {
          stop();
          if (c.peek) c.setPeek(null);
          else if (sheetRef.current) setSheet(false);
          else if (c.pop) c.setPop(null);
          else c.clearSel();
          return;
        }
        if (k === 'Delete' || k === 'Backspace') { stop(); del(); return; }
        if (k === '?') { stop(); setSheet(true); return; }
        /* 进全屏与退全屏是同一个键（退在 player.jsx 那侧接）。**必须在这一拍里**向
           浏览器要全屏：`requestFullscreen` 只认瞬时用户激活，按键就是那个手势，挪进
           effect 里发就晚了——与舞台工具条那颗钮同一条路。 */
        /* F：选中一件画面元素时是「移到最前」，没选中时进全屏；B：选中的画面元素移到最后。 */
        const arrangeOne = (dir) => elIds.length === 1 && c.sels.length === 1 && window.arrangeElement(c, elIds[0], dir, app.toast);
        if (low === 'f' && !e.altKey && !e.shiftKey && elIds.length === 1 && c.sels.length === 1) { stop(); arrangeOne('front'); return; }
        if (low === 'f') { stop(); window.enterFullscreen(); c.setFs(true); return; }
        if (low === 'b' && !e.altKey && !e.shiftKey) { if (arrangeOne('back')) stop(); return; }
        if (low === 's') { stop(); c.split(); return; }
        if (k === 'Home') { stop(); c.seek(0); return; }
        if (k === 'End') { stop(); c.seek(D.DUR); return; }

        if (/^Arrow(Left|Right|Up|Down)$/.test(k)) {
          const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
          const dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
          /* 版面编辑器：方向键挪选中的图层（1%，⇧ 5%，⌥ 0.1%），与元素同一套步长；
             走 studioBox（草稿），「完成」才写回。 */
          const studio = c.tplStudio;
          const layer = studio && studio.sel && studio.draft.layers.find((l) => l.id === studio.sel);
          if (layer) {
            stop();
            const step = e.altKey ? 0.1 : e.shiftKey ? 5 : 1;
            const TPL = window.BC_TPL;
            c.studioBox(layer.id, TPL.clampBox(Object.assign({}, layer.box,
              {x: Math.round((layer.box.x + dx * step) * 10) / 10, y: Math.round((layer.box.y + dy * step) * 10) / 10})));
            return;
          }
          /* ⌥←/→：整条元素在时间轴上前后挪（保长）。 */
          if (elIds.length && e.altKey && dx) {
            stop();
            const d = (e.shiftKey ? 1 : SEL.FRAME) * dx;
            c.history.begin();
            elIds.forEach((id) => {
              const doc = c.elDocs[id] || {};
              const start = Math.max(0, (doc.start || 0) + d);
              const shift = start - (doc.start || 0);
              c.setElDoc(id, {start, end: doc.end == null ? null : Math.min(D.DUR, doc.end + shift)});
            });
            c.history.commit('nudge-time');
            return;
          }
          /* 有元素选中：方向键改摆位（⇧ 一次 5%；⌥↑/↓ 一次 0.1%——⌥←/→ 已让给时间微调，
             与几何面板 NumField 的 ⌥ 步长同一档）。 */
          if (elIds.length && (!e.altKey || dy)) {
            stop();
            const step = e.altKey ? 0.1 : e.shiftKey ? 5 : 1;
            c.history.begin();
            elIds.forEach((id) => c.setElPose(id, SEL.nudge(POSE.poseOf(c.elDocs[id]), dx * step, dy * step)));
            c.history.commit('nudge-pose');
            return;
          }
          /* 播放中没选中东西：借全屏的键。⇧←/→ 仍是 1 秒；⌥ 方向键不接。 */
          if (playing && !e.altKey) {
            if (dy) { stop(); stepVol(-dy); return; }
            if (!e.shiftKey) { stop(); jumpOut(dx * 5); return; }
          }
          if (dx) { stop(); c.seek(SEL.frameStep(c.playT, dx, {shift: e.shiftKey, dur: D.DUR})); }
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);

    const sheetEl = (
      <Dialog open={sheet} title="快捷键" width={420} onClose={() => setSheet(false)}
        footer={<Btn variant="secondary" onClick={() => setSheet(false)}>知道了</Btn>}>
        <div className="col gap6">
          {SHEET.map(([label, keys]) => (
            <div className="row" key={label}>
              <span className="grow">{label}</span>
              <i className="kbd">{keys}</i>
            </div>
          ))}
        </div>
        <div className="hint">光标在输入框里时这些键全部让位给输入。全屏播放有自己的一张键表——在全屏里按 <i className="kbd">?</i> 看。</div>
      </Dialog>
    );

    return {clipboard, sheet: sheetEl};
  }

  Object.assign(window, {useEditorKeys, BC_EDITOR_SHORTCUTS: SHEET});
})();
