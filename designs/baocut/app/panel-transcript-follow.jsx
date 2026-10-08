/* 文稿面板的播放跟随（词级）—— product-design §5.7。

     FollowWords          正在播的那一段原文按词元铺成 span：当前词 `is-now`（黄底），
                          已念过的 `is-played`（退灰，与 `.para.is-done` 同一条规矩）。
                          只换 EditableText 读态的子节点——拼起来仍是同一串字，
                          caretIndexFromPoint 的 TreeWalker 照样把点击换算成整段偏移，
                          单击进编辑、光标落在点的那个字上不受影响。
     usePlayFollow        列表的播放跟随（文稿、字幕、译文共用）：列表自己 scrollTo，不用
                          scrollIntoView，免得连带滚祖先。用户在播放中手动滚（滚轮 / 触摸拖 /
                          按在滚动条上）就停止跟随；面板内的 seek 或重新开始播放时恢复。
     useTranscriptFollow  文稿：当前词滚到列表中间（点段落、点时间码、点词都恢复跟随）。
                          字幕与译文列表直接用 usePlayFollow 的 'nearest'：正在播的那条滚进视野、
                          不居中（panel-subtitle.jsx / panel-translate.jsx）。

   词元与时间都来自 BC_FOLLOW.paraWords（BC_CUT.tokens + rangeTime，cue 内按字符比例近似）。 */
(function () {
  const {useRef, useEffect, useCallback} = React;
  const FW = window.BC_FOLLOW;

  /** @param words `{toks, now, played}`；@param shades cue 底纹区间（与 Hl 同一份），
      词元起点落在哪条底纹里就带上 `cue-shade`——两者都是字符区间，叠得起来。 */
  function FollowWords({text, words, shades}) {
    const s = String(text == null ? '' : text);
    const shaded = (k) => (shades || []).some((r) => k.s >= r.start && k.s < r.end);
    return <>{words.toks.map((k, i) => (
      <span key={i} className={cx('para__w', shaded(k) && 'cue-shade', i === words.now && 'is-now', i < words.played && 'is-played')}>
        {s.slice(k.s, k.e)}
      </span>
    ))}</>;
  }

  /** 跟随滚动的通用部分。每次渲染量一次目标：`locate(list)` 给出要跟的节点（找不到就原地
      不动），`place` 为 'center'（滚到中间）或 'nearest'（滚进视野即可）；算出来的位置和上一次
      发出的相差不到 1px 就不再发。`hold` 为真（正在编辑）时不滚。
      返回 `{resume, listProps}`：`listProps` 展开到滚动容器上（用 React 事件而不是
      addEventListener——转录中面板换成实时态时容器不在，挂不上）。 */
  function usePlayFollow({listRef, playing, hold, locate, place}) {
    const off = useRef(false);       // 用户在播放中手动滚开了
    const last = useRef(null);       // 上一次发出的 scrollTop
    const playingRef = useRef(playing); playingRef.current = playing;
    const resume = useCallback(() => { off.current = false; last.current = null; }, []);
    useEffect(() => { if (playing) resume(); }, [playing]);
    useEffect(() => {
      const list = listRef.current;
      if (!playing || off.current || hold || !list) return;
      const node = locate(list);
      if (!node) return;
      const box = list.getBoundingClientRect(), r = node.getBoundingClientRect();
      const elTop = r.top - box.top + list.scrollTop;
      const top = place === 'nearest'
        ? FW.nearestTop(list.scrollTop, list.clientHeight, elTop, r.height, list.scrollHeight)
        : FW.centerTop(list.scrollHeight, list.clientHeight, elTop, r.height);
      if (last.current != null && Math.abs(top - last.current) < 1) return;
      last.current = top;
      if (Math.abs(top - list.scrollTop) >= 1) list.scrollTo({top, behavior: 'smooth'});
    });
    // 只认用户输入，不监听 scroll——自己发出的 smooth scrollTo 也会派发 scroll
    const manual = () => { if (playingRef.current) off.current = true; };
    const listProps = {
      onWheel: manual,
      onTouchMove: manual,
      // 按在容器本身（滚动条、空白边距）而不是子元素上
      onPointerDown: (e) => { if (e.target === e.currentTarget) manual(); },
    };
    return {resume, listProps};
  }

  /** 文稿的跟随：`activeId` 是播放头所在的段，跟它的当前词、滚到中间（同一行里换词不滚，
      换行才滚一次）。 */
  function useTranscriptFollow({listRef, playing, activeId, edit}) {
    const locate = (list) => {
      if (!activeId) return null;
      const para = list.querySelector(`[data-para="${activeId}"]`);
      if (!para) return null;
      // 这段按词铺开了：有当前词就跟它；落在停顿里就原地不动，不回退到段卡（否则每个停顿都拽一下）
      return para.querySelector('.para__w') ? para.querySelector('.para__w.is-now') : para;
    };
    return usePlayFollow({listRef, playing, hold: edit, locate, place: 'center'});
  }

  Object.assign(window, {FollowWords, usePlayFollow, useTranscriptFollow});
})();
