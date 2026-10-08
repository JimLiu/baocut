/* 视频工具共用的视频选择器（product-design §2.7「选已有的，不要求先打开」）。
   读的是 Space 的目录：每部视频有没有文稿、什么语言、已有哪些译文与配音。筛选、排序、标注与置灰原因都在
   model-tool-targets.js（BC_TOOL_TARGETS.candidates）；这里只画：搜索框 + 单选列表，不能选的置灰并写清原因。 */
(function () {
  const {useState} = React;
  const R = window.RSP;
  const TT = window.BC_TOOL_TARGETS;

  /** 某个工具的候选（页面也用它算预选） */
  const rowsFor = (app, tool, q) => TT.candidates(tool, app.projects, {q});
  /** 预选：路由带来的视频能选就用它，否则第一部能选的 */
  const initial = (app, tool, want) => TT.pick(rowsFor(app, tool), want);

  function VideoPicker({tool, value, onChange, label}) {
    const app = useApp();
    const [q, setQ] = useState('');
    const rows = rowsFor(app, tool, q);
    const dirName = (id) => (id && app.dirById(id) ? app.dirById(id).name : '未归入项目');
    const ok = rows.filter((r) => r.eligible).length;
    return <div className="tvp">
      <div className="tvp__hd">
        <b className="grow">{label || '选一部视频'}</b>
        <span className="t-detail-xs">{TT.NEEDS[tool] === 'transcript' ? `${ok} 部有文稿可选，其余置灰` : `${ok} 部可选`}</span>
      </div>
      <R.SearchField aria-label="搜索视频" placeholder="按名字搜索" value={q} onChange={setQ} />
      {rows.length ? <R.RadioGroup aria-label={label || '选一部视频'} value={value || null} onChange={onChange} UNSAFE_className="tvp__list bc-scroll">
        {rows.map((r) => <R.Radio key={r.id} value={r.id} isDisabled={!r.eligible} UNSAFE_className={cx('tvp__row', value === r.id && 'is-on', !r.eligible && 'is-off')}>
          <span className="tvp__txt">
            <span className="tvp__t">{r.title}</span>
            <span className="tvp__d">{dirName(r.dir)}{r.dur ? ` · ${Math.round(r.dur / 60)} 分钟` : ''}</span>
            {r.eligible
              ? r.tags.length > 0 && <span className="tvp__tags">{r.tags.map((t) => <Chip key={t.k} tone={t.k === 'transcript' ? 'accent' : null}>{t.label}</Chip>)}</span>
              : <span className="tvp__why"><Ic n="info" className="ic--14" />{r.reason}</span>}
          </span>
        </R.Radio>)}
      </R.RadioGroup> : <Empty icon="film" title="没有匹配的视频">换个名字搜索，或先在 Space 里新建一部。</Empty>}
    </div>;
  }

  Object.assign(window, {VideoPicker, BC_VIDEO_PICKER: {rowsFor, initial}});
})();
