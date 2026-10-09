/* 文稿的复制 —— 文稿面板头的「复制」与范围菜单（这一段 / 这一章）共用（2026-10-09）。
   ============================================================================
   复制是高频动作，所以拆成两枚挨着的按钮：
     复制钮   一点就按记住的组合复制全文，提示里写着这个组合是什么；复制后的回执带「复制设置」，点了打开下面的弹层
     下拉     「复制设置」：格式（Markdown / 纯文本）、五个开关（与导出「文稿」页同一组词、同一顺序）、
              正文预览与复制按钮。改了就记住（偏好 `txCopy`），下次一点复制钮就是这个组合
   正文走 BC_TX.exportText，与同样设置的导出逐字相同（真实产品走 `exports.renderText`）；
   语言跟面板当前的视图走（原文 / 译文 / 双语对照），要换语言就在面板里换。
   「跳过已剪段」与导出页同一个近似：整段落在剪口里的段才丢，按段落粒度。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const TX = window.BC_TX;
  const CH = window.BC_CH;
  const CUT = window.BC_CUT;
  const FMTS = [{k: 'md', label: TX.FMT_LABEL.md}, {k: 'txt', label: TX.FMT_LABEL.txt}];

  /** 五个开关（导出「文稿」页与复制设置共用一份标签与顺序）。勾选显示生效值，置灰的显示为未勾。 */
  function TxTextChecks({eff, onFlip, disabled}) {
    return (
      <div className="xopts">
        {TX.TEXT_OPTS.map(({k, label}) => (
          <Checkbox key={k} on={eff[k]} label={label} disabled={!!(disabled && disabled[k])} onChange={() => onFlip(k)} />
        ))}
      </div>
    );
  }

  /** 记住的复制组合与按范围取正文。scope：'all' | 'chapter' | 'para'。
      这一段是用户点名要的，不按「跳过已剪段」丢；全文与这一章照开关。 */
  function useTranscriptCopy(ctx, lang, transCode) {
    const app = useApp();
    const opts = TX.copyOpts(app.prefs.txCopy);
    const hasCh = !!(ctx.chapters && ctx.chapters.length);
    const eff = TX.textEffective(opts, {chapters: hasCh});
    const set = (k, v) => app.setPref('txCopy', Object.assign({}, opts, {[k]: v}));
    const doc = (scope, list) => {
      const kept = scope !== 'para' && eff.skipCut ? list.filter((p) => !CUT.dropped(ctx.cuts, p)) : list;
      const sections = scope === 'para' ? [{chapter: null, index: -1, paras: kept}] : CH.sections(ctx.chapters, kept);
      const meta = scope === 'all' && eff.frontmatter
        ? TX.projectMeta(ctx.proj, {language: D.srcLang.code, translation: lang === 'src' ? '' : (transCode || '')})
        : null;
      return {paras: kept, text: TX.exportText(sections, TX.textArgs(eff, scope, {lang, speakers: D.speakers, title: ctx.proj.title, meta}))};
    };
    return {opts, eff, hasCh, set, flip: (k) => set(k, !opts[k]), doc, parts: TX.textParts(eff)};
  }

  /** 复制到剪贴板并回执；回执里写清带了什么。 */
  function copyWithReceipt(app, text, head, parts, receipt, action) {
    return copyToClipboard(text).then((ok) => ok
      ? app.toast(`已复制${head} · ${parts.concat(receipt).join(' · ')}`, 'positive', action)
      : app.toast('复制失败 · 浏览器拒绝了剪贴板权限', 'negative'));
  }

  /** 文稿面板头：复制钮 + 复制设置。paras 是面板现取的段落（cue 改写表之后的正文）。 */
  function TranscriptCopy({ctx, paras, lang, langLabel, transCode}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const cp = useTranscriptCopy(ctx, lang, transCode);
    const doc = cp.doc('all', paras);
    const receipt = TX.copyReceipt(doc.paras, lang);
    const empty = !doc.paras.length;
    const summary = cp.parts.join(' · ');
    const copy = (fromSettings) => {
      setOpen(false);
      copyWithReceipt(app, doc.text, '全文', cp.parts, receipt,
        fromSettings ? undefined : {label: '复制设置', run: () => setOpen(true)});
    };
    return (
      <span className="txc">
        <IconBtn icon="copy" size="s" tip={empty ? '没有可复制的文稿' : `复制全文 · ${summary}`} disabled={empty} onClick={() => copy(false)} />
        <span className="txc__more">
          <IconBtn icon="chevdown" size="s" tip="复制设置" className="txc__chev" onClick={() => setOpen((v) => !v)}>
            <Ic n="chevdown" className="ic--14" />
          </IconBtn>
          <Popover open={open} onClose={() => setOpen(false)} align="right" width={360} label="复制设置">
            <div className="txc__pop">
              <div className="txc__hd">
                <span className="txc__title">复制全文</span>
                <span className="txc__lang">{langLabel}</span>
              </div>
              <div className="txc__row">
                <span className="xquick__lb">格式</span>
                <Segmented size="s" value={cp.opts.fmt} onChange={(v) => cp.set('fmt', v)} items={FMTS} />
              </div>
              <TxTextChecks eff={cp.eff} onFlip={cp.flip} disabled={{frontmatter: cp.opts.fmt !== 'md', chapters: !cp.hasCh}} />
              <div className="txc__pv">
                <pre className="txc__pvtext" tabIndex={0} aria-label="复制预览">{empty ? '还没有文稿' : doc.text}</pre>
              </div>
              <div className="txc__ft">
                <span className="txc__rc">{empty ? '—' : receipt}</span>
                <Btn variant="accent" icon="copy" autoFocus disabled={empty} onClick={() => copy(true)}>复制</Btn>
              </div>
            </div>
          </Popover>
        </span>
      </span>
    );
  }

  /** 范围菜单里的复制（这一段 / 这一章）：一项按复制设置，一项只要文字；两者写出来一样时只留一项。
      返回 MenuItem 元素而不是组件——BC_SPECTRUM.Menu 只认直接放进去的 MenuItem（ui-spectrum.jsx）。
      副题只列对这个范围生效的开关（这一段没有章节标题，范围复制都不写文首元信息）。 */
  function useScopeCopyItems({ctx, scope, lang, paras, onClose}) {
    const app = useApp();
    const cp = useTranscriptCopy(ctx, lang, null);
    const doc = cp.doc(scope.kind, paras);
    const plain = TX.copyText(doc.paras, {lang});
    const parts = TX.textParts(cp.eff, scope.kind);
    const run = (asSet) => {
      onClose();
      if (!doc.paras.length) { app.toast('没有可复制的文字 · 这部分整段都剪掉了'); return; }
      copyWithReceipt(app, asSet ? doc.text : plain, ' ' + scope.label, asSet ? parts : ['只有文字'], TX.copyReceipt(doc.paras, lang));
    };
    return doc.text === plain
      ? [<MenuItem key="plain" icon="copy" label="复制文字" onClick={() => run(false)} />]
      : [<MenuItem key="set" icon="copy" label="按复制设置" sub={parts.join(' · ')} onClick={() => run(true)} />,
        <MenuItem key="plain" icon="copy" label="只复制文字" onClick={() => run(false)} />];
  }

  Object.assign(window, {TxTextChecks, TranscriptCopy, useScopeCopyItems});
})();
