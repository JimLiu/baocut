/* 导出弹层的「文稿」页 —— §17.1（第 239 轮从字幕页拆出来）。
   ============================================================================
   字幕文件是「带时间轴的行」，文稿是「按段落读的文章」——语言轴、格式轴、选项都不一样，
   硬放一页只会互相干扰。这一页回答四件事：

     语言   开关：源语言一行 + 每门已译完的译文一行（行形状与控件同字幕页「导哪几条」）；
            默认只开源语言——文稿是「读的文章」，双语对照是要点一下才有的事；
            只开源 = 原文、只开译文 = 译文、都开 = 双语对照（逐段并排）。
            至少留一行（唯一开着的那行置灰）；双语只配一门译文，开另一门会换掉当前那门
     格式   Markdown（章节成小标题、说话人加粗）/ 纯文本
     带什么 文首元信息 · 章节标题 · 段落时间戳 · 说话人 · 跳过已剪段——都是真开关
            （开关的词与顺序取自 BC_TX.TEXT_OPTS，与文稿面板的复制设置同一组；
             文首元信息 = YAML frontmatter，只 Markdown 生效、纯文本时置灰；勾选记在偏好 `txFrontmatter`，缺省勾选；
             章节标题只在视频没有章节时置灰；说话人与跳过已剪段任何时候都能切）
     出去是什么样   底下一块只读、可滚动的预览，整篇正文照最终排法排出来；右上角的图标按钮复制全文，
            复制成功后变成绿色对勾，3 秒后变回复制图标（2026-10-07 定稿；底栏不再有「复制文本」）

   正文由 BC_TX.exportText 生成（排法见那里的头注，与 Runtime 同一套）。
   「跳过已剪段」按 BC_CUT.dropped 筛：整段落在剪口里的段才丢，半截被剪的留着——原型以段落为粒度
   近似 Runtime 的序列投影；关掉时是整份源文稿，时间是源时间。
   演示口径：段落上只挂一门译文（`para.trans`），切到别的译文语言时正文不变，只换文件名。 */
