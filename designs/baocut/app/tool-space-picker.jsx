/* 工具页的 Space 选择器（product-design §2.7「页面」第 1 条、§4.5）：只列这个工具收的种类，回收站里的不列，
   带缩略图、种类、来源与状态；视频标出已有的文稿、译文与配音，不能选的置灰并写清原因。选中的条目成为这次的输入。
   筛选、排序与原因都在 model-tool-space-input.js（BC_TOOL_SPACE_INPUT.candidates），这里只画。
   缩略图借 Space 列表的预览块（space-list.jsx 的 SpaceItemPreview，在本文件之后加载，所以渲染时才取）。 */
(function () {
  const {useState} = React;
  const R = window.RSP;
  const SI = window.BC_TOOL_SPACE_INPUT;

  /**
   * @param {{tool: string, value: string|null, onChange: (entry) => void, attach?: boolean, label?: string, empty?: string}} props
   *   `attach`：选附加材料（文本生成附上的文档或字幕）
   */
  function ToolSpacePicker({tool, value, onChange, attach, label, empty}) {
    const app = useApp();
    const SP = window.BC_SPACE;
    const [q, setQ] = useState('');
    const rows = SI.candidates(tool, app.spaceItems || [], {q, attach, movies: app.projects});
    const ok = rows.filter((r) => r.eligible).length;
    const dirsById = {};
    (app.dirs || []).forEach((d) => { dirsById[d.id] = d; });
    const moviesById = {};
    (app.projects || []).forEach((m) => { moviesById[m.id] = m; });
    const kinds = SI.kindsFor(tool, attach).map((k) => SI.KIND_LABEL[k]).join('、');
    const Preview = window.SpaceItemPreview;
    const pick = (id) => { const r = rows.find((x) => x.id === id); if (r && r.eligible) onChange(r.entry); };
    return <div className="tvp tsp">
      <div className="tvp__hd">
        <b className="grow">{label || '从 Space 里选'}</b>
        <span className="t-detail-xs">收{kinds} · {ok} 个可选</span>
      </div>
      <R.SearchField aria-label="搜索 Space" placeholder="按名字搜索" value={q} onChange={setQ} />
      {rows.length ? <R.RadioGroup aria-label={label || '从 Space 里选'} value={value || null} onChange={pick} UNSAFE_className="tvp__list bc-scroll">
        {rows.map((r) => {
          const status = SP.statusText(r.entry);
          return <R.Radio key={r.id} value={r.id} isDisabled={!r.eligible} UNSAFE_className={cx('tvp__row', 'tsp__row', value === r.id && 'is-on', !r.eligible && 'is-off')}>
            <span className="tsp__item">
              <span className="tsp__thumb">{Preview ? <Preview it={r.entry} movie={moviesById[r.entry.movie || r.entry.id]} small /> : null}</span>
              <span className="tvp__txt">
                <span className="tvp__t t-truncate">{r.name}</span>
                <span className="tvp__d">{[r.kindLabel, SP.durationText(r.entry), SP.specText(r.entry), SP.sourceText(r.entry, dirsById, moviesById), status].filter(Boolean).join(' · ')}</span>
                {r.eligible
                  ? r.tags.length > 0 && <span className="tvp__tags">{r.tags.map((t) => <Chip key={t.k} tone={t.k === 'transcript' ? 'accent' : null}>{t.label}</Chip>)}</span>
                  : <span className="tvp__why"><Ic n="info" className="ic--14" />{r.reason}</span>}
              </span>
            </span>
          </R.Radio>;
        })}
      </R.RadioGroup> : <Empty icon="folder" title="Space 里没有能用的条目">{empty || `这个工具收${kinds}。换个名字搜索，或先从本机文件开始。`}</Empty>}
    </div>;
  }

  /** 选中之后的一行摘要（输入已经选好时，例如从 Space 查看器「用工具处理…」进来）：名字、种类与「换一个」 */
  function ToolSpaceChosen({entry, onClear, note}) {
    const SP = window.BC_SPACE;
    const Preview = window.SpaceItemPreview;
    const app = useApp();
    const movie = (app.projects || []).find((m) => m.id === (entry.movie || entry.id));
    return <div className="ttsw__sec tsp__chosen">
      <div className="tsp__item">
        <span className="tsp__thumb">{Preview ? <Preview it={entry} movie={movie} small /> : null}</span>
        <span className="tvp__txt grow">
          <span className="tvp__t t-truncate">{entry.name}</span>
          <span className="tvp__d">{[SI.KIND_LABEL[entry.kind], SP.durationText(entry), SP.specText(entry), note].filter(Boolean).join(' · ')}</span>
        </span>
        <Btn size="s" variant="quiet" onClick={onClear}>换一个</Btn>
      </div>
    </div>;
  }

  Object.assign(window, {ToolSpacePicker, ToolSpaceChosen});
})();
