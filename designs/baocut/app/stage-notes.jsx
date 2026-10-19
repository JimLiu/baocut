/* 视频标注（product-design §3.2.3「视频标注」、§5.3）：编辑器预览画面上的标注层（画已进草稿的标注），与 composer 上方、已发送消息里的
   「视频标注 · N 条」。画标注的手势归标记层与标记工具条（stage-markup.jsx；docs/design/lite-editor §4.1）：舞台工具条的「标记」打开，
   轻量与时间线两种视图同一套；按「添加到对话」或发评论时这一条进这部视频的草稿（store 的 `videoNotes[videoId]`），画面上出对应的标记。
   标记只画播放头附近那一帧的；别的时刻的在 composer 列表里，点一条跳到那个时刻。发送后草稿清空，标记随之消失。只在 App 入口加载。 */
(function () {
  const {useState, useRef} = React;
  const N = window.BC_STAGE_NOTES;
  const T = window.BC_TIME;

  const px = v => `${v * 100}%`;

  /* 画面上的一个标记：框是描边的矩形，箭头是一条带头的线，文字是一枚写着批注的签，编号是一枚圆点；都带整份草稿里的序号。
     点序号看批注，可以从对话里移除（草稿）；已发送的消息不画标记。 */
  function StageNoteMark({pin, onRemove}) {
    /* 轻量编辑器的标记工具送来的带 `style`（颜色、粗细）：按它的颜色画（stage-notes.css 的 .stnotes__mark[data-color]），别的仍是蓝 */
    return <div className="stnotes__mark" data-color={pin.style?.color} style={pin.style ? {'--stnw': pin.style.width} : undefined}><NoteMark pin={pin} onRemove={onRemove} /></div>;
  }
  function NoteMark({pin, onRemove}) {
    const R = window.RSP;
    const [open, setOpen] = useState(false);
    const anchor = useRef(null);
    const r = pin.region;
    const badge = <span ref={anchor} className="stnotes__badge">
      <R.ActionButton size="XS" aria-label={`标注 ${pin.n}：${pin.text}`} onPress={() => setOpen(v => !v)}>{pin.n}</R.ActionButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={280} label={`标注 ${pin.n}`}>
        <div className="home-design__pin-note">
          <p className="home-design__form-label">{pin.label}</p>
          <p>{pin.text}</p>
          <R.ActionButton isQuiet size="S" onPress={() => { setOpen(false); onRemove(pin.id); }}><R.Icons.Delete /><R.Text>从对话中移除</R.Text></R.ActionButton>
        </div>
      </Popover>
    </span>;
    if (pin.kind === 'box') return <div className="stnotes__box" style={{left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h)}}>{badge}</div>;
    if (pin.kind === 'arrow') return <>
      <svg className="stnotes__arrow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1={r.x * 100} y1={r.y * 100} x2={pin.to.x * 100} y2={pin.to.y * 100} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="stnotes__head" style={{left: px(pin.to.x), top: px(pin.to.y)}} aria-hidden="true" />
      <div className="stnotes__point" style={{left: px(r.x), top: px(r.y)}}>{badge}</div>
    </>;
    if (pin.kind === 'text') return <div className="stnotes__point stnotes__text" style={{left: px(r.x), top: px(r.y)}}>{badge}<span className="stnotes__label">{pin.text}</span></div>;
    /* 标记工具送来的：元素是一个虚线框（标签写它是谁），评论是一枚点（印章截图在 composer 列表里） */
    if (pin.kind === 'element') return <div className="stnotes__box stnotes__element" style={{left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h)}}>{badge}<span className="stnotes__label">{pin.element?.label}</span></div>;
    /* 轻量编辑器补的三种（docs/design/lite-editor §4）：直线是没有头的箭头，圆是画成椭圆的框，画笔是一条折线 */
    if (pin.kind === 'line') return <>
      <svg className="stnotes__arrow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1={r.x * 100} y1={r.y * 100} x2={pin.to.x * 100} y2={pin.to.y * 100} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="stnotes__point" style={{left: px(r.x), top: px(r.y)}}>{badge}</div>
    </>;
    if (pin.kind === 'ellipse') return <div className="stnotes__box stnotes__ellipse" style={{left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h)}}>{badge}</div>;
    if (pin.kind === 'pen') return <>
      <svg className="stnotes__arrow stnotes__pen" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={(pin.points || []).map(p => `${p.x * 100},${p.y * 100}`).join(' ')} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="stnotes__point" style={{left: px(pin.points?.[0]?.x ?? r.x), top: px(pin.points?.[0]?.y ?? r.y)}}>{badge}</div>
    </>;
    return <div className="stnotes__point" style={{left: px(r.x), top: px(r.y)}}>{badge}</div>;
  }

  /** 画面（`.frame`）里的标注层：有草稿时画这一帧的标记。层本身不接指针（手势归 stage-markup.jsx 的标记层），只有序号钮接。 */
  function StageNotesLayer({ctx}) {
    const app = useApp();
    const videoId = ctx.proj.id;
    const notes = app.videoNotes[videoId] || [];
    if (!notes.length) return null;
    const remove = id => app.setVideoNotes(videoId, N.remove(notes, id));
    const pins = N.pins(notes, videoId, ctx.playT);
    return <div className="stnotes" onClick={e => e.stopPropagation()}>
      {pins.map(pin => <StageNoteMark key={pin.id} pin={pin} onRemove={remove} />)}
    </div>;
  }

  /* composer 上方与已发送消息里的「视频标注 · N 条」：画法与幻灯片、设计稿标注的标签一家。点开列出各条：时刻与位置、批注，
     点一条跳到那部视频的那个时刻。给了 `onRemove` 是草稿，可以逐条移除或全部移除；不给是已发送的消息，只读。 */
  function VideoNotesToken({notes, onRemove, onClear}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const anchor = useRef(null);
    if (!notes?.length) return null;
    const draft = !!onRemove;
    const jump = n => {
      setOpen(false);
      if (!app.projById(n.video)) { app.toast('这部视频已移走或删除', 'negative'); return; }
      app.openMovie(n.video, {t: n.timeMs / 1000});
    };
    return <div ref={anchor} className="cins-token home-slides-notes">
      <BCAction className="home-slides-notes__open" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(v => !v)}>
        <window.RSP.Icons.Comment /><span>{N.tokenLabel(notes)}</span>
      </BCAction>
      {draft ? <IconBtn icon="close" size="xs" tip="移除全部视频标注" onClick={onClear} /> : null}
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={360} dir={draft ? 'up' : 'down'} label={N.tokenLabel(notes)}>
        <ol className="home-slides-notes__list bc-scroll">
          {notes.map((n, i) => <li key={n.id} className="home-slides-notes__item">
            <BCAction className="home-slides-notes__jump" aria-label={`第 ${i + 1} 条，${n.label}：${n.text}`} onClick={() => jump(n)}>
              <b className="home-slides-notes__n">{i + 1}</b>
              <span className="home-slides-notes__body"><small>{n.label}</small>{n.text ? <span>{n.text}</span> : null}
                {/* 附件：那一帧的截图（原型里画一块示意帧，评论另画印章；正式版是真截图，同一帧的标记共一张） */}
                {n.shot ? <span className="stnotes__shot" role="img" aria-label={n.shot.stamp ? `截图 · ${T.timecode(n.shot.timeMs / 1000)} · 印章在画面${N.place({...n.shot.stamp, w: 0, h: 0})}` : `截图 · ${T.timecode(n.shot.timeMs / 1000)} · 画着这一帧的标记`}>
                  {n.shot.stamp ? <span className="stnotes__shot-stamp" style={{left: px(n.shot.stamp.x), top: px(n.shot.stamp.y)}} /> : null}</span> : null}</span>
            </BCAction>
            {draft ? <IconBtn icon="close" size="xs" tip={`移除第 ${i + 1} 条标注`} onClick={() => { if (notes.length === 1) setOpen(false); onRemove(n.id); }} /> : null}
          </li>)}
        </ol>
      </Popover>
    </div>;
  }

  Object.assign(window, {StageNotesLayer, VideoNotesToken});
})();
