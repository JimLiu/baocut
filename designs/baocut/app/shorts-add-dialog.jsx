/* 「从原片添加片段」对话框（§15.12）：来源项目的整份文稿，点一句定起点、再点一句定终点，
   选中的那一段放到这一支的时间轴上。不调模型；App 与 Web 共用。
   文稿可以有几小时长：行高固定，章节头也算一行，列表按行数虚拟化（model-shorts-cut.js 的 sourceRows / rowWindow）。 */
(function () {
  const {useState, useEffect, useMemo, useRef} = React;
  const D = window.BC_DATA;
  const SC = window.BC_SHORTS_CUT;

  const spColor = (sp) => (D.speakers[sp] ? `oklch(0.6 0.14 ${D.speakers[sp].hue})` : null);

  function SentenceRow({row, top, picked, edge, used, onPick}) {
    const s = row.sentence;
    const who = D.speakers[s.sp];
    return (
      <BCAction type="button" className={cx('sa-row', picked && 'is-sel', edge && 'is-edge', used && 'is-used')} style={{top}}
        aria-pressed={picked} onClick={() => onPick(row.index)}>
        <span className="sa-row__tc t-mono">{SC.mmss(s.start)}</span>
        <span className="sa-row__sp t-truncate">
          {who ? <i className="spkdot" style={{background: spColor(s.sp)}} /> : null}{who ? who.name : ''}
        </span>
        <span className="sa-row__tx t-truncate">{s.text}</span>
        {used ? <span className="sa-row__used">已用</span> : null}
      </BCAction>
    );
  }

  function ShortsAddDialog({ctx, pieces, sentences, parent, onClose, onAdd}) {
    const list = useRef(null);
    const [view, setView] = useState({top: 0, height: 320});
    const [a, setA] = useState(null);
    const [b, setB] = useState(null);
    const [where, setWhere] = useState('end');
    const chapters = useMemo(() => D.projectSetup(parent).chapters || [], [parent.id]);
    const rows = useMemo(() => SC.sourceRows(sentences, chapters), [sentences, chapters]);
    const used = useMemo(() => SC.usedIds(sentences, pieces), [sentences, pieces]);
    const sel = SC.selection(sentences, a, b);
    const win = SC.rowWindow(rows.length, view.top, view.height);

    /* 打开时落在这一支用到的最后一句附近：要加的多半是它前后的话 */
    useEffect(() => {
      const el = list.current;
      if (!el) return;
      let last = -1;
      rows.forEach((r, i) => { if (!r.head && used.has(r.id)) last = i; });
      el.scrollTop = Math.max(0, (last - 3) * SC.ROW_H);
      setView({top: el.scrollTop, height: el.clientHeight});
    }, []);

    const pick = (i) => {
      if (a == null || b != null) { setA(i); setB(null); } else setB(i);
    };
    const hint = a == null ? '点一句定起点，再点一句定终点。'
      : b == null ? `${sel.text} · 再点一句定终点，或者就加这一句。`
      : `${sel.text} · 原片 ${SC.mmss(sel.in)} – ${SC.mmss(sel.out)}`;
    const at = SC.insertPoint(pieces, where, ctx.playT);

    return (
      <Dialog open title="从原片添加片段" width={640} onClose={onClose} footer={[
        <Btn key="c" variant="secondary" onClick={onClose}>取消</Btn>,
        <Btn key="k" variant="accent" disabled={!sel} onClick={() => onAdd(sel, where)}>添加到时间轴</Btn>,
      ]}>
        <div className="sa-sub">「{parent.title}」的文稿 · {sentences.length} 句 · 已用的句子标了出来，也可以再用一次。</div>
        <div className="sa-list bc-scroll" ref={list} aria-label="来源视频的文稿"
          onScroll={(e) => setView({top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight})}>
          <div className="sa-virtual" style={{height: win.height}}>
            {rows.slice(win.start, win.end).map((row, k) => {
              const top = (win.start + k) * SC.ROW_H;
              if (row.head) return <div className="sa-chapter" key={row.id} style={{top}}><b className="t-truncate">{row.title}</b><span className="t-mono">{SC.mmss(row.at)}</span></div>;
              const picked = !!sel && row.index >= sel.from && row.index <= sel.to;
              return <SentenceRow key={row.id} row={row} top={top} picked={picked} used={used.has(row.id)}
                edge={picked && (row.index === sel.from || row.index === sel.to)} onPick={pick} />;
            })}
          </div>
        </div>
        <div className="sa-pick" aria-live="polite">{hint}</div>
        <div className="sa-where">
          <span>放在</span>
          <Segmented value={where} onChange={setWhere}
            items={[{k: 'end', label: '最后'}, {k: 'playhead', label: '播放头处'}]} />
          <span className="t-mono">{SC.mmss(at)}</span>
          {where === 'playhead' ? <span className="sa-where__note t-truncate">播放头压在片段中间时放到这一段后面，不把它劈开</span> : null}
        </div>
      </Dialog>
    );
  }

  Object.assign(window, {ShortsAddDialog});
})();
