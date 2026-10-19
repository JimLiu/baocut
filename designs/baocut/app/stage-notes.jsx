/* 视频标注（product-design §3.2.3「视频标注」、§5.3）：编辑器预览画面上的标注层（画已进草稿的标注），与 composer 上方、已发送消息里的
   「视频标注 · N 条」。画标注的手势归标记层与标记工具条（stage-markup.jsx；docs/design/lite-editor §4.1）：舞台工具条的「标记」打开，
   轻量与时间线两种视图同一套；按「添加到对话」或发评论时这一条进这部视频的草稿（store 的 `videoNotes[videoId]`），画面上出对应的标记。
   标记只画播放头附近那一帧的；别的时刻的在 composer 列表里，点一条跳到那个时刻。发送后草稿清空，标记随之消失。只在 App 入口加载。 */
(function () {
  const {useState, useRef} = React;
  const N = window.BC_STAGE_NOTES;
  const T = window.BC_TIME;

  const px = v => `${v * 100}%`;   // composer 列表里截图上的印章位置

  /** 画在 SVG 里的种类（stage-markup.jsx 的 SvgMark）；文字、元素框是 HTML，编号与评论就是序号钮。 */
  const SVG_KINDS = new Set(['rect', 'ellipse', 'line', 'arrow', 'pen']);

  /* 画面上的一条标注：画法与标记层同一套（stage-markup.jsx 的 SvgMark、.mk__text、.mk__el），画出来什么样进了草稿还是什么样；
     只多一枚写着草稿里序号的钮（.stnotes__badge，跟标记的颜色）：编号就是那枚圆点，评论是那枚印章，别的落在标记的锚点上
     （画笔是第一个点）。点钮看批注，可以从对话里移除（草稿）；已发送的消息不画标记。 */
  function StageNoteMark({pin, mark, px, onRemove}) {
    const R = window.RSP;
    const UI = window.BC_MARKUP_UI;
    const [open, setOpen] = useState(false);
    const anchor = useRef(null);
    const p = px(mark);
    const at = px(mark.kind === 'pen' && mark.points?.[0] ? mark.points[0] : mark);
    const said = pin.text || pin.label;
    return <>
      {mark.kind === 'text' ? <div className="mk__text mk-c" data-color={mark.color} style={{left: p.x, top: p.y, fontSize: UI.TEXT_SIZE[mark.width] || 20}} aria-hidden="true">{mark.text}</div> : null}
      {mark.kind === 'element' ? <div className="mk__el mk-c" data-color={mark.color} style={{left: p.x, top: p.y, width: p.w, height: p.h}} aria-hidden="true"><span className="mk__el-label">{mark.element?.label}</span></div> : null}
      <span ref={anchor} className={cx('stnotes__badge mk-c', pin.kind === 'comment' && 'is-stamp')} data-color={mark.color} style={{left: at.x, top: at.y}}>
        <R.ActionButton size="XS" aria-label={`标注 ${pin.n}：${said}`} aria-expanded={open} aria-haspopup="dialog" onPress={() => setOpen(v => !v)}>{pin.n}</R.ActionButton>
        <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={280} label={`标注 ${pin.n}`}>
          <div className="home-design__pin-note">
            <p className="home-design__form-label">{pin.label}</p>
            {pin.text ? <p>{pin.text}</p> : null}
            <R.ActionButton isQuiet size="S" onPress={() => { setOpen(false); onRemove(pin.id); }}><R.Icons.Delete /><R.Text>从对话中移除</R.Text></R.ActionButton>
          </div>
        </Popover>
      </span>
    </>;
  }

  /** 画面（`.frame`）里的标注层：有草稿时画这一帧的标记。层本身不接指针（手势归 stage-markup.jsx 的标记层），只有序号钮接。
      线、框、圆、画笔在一张画面大小的 SVG 里（像素坐标，尺寸量 `frameRef`），别的是 HTML。 */
  function StageNotesLayer({ctx, frameRef}) {
    const app = useApp();
    const UI = window.BC_MARKUP_UI;
    const MK = window.BC_MARKUP;
    const size = UI.useFrameSize(frameRef);
    const videoId = ctx.proj.id;
    const notes = app.videoNotes[videoId] || [];
    if (!notes.length) return null;
    const remove = id => app.setVideoNotes(videoId, N.remove(notes, id));
    const frame = {w: size.w || 1, h: size.h || 1};
    const px = m => ({x: m.x * frame.w, y: m.y * frame.h, w: (m.w || 0) * frame.w, h: (m.h || 0) * frame.h});
    const pins = N.pins(notes, videoId, ctx.playT).map(pin => ({pin, mark: MK.fromNote(pin)}));
    return <div className="stnotes" onClick={e => e.stopPropagation()}>
      <svg className="mk__svg" aria-hidden="true">
        {pins.filter(({mark}) => SVG_KINDS.has(mark.kind)).map(({mark}) => <UI.SvgMark key={mark.id} m={mark} px={px} hit={false} />)}
      </svg>
      {pins.map(({pin, mark}) => <StageNoteMark key={pin.id} pin={pin} mark={mark} px={px} onRemove={remove} />)}
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