(function () {
  const {useState, useMemo, useEffect} = React;
  const D = window.BC_DATA;
  const X = window.BC_EXPORT;
  const TX = window.BC_TX;
  const CH = window.BC_CH;
  const CUT = window.BC_CUT;

  /* 复制成功后对勾停留多久 */
  const COPIED_MS = 3000;

  function ExportTranscript({ctx, base, onClose}) {
    const app = useApp();
    const langOpts = useMemo(() => X.txLangOptions(D.srcLang.code, D.srcLang.name, D.transLangs), []);
    const [langSel, setLangSel] = useState({src: true, trans: null});
    const [fmt, setFmt] = useState('md');
    const [st, setSt] = useState({chapters: true, time: true, speaker: true, skipCut: true});
    const [copied, setCopied] = useState(false);
    useEffect(() => {
      if (!copied) return undefined;
      const t = setTimeout(() => setCopied(false), COPIED_MS);
      return () => clearTimeout(t);
    }, [copied]);
    const opt = X.txLangPick(langSel, langOpts);
    const transRows = langOpts.filter((o) => o.lang === 'trans');
    const langRows = [{key: 'src', name: langOpts[0].sub, sub: '原文'}].concat(transRows.map((o) => ({key: o.code, name: o.label, sub: '译文'})));
    const flip = (k) => setSt((s) => Object.assign({}, s, {[k]: !s[k]}));
    /* 文首元信息跨会话记住：存在偏好里，没存过就是勾选 */
    const frontmatter = app.prefs.txFrontmatter !== false;
    /* 没章节时章节标题是灰的，生效值也按「没有」算——摘要行不写一个不存在的东西；
       跳过已剪段没有剪口时也能切（勾着就是「有剪口就跳过」） */
    const hasCh = !!ctx.chapters.length;
    const eff = Object.assign({}, st, {chapters: st.chapters && hasCh, frontmatter: frontmatter && fmt === 'md'});

    const paras = useMemo(() => eff.skipCut ? ctx.paras.filter((p) => !CUT.dropped(ctx.cuts, p)) : ctx.paras,
      [ctx.paras, ctx.cuts, eff.skipCut]);
    const dropped = ctx.paras.length - paras.length;
    const sections = useMemo(() => CH.sections(ctx.chapters, paras), [ctx.chapters, paras]);
    const text = useMemo(() => TX.exportText(sections, {fmt, lang: opt.lang, chapters: eff.chapters, time: eff.time,
      speaker: eff.speaker, speakers: D.speakers, title: ctx.proj.title,
      meta: eff.frontmatter ? TX.projectMeta(ctx.proj, {language: D.srcLang.code, translation: opt.lang === 'src' ? '' : opt.code}) : null}),
      [sections, fmt, opt, st, hasCh, eff.frontmatter]);
    const file = X.transcriptName(base, opt, fmt, D.srcLang.code);
    const parts = X.transcriptSummary(opt, fmt, eff);
    const empty = !paras.length;

    /* 成功只换图标（绿色对勾），不再弹 toast；失败照旧弹负向 toast */
    const copy = () => copyToClipboard(text).then((ok) => ok
      ? setCopied(true)
      : app.toast('复制失败 · 浏览器拒绝了剪贴板权限', 'negative'));
    const save = () => {
      app.toast('已导出 ' + file, 'positive', {label: '在文件夹中显示', run: () => {}});
      onClose();
    };

    return (
      <>
        <div className="cpsec">语言</div>
        <div className="xlanes">
          {langRows.map((r) => {
            const on = X.txLangChecked(langSel, r.key);
            return (
              <div key={r.key} className={cx('xlane', !on && 'is-off')}>
                <Ic n="transcript" className="ic--16 xlane__ic" />
                <div className="xlane__nm"><b>{r.name}</b><span>{r.sub}</span></div>
                <Switch on={on} disabled={X.txLangLocked(langSel, r.key)} onChange={() => setLangSel((s) => X.txLangToggle(s, r.key))} />
              </div>
            );
          })}
        </div>
        {transRows.length > 1 ? <div className="xnote">译文一次只能配一门 · 开另一门会换掉当前这门</div> : null}
        <div className="xquick">
          <div className="xquick__f">
            <span className="xquick__lb">格式</span>
            <Segmented size="s" value={fmt} onChange={setFmt} items={X.TX_FORMATS.map((f) => ({k: f.k, label: f.label}))} />
          </div>
        </div>
        <div className="xnote">{(X.TX_FORMATS.find((f) => f.k === fmt) || X.TX_FORMATS[0]).note}</div>

        <div className="cpsec">带什么</div>
        {/* 与文稿面板的复制设置同一组开关（transcript-copy.jsx） */}
        <TxTextChecks eff={eff} disabled={{frontmatter: fmt !== 'md', chapters: !hasCh}}
          onFlip={(k) => (k === 'frontmatter' ? app.setPref('txFrontmatter', !frontmatter) : flip(k))} />
        {fmt !== 'md' ? <div className="xnote">文首元信息只在 Markdown 里写</div> : null}
        {!hasCh ? <div className="xnote">这部视频没有章节 · 章节标题来自时间轴上的章节标记</div> : null}
        {st.skipCut
          ? (dropped ? <div className="xnote">{dropped} 段整段在剪口里，不进文稿 · 半截被剪的段落照常保留</div> : null)
          : <div className="xnote">会包含时间轴上已剪掉的部分 · 时间按原始素材算</div>}

        <div className="cpsec">出去是什么样</div>
        <div className="xtxpv">
          <pre className="xtxpv__text" tabIndex={0} aria-label="文稿预览">{empty ? '还没有文稿' : text}</pre>
          <IconBtn size="s" className={cx('xtxpv__copy', copied && 'is-done')} icon={copied ? 'check' : 'copy'}
            tip={copied ? '已复制' : '复制文本'} disabled={empty} onClick={copy} />
        </div>

        <div className="xsum">
          <div className="xsum__row"><span>将导出</span><b>{parts.join(' · ')}</b></div>
          <div className="xsum__row"><span>文件</span><b className="t-mono">{file}</b></div>
          <div className="xsum__row"><span>篇幅</span><b>{empty ? '—' : TX.copyReceipt(paras, opt.lang)}</b></div>
        </div>
        <div className="xacts">
          <Btn variant="secondary" onClick={onClose}>取消</Btn>
          <Btn variant="accent" icon="export" disabled={empty} onClick={save}>导出文稿</Btn>
        </div>
      </>
    );
  }

  Object.assign(window, {ExportTranscript});
})();
