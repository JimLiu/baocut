/* AI 工具 · 参数页上用到本机语义的几行（embedding-integration-design §2.2、§2.3、§2.8）。
   · 写作的「范围」多一项「按主题」：用户在提示词里写的意图句就是查询，本机挑出相关段落、按时间排好再发给模型；
     「查看挑选的段落」可以勾掉或加回。没装模型时这一项置灰并写「需要本机语义模型」+ 去设置；索引在更新时提醒但不拦。
   · 系列写作：同一项目里有文稿的几部视频一起写，出处带视频名（§2.2 第 4 条）。
   · 生成章节：「边界：按话题自动检测 / 由模型决定」（§2.3）。
   · 剪成短视频：可选的「主题」一句（§2.8）。
   纯逻辑在 model-tool-semantic.js；状态在 semantic-state.jsx。Web 没有 AI 工具 Tab，不加载本文件。 */
(function () {
  const {useState, useMemo} = React;
  const D = window.BC_DATA;
  const TS = window.BC_TOOL_SEMANTIC;
  const C = window.BC_WRCITES;
  const SEM = D.semantic;

  const Row = ({label, children}) => <div className="tsetup__row"><span className="tsetup__lb">{label}</span>{children}</div>;
  const chOf = (t) => (D.chapters || []).find((h) => t >= h.start && t < h.end);

  /* ---------- Space 搜索「用于写作」带来的预选材料（§2.1）：打开写作工具时范围落在「按主题」、挑选的段落就是这几句 ---------- */
  const preset = {movie: null, cues: null, query: null};
  /* query：搜的那句话；交给 Agent 时写进意图，让它自己用 speech_relevant 再找一遍 */
  function setPreset(movie, cues, query) { preset.movie = movie; preset.cues = cues; preset.query = query || null; }
  const peekPreset = (pid) => (preset.movie === pid && preset.cues && preset.cues.length ? preset.cues : null);
  const peekQuery = (pid) => (peekPreset(pid) ? preset.query : null);
  function takePreset(pid) { const c = peekPreset(pid); if (c) { preset.movie = null; preset.cues = null; preset.query = null; } return c; }

  /* ---------- 按主题 + 系列 ---------- */
  /** 写作参数页用：返回 {scopes, picked, setPicked, series, setSeries, topicOn, context}；
      scopes 交给 ToolSetup 追加在标准范围后面。 */
  function useTopic(ctx, scope) {
    const [, sem] = window.BC_SEMSTATE.useSemantic();
    const [picked, setPicked] = useState(() => takePreset(ctx.proj.id) || SEM.topicPick);
    const [series, setSeries] = useState([]);
    const cues = ctx.cues && ctx.cues.length ? ctx.cues : D.cues;
    const covered = TS.chaptersCovered(picked, cues, D.chapters);
    const opt = TS.topicScope(sem, picked.length, covered);
    const topicOn = !!(scope && scope.k === 'topic' && sem.usable);
    const context = {topic: topicOn ? {paras: picked.length, chapters: covered} : null, series: series.length ? series.length + 1 : 0};
    return {scopes: [opt], picked, setPicked, series, setSeries, topicOn, context, sem, covered};
  }

  /** 范围行下面那一行：按主题时「挑了几段 · 查看挑选的段落」；按主题不可用时那一句原因；索引在更新时的提醒 */
  function TopicRows({t, ctx, scope}) {
    const [open, setOpen] = useState(false);
    const dflt = TS.topicDefault({usable: t.sem.usable, duration: ctx.duration || 206});
    return (
      <>
        {t.topicOn ? (
          <div className="wtopic__line">
            <span className="t-detail-xs">{`按提示词挑了 ${t.picked.length} 段，覆盖 ${t.covered} 章，按时间排好再发给模型`}</span>
            <BCAction className="tsetup__lnk" onClick={() => setOpen(true)}>查看挑选的段落</BCAction>
          </div>
        ) : null}
        {!t.sem.usable ? <window.SemNote entry="topic" className="wtopic__note" /> : null}
        {t.topicOn && t.sem.stale ? <window.SemNote entry="topic" className="wtopic__note" /> : null}
        {t.sem.usable && !t.topicOn && (!scope || scope.k === 'all') && !dflt.why
          ? <div className="wtopic__line"><span className="t-detail-xs">这部视频不长，缺省整篇；超过 30 分钟或超出模型上下文时缺省按主题。</span></div> : null}
        <SeriesRow t={t} ctx={ctx} />
        {open ? <PickedDialog t={t} ctx={ctx} onClose={() => setOpen(false)} /> : null}
      </>
    );
  }

  /** 挑中的段落：勾掉或加回。没挑中的按时间列在下面（演示视频只列前 21 句，后面是重复的样句） */
  function PickedDialog({t, ctx, onClose}) {
    const cues = (ctx.cues && ctx.cues.length ? ctx.cues : D.cues).slice(0, 21);
    const [on, setOn] = useState(() => new Set(t.picked));
    const flip = (id, v) => setOn((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });
    const rows = (list) => list.map((c) => (
      <div key={c.id} className="wtopic__row">
        <Checkbox on={on.has(c.id)} onChange={(v) => flip(c.id, v)} aria-label={c.text}
          label={<span className="wtopic__rowl"><span className="wcite__srct">{C.mmss(c.start)}</span>
            <span className="wcite__srcx">{c.text}</span><span className="wtopic__ch">{(chOf(c.start) || {}).title || ''}</span></span>} />
      </div>
    ));
    const pickedRows = cues.filter((c) => t.picked.indexOf(c.id) >= 0);
    const rest = cues.filter((c) => t.picked.indexOf(c.id) < 0);
    const apply = () => { t.setPicked(cues.filter((c) => on.has(c.id)).map((c) => c.id)); onClose(); };
    return (
      <Dialog open title="挑选的段落" onClose={onClose} width={600}
        footer={<><Btn variant="secondary" onClick={onClose}>取消</Btn><Btn variant="accent" disabled={!on.size} onClick={apply}>{`用这 ${on.size} 段`}</Btn></>}>
        <p className="t-detail wtopic__lead">本机按提示词里的意图句挑的，按时间排。勾掉不想让模型看到的，或从下面加回。只决定模型看到什么，不改原文。</p>
        <SecHead aside={`${pickedRows.length} 段`}>挑中的</SecHead>
        <div className="wtopic__list">{rows(pickedRows)}</div>
        <SecHead aside={`${rest.length} 段`}>没挑中的</SecHead>
        <div className="wtopic__list">{rows(rest)}</div>
      </Dialog>
    );
  }

  /** 系列：同一项目里有文稿的几部视频（Space 选择器的简版）；切出的短视频内容已在来源视频里，列出但不可选 */
  function SeriesRow({t, ctx}) {
    const [open, setOpen] = useState(false);
    const dir = ctx.proj.dir;
    const vids = (D.projects || []).filter((p) => p.dir === dir && p.id !== ctx.proj.id && p.status === 'complete');
    if (!vids.length) return null;
    const names = t.series.map((id) => (vids.find((v) => v.id === id) || {}).folder).filter(Boolean);
    return (
      <>
        <Row label="视频">
          <span className="t-body-sm wtopic__grow">{names.length ? `这部 + ${names.join('、')}` : '只这部'}</span>
          <BCAction className="tsetup__lnk" onClick={() => setOpen(true)}>{names.length ? '改…' : '加同项目的视频…'}</BCAction>
        </Row>
        {open ? (
          <Dialog open title="一起写的视频" onClose={() => setOpen(false)} width={480}
            footer={<Btn variant="accent" onClick={() => setOpen(false)}>好</Btn>}>
            <p className="t-detail wtopic__lead">同一项目里有文稿的视频。选材跨这几部进行，出处带视频名；结果仍是一份文档。</p>
            <div className="wtopic__list">
              <div className="wtopic__row"><Checkbox on disabled label={`${ctx.proj.folder || ctx.proj.title}（这部）`} /></div>
              {vids.map((v) => {
                const why = (SEM.seriesExclude || {})[v.id];
                return (
                  <div key={v.id} className="wtopic__row">
                    <Checkbox on={t.series.indexOf(v.id) >= 0} disabled={!!why} label={v.folder || v.title}
                      onChange={(on) => t.setSeries((xs) => (on ? xs.concat([v.id]) : xs.filter((x) => x !== v.id)))} />
                    {why ? <span className="t-detail-xs">{why}</span> : null}
                  </div>
                );
              })}
            </div>
          </Dialog>
        ) : null}
      </>
    );
  }

  /* ---------- 生成章节的边界（§2.3） ---------- */
  function BoundaryRow({value, onChange}) {
    const [, sem] = window.BC_SEMSTATE.useSemantic();
    const cur = value || TS.boundaryDefault(sem);
    const b = TS.BOUNDARY.find((x) => x.k === cur);
    return (
      <>
        <Row label="边界">
          <Segmented size="s" value={cur} onChange={onChange}
            items={TS.BOUNDARY.map((x) => ({k: x.k, label: x.label}))} />
        </Row>
        {sem.usable ? <div className="wtopic__line"><span className="t-detail-xs">{b.sub}</span></div>
          : <window.SemNote entry="chapters" className="wtopic__note" />}
      </>
    );
  }
  /** 没装模型时「按话题自动检测」不能用：选了也按由模型决定跑 */
  const effectiveBoundary = (value, sem) => (sem.usable ? (value || 'topic') : 'model');

  /* ---------- 剪成短视频的主题（§2.8） ---------- */
  function ShortsTopicRow({value, onChange}) {
    const [, sem] = window.BC_SEMSTATE.useSemantic();
    const r = TS.shortsTopic(value, sem);
    return (
      <>
        <Row label="主题">
          <Field size="s" className="wtopic__grow" placeholder="可空：比如「为什么做本地」，只在讲这件事的片段里找"
            value={value} onChange={(e) => onChange(e.target.value)} />
        </Row>
        {r.blocked ? <window.SemNote entry="shorts" className="wtopic__note" />
          : <div className="wtopic__line"><span className="t-detail-xs">{r.note}</span></div>}
      </>
    );
  }

  /** 交给 Agent 的附加句：主题写了且能用时一句「只在讲「…」的片段里找」 */
  const shortsExtra = (topic) => { const r = TS.shortsTopic(topic, window.BC_SEMANTIC.status(window.BC_SEMSTATE.get())); return r.extra ? [r.extra] : []; };

  Object.assign(window, {BC_WRTOPIC: {setPreset, peekPreset, peekQuery, useTopic, TopicRows, BoundaryRow, effectiveBoundary, ShortsTopicRow, shortsExtra}});
})();
