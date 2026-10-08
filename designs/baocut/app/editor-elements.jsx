/* 画布元素的状态层 —— §14.2（第 58 轮从 editor.jsx 拆出来）。
   一处存四样东西，都是**逐元素**的：起止（时间轴与属性页共用）、动画（In/Out/Loop）、
   摆位 `pose`（x/y/w/scale/rot，字段名与核心 `bcut-timeline` 一致）、文字的字符样式。

   为什么不进画布共用的样式袋（`elStyle`）：那个袋子里的键按类型天然不重叠
   （fill / tint / waveStyle…），而 In/Out/Loop 每类都有——给贴纸设一次入场，
   整屏元素条会全都长出动画带。文字的字符样式第 58 轮起同理：画面上可以有很多块
   文字，共用一份的话，新加一块黄色强调会把刚写好的白色标题一起染黄。 */
(function () {
  const {useState, useCallback, useMemo} = React;
  const D = window.BC_DATA;
  const E = window.BC_EL;

  const NO_ANIM = {in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}};

  /* 成员的文字与样式跟成员走，写在同一张表里（成员 id 唯一）——组视图、时间轴的
     成员行、成员属性页因此读的是同一份。建组时把预设自带的那份种进去。 */
  const seedMembers = (m, el) => {
    (el.members || []).forEach((x) => {
      m[x.id] = {text: x.text, style: x.style || null, delay: x.delay || 0,
        /* 第 59 轮起成员还带**自己的落位与动画**：那 51 条文字预设里，下三分与标题
           那两组本来就是各件各摆、各件各进场的，压成一列居中文本就不是那张卡了。 */
        place: x.place || null, shape: x.shape || null,
        anim: x.anim || NO_ANIM};
    });
  };

  function useElementStore(pick, empty = false, seed = [], sourceName = D.sources.video[0].name) {
    const initialVideos = window.BC_VIDEO_EDIT.initial(D.clips, sourceName);
    /* 历史栈的挂钩（第 115 轮）：[editor-history.jsx](editor-history.jsx) 把
       `mark` 装进来，每一次**离散**写入（改文档、增删）之前记一条快照；手势每帧写
       pose 的那条路不走这里，由 mousedown/mouseup 那对 begin/commit 管。 */
    const commitRef = React.useRef(null);
    const mark = React.useCallback((tag) => {
      if (commitRef.current) commitRef.current(tag);
    }, []);
    // 画布元素样式：画布工具条与元素属性页写同一份（§14.2；键名对照见 BC_EL.SHARED）
    const [elStyle, setElStyleRaw] = useState(D.canvasStyle);
    const [elDocs, setElDocsRaw] = useState(() => {
      const m = {};
      (empty ? seed : D.elements.concat(initialVideos)).forEach((e) => {
        m[e.id] = {start: e.start, end: e.end == null ? D.DUR : e.end, anim: NO_ANIM,
          pose: Object.assign({scale: 1, rot: 0}, e.place), style:e.style,
          keyframes: e.keyframes || null, duck: e.duck || null};
        seedMembers(m, e);
      });
      return m;
    });

    const setElDoc = useCallback((id, patch) => {
      mark(id + ':' + Object.keys(patch || {}).join(','));
      setElDocsRaw((s) => Object.assign({}, s, {[id]: Object.assign({}, s[id], patch)}));
    }, [mark]);
    // pose 是 elDocs 里的一个子袋，单独给一个写口子：手势每一帧都在写它
    const setElPose = useCallback((id, patch) => {
      mark('pose:' + id);
      setElDocsRaw((s) => Object.assign({}, s,
        {[id]: Object.assign({}, s[id], {pose: Object.assign({}, s[id] && s[id].pose, patch)})}));
    }, [mark]);

    /* ---------- 新建元素（第 58 轮） ----------
       `D.elements` 那十一条是**演示装置**（十一类各一条，一开始就在画面上）；用户点目录
       造出来的元素住在这里。两条合成一份 `ctx.elements`，时间轴与画布都只读这一份。 */
    const [added, setAdded] = useState(empty ? seed : initialVideos);
    // 删掉的演示元素（用户造的那些直接从 `added` 里拿走，不需要这张表）
    const [dropped, setDropped] = useState(empty ? D.elements.map(e => e.id) : []);
    /* 「已经放到画面上」的按需元素（进度条 / 声波 / 计时 / 占位 / overlay / 取景框）。
       第 115 轮之前它们的「在不在画面上」＝「选没选中」，取消选中就消失；现在选中
       一次就留在画面上，直到被删除。十一条演示装置不能一开始全铺上去（整幅 overlay
       会把画面糊掉），所以这一份不是 `D.elements` 的过滤器，只是舞台的绘制名单。 */
    const [shown, setShown] = useState([]);
    const showEl = useCallback((id) => setShown((list) => (list.indexOf(id) < 0 ? list.concat([id]) : list)), []);
    /* 真正把元素从画面与时间轴上拿走的那一步；单删与批量删共用。 */
    const dropIds = useCallback((ids) => {
      setAdded((list) => list.filter((e) => ids.indexOf(e.id) < 0));
      setDropped((list) => list.concat(ids.filter((id) => list.indexOf(id) < 0)));
      setShown((list) => list.filter((id) => ids.indexOf(id) < 0));
    }, []);
    const seqRef = React.useRef(0);
    const nextSeq = useCallback(() => (seqRef.current += 1), []);
    const addElement = useCallback((el, opts) => {
      if (!(opts && opts.quiet)) mark();
      setAdded((list) => list.concat([el]));
      setElDocsRaw((s) => {
        const next = Object.assign({}, s, {[el.id]: {
          start: el.start, end: el.end, anim: el.anim || NO_ANIM, text: el.text,
          transitions: el.transitions || null,
          members: el.members || null, box: el.box || null,
          style: el.style || null, pose: Object.assign({scale: 1, rot: 0}, el.place, el.pose),
          /* 关键帧与闪避（G11a）跟着元素走：粘贴 / 再制 / 撤销删除都不得丢 */
          keyframes: el.keyframes || null, duck: el.duck || null}});
        seedMembers(next, el);
        return next;
      });
      setDropped((list) => list.filter((x) => x !== el.id));
      showEl(el.id);
      if (!(opts && opts.quiet)) pick({kind: 'element', id: el.id, elKind: el.kind});
      return el;
    }, [pick, showEl, mark]);
    /* 删除就是删除：用户造的从 `added` 里拿走，演示元素进 `dropped`——两条路都让它从
       画布与时间轴上真的消失。此前演示元素只是取消选中，得在 toast 里解释一句「演示
       元素不删除」，那是把原型的装置讲给用户听。 */
    const removeElement = useCallback((id, opts) => {
      if (!(opts && opts.quiet)) mark();
      dropIds([id]);
      if (!(opts && opts.quiet)) pick(null);
    }, [dropIds, mark, pick]);
    /** 批量删除：多选删除是**一条**历史，所以不在这里 mark，也不动选中。 */
    const removeElements = useCallback((ids) => dropIds(ids), [dropIds]);
    /** 撤销删除：原样放回去（用户造的连文字与样式一起，演示的解除隐藏并重新选中） */
    const restoreElement = useCallback((el) => {
      if (el.added) { addElement(el); return; }
      mark();
      setDropped((list) => list.filter((x) => x !== el.id));
      showEl(el.id);
      pick({kind: 'element', id: el.id, elKind: el.kind});
    }, [addElement, mark, pick, showEl]);

    /* 文字的字符样式**跟着元素走**（第 58 轮）：画面上现在可以有很多块文字，共用一份
       样式袋的话，加一块黄色强调会把刚写好的白色标题一起染黄。其余十一类每类只有一条
       演示元素，仍读共用袋——袋里的键按类型天然不重叠（fill / tint / waveStyle…）。 */
    const setElStyle = useCallback((patch, id) => {
      /* 记一条（第 122 轮验收补）：这一口子此前是**唯一**不进历史栈的离散写入——
         兄弟俩 `setElDoc` / `setElPose` 都记，样式不记。代价不是「少一步可撤销」，
         是**⌘Z 会跳过它去撤上一件事**：改完颜色按撤销，颜色不动，刚新建的那条元素
         没了。tag 里带上 id 与键名，取色器拖着连写的那一串按 900ms 窗口并成一条。 */
      mark('style:' + (id || '*') + ':' + Object.keys(patch || {}).join(','));
      if (id) { setElDocsRaw((s) => Object.assign({}, s,
        {[id]: Object.assign({}, s[id], {style: Object.assign({}, s[id] && s[id].style, patch)})})); return; }
      setElStyleRaw((s) => Object.assign({}, s, patch));
    }, [mark]);
    const elStyleOf = useCallback((id) => {
      const own = (elDocs[id] || {}).style;
      return own ? Object.assign({}, elStyle, own) : elStyle;
    }, [elDocs, elStyle]);

    /* 拿掉文本组里的一条成员（`group` 是投影出来的那条记录，成员表在它身上）。
       空了就整组一起走——一个没有成员的组在画布与时间轴上都是一条什么都不画的空行。 */
    const removeMember = useCallback((group, memberId) => {
      const list = E.dropMember(group.members, memberId);
      if (!list.length) { removeElement(group.id); return; }
      setElDoc(group.id, {members: list});
      pick({kind: 'element', id: group.id, elKind: 'textgroup'});
    }, [pick, removeElement, setElDoc]);

    // 时间轴与属性页都读这一份投影：D.elements 的静态 start/end 只当初值用
    const elements = useMemo(() => D.elements.concat(added)
      .filter((e) => dropped.indexOf(e.id) < 0)
      .map((e) => {
        const out = Object.assign({}, e, elDocs[e.id], {endAnchor: e.end == null});
        const mem = E.projectMembers(e, elDocs);
        if (mem) out.members = mem;
        return out;
      }),
    [elDocs, added, dropped]);
    /** 成员 id → 它所属的那个组（画布选中、面板返回都要问这一句） */
    const groupOf = useCallback((memberId) => elements
      .filter((e) => (e.members || []).some((m) => m.id === memberId))[0] || null, [elements]);


    /* ---------- 历史栈的存取（第 115 轮） ----------
       快照只取「文档层」四样：新增表、删除表、绘制名单、逐元素文档。 */
    const elSnapshot = useCallback(() => ({added, dropped, shown, elDocs}),
      [added, dropped, shown, elDocs]);
    const elRestore = useCallback((snap) => {
      if (!snap) return;
      setAdded(snap.added); setDropped(snap.dropped);
      setShown(snap.shown); setElDocsRaw(snap.elDocs);
    }, []);

    /** 入口切换重置；`seed` 给出时（剪口播实验项目，第 193 轮）元素表只装它，演示装置全不上 */
    const resetEntry = useCallback((empty, seed) => {
      const docs = {};
      (empty ? [] : seed || D.elements.concat(initialVideos)).forEach(e => {
        docs[e.id] = {start: e.start, end: e.end == null ? D.DUR : e.end, anim: NO_ANIM,
          pose: Object.assign({scale: 1, rot: 0}, e.place), style: e.style,
          keyframes: e.keyframes || null, duck: e.duck || null};
        seedMembers(docs, e);
      });
      /* 种子里若有演示元素本尊（a2v 入口只装 e-wav，第 225 轮）：它已在 D.elements 里，
         不再进 added（否则投影里出现两条），也不进 dropped */
      const demoIds = D.elements.map(e => e.id);
      setAdded(empty ? [] : seed ? seed.filter(e => demoIds.indexOf(e.id) < 0) : initialVideos);
      setDropped(empty || seed ? demoIds.filter(id => !(seed || []).some(e => e.id === id)) : []);
      setElDocsRaw(docs); setShown([]);
      setElStyleRaw(D.canvasStyle);
    }, []);

    return {elStyle, setElStyle, elStyleOf, elDocs, setElDoc, setElPose, elements,
      addElement, removeElement, removeElements, restoreElement, removeMember, groupOf, nextSeq,
      shown, showEl, elSnapshot, elRestore, resetEntry, elCommitRef: commitRef};
  }

  Object.assign(window, {useElementStore});
})();
