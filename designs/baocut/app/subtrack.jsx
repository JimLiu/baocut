/* 字幕轨的**增删入口**（第 108 轮从 panel-substyle.jsx 抽出来）。

   产品裁决：**文档只和 timeline 相关，timeline 上有什么字幕轨就显示什么**。所以
   「画面上是哪几条字幕」只有一份真相（`subStyle.tracks`），而改它的入口就这么几个：

     · timeline 字幕行的行头菜单 —— 拿下 / 放回（第 108 轮新增，见 timeline.jsx）
     · 语言入口（字幕 Tab / 翻译 Tab 的语言弹层）—— 「有译文，还没放上去」那一组
     · 字幕属性页页头那颗垃圾桶 —— 拿下当前这一条
     · 项目层自动落轨（转录完成一条源语言、翻译完成再一条译文，见 editor.jsx）

   **样式画廊不在这张名单上**：套一份样式只换涂装，落在当下这一份轨集上。此前它
   是名单上最靠前的一个（双语补一条译文轨、仅译文把源语言拿下来），第 108 轮退役。

   四个入口共用同一个 hook，是因为「拿下」与「放回」各带一条不能各写一遍的规矩：
   拿下时**最后一条拒绝**（拒绝要说得出理由），放回时**第三条起问一次**（软上限）。
   写路径本身仍在 editor.jsx 上（`removeSubTrack` / `addSubTrackBack` / `swapSubTrack`），
   这里只摆确认与 toast。 */
(function () {
  const S = window.BC_SUB;

  /** 拿下 / 放回。`editId` 是调用方当下的编辑对象（语言入口选中的那条、行头那一行），
   *  它只影响「换掉哪一条」的默认值。返回 `{put, drop, dialog}`——`dialog` 要挂进
   *  调用方的树里（软上限那一句确认）。 */
  function useSubTrackOps(ctx, editId) {
    const {useState} = React;
    const app = useApp();
    const [ask, setAsk] = useState(null);          // {track, swapId}

    /* 撤销一律退**整份文档**（`restoreSubStyle`，第 106 轮）：换轨那一支会连被换掉
       那条的字体颜色一起带走（`swapSubTrack` 继承样式），只退 tracks 名单退不干净。
       快照必须在处理器最上面取、显式传进来——写成在回调里读 `ctx.subStyle` 也能对
       （闭包里是旧那一份），但那是碰巧对，读的人分不出是有意还是漏了。 */
    const undoable = (before) => ({label: '撤销', undo: true,
      run: () => { ctx.restoreSubStyle(before); app.toast('已撤销'); }});
    const land = (track, note, before) => {
      app.toast('已把「' + track.name + '」' + note, 'positive', undoable(before));
    };

    /** 把一条轨从画面上拿下来。**不是删数据**——那门语言的 cue 与词级时间戳仍在文稿
     *  里，行头与语言入口都能把它放回来。只剩一条时拒绝：画面上一条字幕都没有是
     *  「隐藏字幕」那个开关的活儿，不是这里。返回拿下之后该落到哪一条上（拒绝时
     *  返回 null），调用方拿它挪自己的作用域。 */
    const drop = (id) => {
      const before = ctx.subStyle;
      const track = S.byId(before, id);
      const next = S.removeTrack(before, id);
      if (!track || next === S.tracks(before)) {
        app.toast('画面上只剩这一条字幕了——再拿下来就没有字幕了', 'notice');
        return null;
      }
      ctx.removeSubTrack(id);
      app.toast('已把「' + track.name + '」从画面上拿下来 · 时间轴行头能放回来',
        'positive', undoable(before));
      return (next[0] || {}).id || null;
    };

    const put = (track) => {
      const before = ctx.subStyle;
      const r = S.putBackMode(before, track, editId);
      if (r.mode === 'add') { ctx.addSubTrackBack(track); land(track, '放回画面', before); return; }
      setAsk({track, swapId: r.swapId});
    };

    const out = ask && ask.swapId ? S.byId(ctx.subStyle, ask.swapId) : null;
    const count = S.tracks(ctx.subStyle).length + 1;
    /* 整块只在 ask 有值时构造：`Dialog` 的 `open` 是在 props 求值**之后**才判的，
       footer 里那几行 `ask.track.name` 会先炸。 */
    const dialog = !ask ? null : (
      <Dialog open width={380} onClose={() => setAsk(null)}
        title={`画面上会有 ${count} 条字幕`}
        footer={[
          <Btn key="c" variant="secondary" onClick={() => setAsk(null)}>取消</Btn>,
          <div key="s" className="spacer" />,
          <Btn key="stack" variant="secondary" onClick={() => {
            const before = ctx.subStyle;
            const t = ask.track; setAsk(null); ctx.addSubTrackBack(t);
            land(t, `叠上去 · 现在 ${count} 条`, before);
          }}>再叠一条</Btn>,
          out ? (
            <Btn key="swap" variant="accent" onClick={() => {
              const before = ctx.subStyle;
              const t = ask.track; setAsk(null); ctx.swapSubTrack(out.id, t);
              land(t, `换掉了「${out.name}」`, before);
            }}>换成「{ask.track.name}」</Btn>
          ) : null,
        ]}>
        <div className="t-body-sm">
          {out
            ? <>「{ask.track.name}」已经翻好了。可以<strong>换掉</strong>现在这条「{out.name}」，
                也可以 {count} 条一起显示——竖屏里三条会占掉小半屏。</>
            : <>「{ask.track.name}」是源语言，画面上没有另一条源语言可以换——
                放回去就是 {count} 条一起显示。</>}
          <div style={{marginTop: 8, color: 'var(--gray-600)'}}>
            换语言不丢样式：新的那条会接着用被换掉那条的字体、颜色与效果。
          </div>
        </div>
      </Dialog>
    );
    return {put, drop, dialog};
  }

  Object.assign(window, {useSubTrackOps});
})();
