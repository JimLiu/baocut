/* 设置 › 术语库 —— §15.10 / §17.3（2026-09-20，同日二次收口）。
   为什么在设置里而不是项目里：这是一份**跨项目的用户资产**。项目那一侧只剩一个选择——
   这一步用哪几张表（转录 / 润色 / 翻译的设置态里勾，见 glossary-tool.jsx）。

   二次收口改了三件事：
   ① **两种表**：转录术语表（规范写法 / 常听错成）与翻译术语表（原文 → 译文，带语言方向），
      列表页按种类分两节；
   ② **加词只有两格**：表头下面常驻一行，填完回车就进表；一次要加一批就粘进来，一行一条。
      类别不再让人填，备注与「可变通」收在「更多」里；
   ③ 「转录时把术语送给语音模型」的全局开关没了——转录那一步自己选表（能力门仍在，折在转录一节里）。

   校验、合并、解析、Markdown 往返都在 model-glossary.js，这里只画。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const G = window.BC_GLOSSARY;

  /* ---------- 表的语言 ---------- */

  /* 不另做一只语言下拉：用全 App 共用的 `LanguageCombobox` 与同一份语言目录。原文语言可以不限。 */
  function LangPick({value, onChange, any, label}) {
    return (
      <div className="gls-lang">
        <LanguageCombobox value={value || ''} label={label} any={any ? '任意语言' : null}
          heading="全部语言" onChange={onChange} />
      </div>
    );
  }

  /* ---------- 哪些语音模型吃得下（能力门，折叠） ---------- */

  function HintGate() {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const rows = D.models.local.map((m) => ({m, hint: G.asrHint(m.id), installed: app.modelInstalled(m.id)}));
    return (
      <>
        <BCAction className="gls-more" onClick={() => setOpen((v) => !v)}>
          <Ic n={open ? 'chevdown' : 'chevright'} className="ic--14" />
          哪些语音模型吃得下
        </BCAction>
        {open ? (
          <div className="gls-gate">
            {rows.map(({m, hint, installed}) => (
              <div className="gls-gate__tr" key={m.id}>
                <Ic n={hint.kind === 'none' ? 'ban' : 'ok'}
                  className={cx('ic--14', hint.kind === 'none' ? 'gls-ic-off' : 'gls-ic-on')} />
                <span className="grow t-body-sm">{m.name}{installed ? '' : ' · 未安装'}</span>
                <span className="t-detail-xs">
                  {hint.kind === 'none' ? '没有提示通道' : `${hint.label} · 约 ${hint.budget} 字`}
                </span>
              </div>
            ))}
            <div className="t-detail-xs gls-gate__note">
              吃不下的模型照常转录，术语表留到润色那一步纠正。选哪几张表、要不要再写几句提示词，在转录设置里定。
            </div>
          </div>
        ) : null}
      </>
    );
  }

  /* ---------- 加词：常驻一行，两格，回车就进表 ---------- */

  function QuickAdd({kind, onAdd}) {
    const K = G.KINDS[kind];
    const [a, setA] = useState('');
    const [b, setB] = useState('');
    const firstRef = React.useRef(null);
    const term = kind === 'trans' ? {source: a.trim(), target: b.trim()}
      : {source: a.trim(), variants: G.splitVariants(b)};
    const problems = a.trim() || b.trim() ? G.validate(term, kind) : [];
    const ready = a.trim() && !problems.length;
    const submit = () => {
      if (!ready) return;
      onAdd([term]);
      setA(''); setB('');
      if (firstRef.current) firstRef.current.focus();
    };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    return (
      <div className="gls-add">
        <div className="gls-add__row">
          <Field size="s" inputRef={firstRef} value={a} aria-label={K.a} onKeyDown={onKey}
            placeholder={kind === 'trans' ? '原文，例如 commit' : '规范写法，例如 KV cache'}
            onChange={(e) => setA(e.target.value)} />
          <span className="gls-add__arrow" aria-hidden="true">{kind === 'trans' ? '→' : '←'}</span>
          <Field size="s" value={b} aria-label={K.b} onKeyDown={onKey}
            placeholder={kind === 'trans' ? '译文，例如 突破确认' : '常听错成（可不填），例如 开维缓存、KV 换成'}
            onChange={(e) => setB(e.target.value)} />
          <Btn variant="accent" size="s" onClick={submit} disabled={!ready}>添加</Btn>
        </div>
        {problems.length && a.trim() ? (
          <div className="gls-add__bad t-detail-xs" role="alert">{problems.join('；')}</div>
        ) : null}
      </div>
    );
  }

  /* 一次粘一批：一行一条。解析不了的行原样退回来，不悄悄丢。 */
  function BulkAdd({kind, onAdd, onClose}) {
    const [text, setText] = useState('');
    const parsed = G.parseLines(text, kind);
    const sample = kind === 'trans'
      ? 'commit = 突破确认\nWyckoff = 威科夫\nspring = 弹簧效应 = 不要译成「泉水」'
      : 'KV cache = 开维缓存、KV 换成\nLoRA = 罗拉\n推理框架';
    return (
      <div className="gls-bulk">
        <Field area rows={6} value={text} placeholder={sample} aria-label="一次粘一批"
          onChange={(e) => setText(e.target.value)} />
        <div className="t-detail-xs gls-bulk__how">
          一行一条，{kind === 'trans' ? '原文和译文' : '规范写法和常听错成的写法'}之间用 <span className="t-mono">=</span>、
          <span className="t-mono">→</span> 或 Tab 隔开{kind === 'trans' ? '；第三格是备注，可不写' : '；只写规范写法也行'}。
          从表格软件里复制两列、或者别人发来的 Markdown 表，直接粘就行。
        </div>
        {parsed.skipped.length ? (
          <div className="gls-bulk__skip t-detail-xs" role="status">
            {parsed.skipped.slice(0, 4).map((s, i) => <span key={i}><span className="t-mono">{s.line}</span> · {s.why}</span>)}
            {parsed.skipped.length > 4 ? <span>还有 {parsed.skipped.length - 4} 行</span> : null}
          </div>
        ) : null}
        <div className="gls-bulk__acts">
          <Btn variant="accent" size="s" disabled={!parsed.terms.length}
            onClick={() => { onAdd(parsed.terms); onClose(); }}>
            {parsed.terms.length ? `加进这张表 · ${parsed.terms.length} 条` : '加进这张表'}
          </Btn>
          <Btn variant="secondary" size="s" onClick={onClose}>取消</Btn>
        </div>
      </div>
    );
  }

  /* ---------- 一条术语 ---------- */

  function TermEditor({term, kind, onSave, onCancel, onDelete}) {
    const K = G.KINDS[kind];
    const [v, setV] = useState(() => ({source: term.source || '', target: term.target || '',
      variants: (term.variants || []).join('、'), note: term.note || '', loose: term.lock === false}));
    const [more, setMore] = useState(() => !!term.note || term.lock === false);
    const set = (p) => setV((s) => ({...s, ...p}));
    const draft = kind === 'trans'
      ? {...term, source: v.source.trim(), target: v.target.trim(), note: v.note.trim(), lock: !v.loose}
      : {...term, source: v.source.trim(), variants: G.splitVariants(v.variants)};
    const problems = G.validate(draft, kind);
    const onKey = (e) => { if (e.key === 'Enter' && !problems.length) onSave(draft); if (e.key === 'Escape') onCancel(); };
    return (
      <div className="gls-edit">
        <div className="gls-add__row">
          <Field size="s" value={v.source} aria-label={K.a} autoFocus onKeyDown={onKey}
            onChange={(e) => set({source: e.target.value})} invalid={!v.source.trim()} />
          <span className="gls-add__arrow" aria-hidden="true">{kind === 'trans' ? '→' : '←'}</span>
          {kind === 'trans'
            ? <Field size="s" value={v.target} aria-label={K.b} onKeyDown={onKey}
              onChange={(e) => set({target: e.target.value})} invalid={!v.target.trim()} />
            : <Field size="s" value={v.variants} aria-label={K.b} onKeyDown={onKey} placeholder="可不填；多个写法用顿号分开"
              onChange={(e) => set({variants: e.target.value})} />}
        </div>
        {kind === 'asr' ? (
          <div className="t-detail-xs gls-edit__hint">
            只填<b>真的被听错过</b>的写法。编出来的近义词会把本来正确的句子改坏。
          </div>
        ) : more ? (
          <div className="gls-edit__more">
            <Field size="s" value={v.note} aria-label="备注" onKeyDown={onKey}
              placeholder="给模型看的一句话，例如：这一派里不是「提交」" onChange={(e) => set({note: e.target.value})} />
            <div className="gls-edit__lock">
              <Switch on={v.loose} onChange={(x) => set({loose: x})} label="可变通" />
              <span className="t-detail-xs">
                {v.loose ? '模型优先用这个译法，语境不合时可以换。' : '现在是必须照用：译文里缺了它，这一页会重译。'}
              </span>
            </div>
          </div>
        ) : (
          <BCAction className="gls-more" onClick={() => setMore(true)}>
            <Ic n="chevright" className="ic--14" />更多 · 备注、可变通
          </BCAction>
        )}
        {problems.length ? (
          <div className="gls-add__bad t-detail-xs" role="alert">{problems.join('；')}</div>
        ) : null}
        <div className="gls-edit__acts">
          <Btn variant="accent" size="s" onClick={() => onSave(draft)} disabled={problems.length > 0}>保存</Btn>
          <Btn variant="secondary" size="s" onClick={onCancel}>取消</Btn>
          <span className="spacer" />
          <IconBtn icon="trash" size="s" tip="删除这条" onClick={onDelete} />
        </div>
      </div>
    );
  }

  function TermRow({term, kind, open, onOpen, onSave, onDelete}) {
    if (open) {
      return (
        <div className="gls-term is-open">
          <TermEditor term={term} kind={kind} onSave={onSave} onCancel={() => onOpen(null)} onDelete={onDelete} />
        </div>
      );
    }
    return (
      <BCAction type="button" className="gls-term" onClick={() => onOpen(term.id)}>
        <span className="gls-term__hd">
          <b className="t-ui t-strong">{term.source}</b>
          {kind === 'trans' ? (
            <>
              <span className="gls-term__arrow" aria-hidden="true">→</span>
              <span className="t-ui gls-term__tgt">{term.target}</span>
              {term.lock === false ? <Chip>可变通</Chip> : null}
            </>
          ) : term.variants && term.variants.length ? (
            <span className="gls-term__var">常听错成 <span className="t-mono">{term.variants.join(' · ')}</span></span>
          ) : null}
        </span>
        {term.note ? <span className="gls-term__note t-detail-xs">{term.note}</span> : null}
      </BCAction>
    );
  }

  /* ---------- 表详情 ---------- */

  function PackDetail({pack, onBack, onPatch, onDelete, onReverse}) {
    const app = useApp();
    const kind = G.kindOf(pack);
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(null);
    const [bulk, setBulk] = useState(false);
    const list = G.search(pack.terms, q);

    const touch = (next) => onPatch({...next, updated: '刚刚'});
    const addMany = (incoming) => {
      const r = G.addTerms(pack, incoming, (t, i) => 'gt' + Date.now() + i);
      touch(r.pack);
      app.toast(r.added
        ? `已加 ${r.added} 条${r.merged ? ` · ${r.merged} 条表里已经有了` : ''} · 以后每部视频都会用上`
        : '这几条表里已经有了', r.added ? 'positive' : undefined);
    };
    const save = (draft) => { touch({...pack, terms: pack.terms.map((t) => (t.id === draft.id ? draft : t))}); setOpen(null); };
    const del = (id) => { touch({...pack, terms: pack.terms.filter((t) => t.id !== id)}); setOpen(null); app.toast('已删除这一条'); };

    return (
      <div className="gls-detail">
        <div className="gls-detail__hd">
          <Btn variant="quiet" size="s" icon="back" onClick={onBack}>术语库</Btn>
        </div>
        <div className="gls-detail__title">
          <Field value={pack.name} aria-label="表名" className="gls-detail__name"
            onChange={(e) => onPatch({...pack, name: e.target.value})} />
          <Chip tone="info">{G.KINDS[kind].label}</Chip>
        </div>
        <div className="gls-detail__meta">
          {kind === 'trans' ? (
            <>
              <LangPick value={pack.from} any label="原文语言" onChange={(c) => touch({...pack, from: c})} />
              <span aria-hidden="true">→</span>
              <LangPick value={pack.to} label="译文语言" onChange={(c) => touch({...pack, to: c})} />
            </>
          ) : (
            <>
              <span className="t-detail-xs">口播语言</span>
              <LangPick value={pack.lang} any label="口播语言" onChange={(c) => touch({...pack, lang: c})} />
            </>
          )}
          <span className="spacer" />
          <span className="t-detail-xs">{pack.terms.length} 条 · 更新于 {pack.updated}</span>
        </div>

        <QuickAdd kind={kind} onAdd={addMany} />
        {bulk ? <BulkAdd kind={kind} onAdd={addMany} onClose={() => setBulk(false)} /> : (
          <BCAction className="gls-more" onClick={() => setBulk(true)}>
            <Ic n="chevright" className="ic--14" />一次粘一批…
          </BCAction>
        )}

        {pack.terms.length > 8 ? (
          <div className="gls-detail__bar">
            <Field size="s" icon="search" value={q} placeholder={kind === 'trans' ? '搜原文、译文' : '搜规范写法、听错的写法'}
              onChange={(e) => setQ(e.target.value)} />
          </div>
        ) : null}

        <div className="gls-terms">
          {list.length ? list.map((t) => (
            <TermRow key={t.id} term={t} kind={kind} open={open === t.id}
              onOpen={setOpen} onSave={save} onDelete={() => del(t.id)} />
          )) : (
            <div className="gls-empty t-body-sm">
              {q ? `没有匹配「${q}」的条目。` : kind === 'trans'
                ? '还没有条目。在上面填一对原文和译文，回车就进表。'
                : '还没有条目。在上面填一个规范写法，回车就进表。'}
            </div>
          )}
        </div>

        <div className="gls-detail__foot">
          <Btn variant="secondary" size="s" icon="export"
            onClick={() => copyToClipboard(G.toMarkdown(pack))
              .then(() => app.toast('表已按 Markdown 复制 · 可以直接发给别人', 'positive'))}>
            导出这张表
          </Btn>
          {kind === 'trans' && pack.from ? (
            <Btn variant="secondary" size="s" onClick={onReverse}>
              生成 {G.langLabel(pack.to)} → {G.langLabel(pack.from)} 的表
            </Btn>
          ) : null}
          <span className="spacer" />
          <Btn variant="secondary" size="s" onClick={onDelete}>删除这张表</Btn>
        </div>
      </div>
    );
  }

  /* ---------- 表列表 ---------- */

  function PackCard({pack, onOpen, onToggleDefault}) {
    const stats = G.packStats(pack);
    return (
      <div className="gls-pack">
        <BCAction type="button" className="gls-pack__main" onClick={() => onOpen(pack.id)}>
          <span className="gls-pack__nm">
            <b className="t-title-sm">{pack.name}</b>
            <Chip>{G.pairLabel(pack)}</Chip>
          </span>
          <span className="gls-pack__st t-detail-xs">{stats.n} 条 · 更新于 {pack.updated}</span>
        </BCAction>
        <div className="gls-pack__side">
          <Switch on={!!pack.dflt} onChange={() => onToggleDefault(pack.id)} label="新视频默认用" />
          <NavChevron className="gls-pack__go" />
        </div>
      </div>
    );
  }

  /* 新建翻译表先问方向——方向是这张表的身份，不是以后再补的属性。 */
  function NewTrans({onCreate, onCancel}) {
    const [from, setFrom] = useState('en');
    const [to, setTo] = useState('zh');
    const same = from && window.BC_LANGUAGES.canon(from) === window.BC_LANGUAGES.canon(to);
    return (
      <div className="gls-new">
        <span className="t-body-sm">从</span>
        <LangPick value={from} any label="原文语言" onChange={setFrom} />
        <span className="t-body-sm">译成</span>
        <LangPick value={to} label="译文语言" onChange={setTo} />
        <span className="spacer" />
        <Btn variant="accent" size="s" disabled={same} onClick={() => onCreate(from, to)}>新建</Btn>
        <Btn variant="secondary" size="s" onClick={onCancel}>取消</Btn>
      </div>
    );
  }

  function GlossarySection() {
    const app = useApp();
    const [openId, setOpenId] = useState(null);
    const [newTrans, setNewTrans] = useState(false);
    const packs = app.glossary;
    const pack = packs.find((p) => p.id === openId);
    const asr = packs.filter((p) => G.kindOf(p) === 'asr');
    const trans = packs.filter((p) => G.kindOf(p) === 'trans');

    /* 冲突只在同一个方向里才成立：中 → 英和中 → 日把同一个词译成不同的词是天经地义的。 */
    const conflicts = [];
    [...new Set(trans.map((p) => `${p.from || ''}>${p.to}`))].forEach((pair) => {
      const [from, to] = pair.split('>');
      G.mergePacks(packs, trans.map((p) => p.id), {kind: 'trans', from: from || null, to}).conflicts
        .forEach((c) => { if (!conflicts.some((x) => x.key === c.key && x.to === to)) conflicts.push({...c, to}); });
    });

    const patch = (next) => app.setGlossary((list) => list.map((p) => (p.id === next.id ? next : p)));
    const toggleDefault = (id) => app.setGlossary((list) => list.map((x) => (x.id === id ? {...x, dflt: !x.dflt} : x)));
    const create = (seed) => {
      const id = 'gp' + Date.now();
      app.setGlossary((list) => [...list, {id, dflt: true, updated: '刚刚', terms: [], ...seed}]);
      setNewTrans(false);
      setOpenId(id);
    };
    const importMd = async () => {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch (e) { text = ''; }
      const {packs: parsed, warnings} = G.parseMarkdown(text);
      if (!parsed.length) {
        app.toast('剪贴板里没有可识别的术语表 · 复制一张表或几行「原文 = 译文」再试');
        return;
      }
      const stamp = Date.now();
      const made = parsed.map((p, i) => ({...p, id: 'gp' + stamp + i, dflt: false, updated: '刚刚',
        terms: p.terms.map((t, j) => ({...t, id: 'gt' + stamp + i + '-' + j}))}));
      app.setGlossary((list) => [...list, ...made]);
      if (made.length === 1) setOpenId(made[0].id);
      const n = made.reduce((s, p) => s + p.terms.length, 0);
      app.toast(made.length > 1
        ? `已导入 ${n} 条 · 旧格式的一张表拆成了转录表和翻译表各一张`
        : `已导入 ${n} 条${warnings.length ? ` · ${warnings.length} 行没收下` : ''}`, 'positive');
    };

    if (pack) {
      return (
        <div className="gls" data-screen-label="术语库 · 表详情">
          <PackDetail pack={pack} onBack={() => setOpenId(null)} onPatch={patch}
            onReverse={() => {
              const r = G.reversePack(pack);
              const id = 'gp' + Date.now();
              app.setGlossary((list) => [...list, {...r, id, updated: '刚刚'}]);
              setOpenId(id);
              app.toast(`已生成 ${G.pairLabel(r)} 的表 · ${r.terms.length} 条，掉头后不合适的自己删`, 'positive');
            }}
            onDelete={() => {
              app.setGlossary((list) => list.filter((p) => p.id !== pack.id));
              setOpenId(null);
              app.toast('已删除这张表');
            }} />
        </div>
      );
    }

    return (
      <div className="gls" data-screen-label="术语库">
        <h1 className="t-heading-sm">术语库</h1>
        <p className="gls-lede">
          专业内容里的人名、产品名和行话，语音模型听不准，翻译也不会按你这一行的惯例译。
          在这里记一次，之后每部视频自动用上。转录和翻译各用各的表。
        </p>

        <div className="gls-sec">
          <div className="t-section">转录术语表</div>
          <p>规范写法，和它常被听错成什么。转录时送给吃得下提示的语音模型，润色时按它逐处纠正。</p>
        </div>
        {asr.map((p) => <PackCard key={p.id} pack={p} onOpen={setOpenId} onToggleDefault={toggleDefault} />)}
        <div className="gls-actions">
          <Btn variant="secondary" size="s" icon="plus"
            onClick={() => create({kind: 'asr', name: '新转录术语表', lang: null})}>新建转录术语表</Btn>
          <span className="spacer" />
          <HintGate />
        </div>

        <div className="gls-sec">
          <div className="t-section">翻译术语表</div>
          <p>
            原文 → 译文，一个语言方向一张表。翻译时程序先在文稿里找出<b>本篇命中的</b>条目，只把这几条交给模型；
            必须照用的译文缺了，那一页会重译。
          </p>
        </div>
        {trans.map((p) => <PackCard key={p.id} pack={p} onOpen={setOpenId} onToggleDefault={toggleDefault} />)}
        {conflicts.length ? (
          <div className="gls-conflict" role="status">
            <Ic n="info" className="ic--16" />
            <div>
              <b>{conflicts.length} 个词在两张表里译法不同</b>
              {conflicts.map((c) => (
                <p key={c.key + c.to}>
                  <span className="t-mono">{c.source}</span>：
                  {c.rows.map((r) => `${r.packName} 译「${r.target}」`).join('，')}
                  ——同时启用时按列表顺序取<b>{c.winner}</b>。
                </p>
              ))}
            </div>
          </div>
        ) : null}
        {newTrans ? <NewTrans onCancel={() => setNewTrans(false)}
          onCreate={(from, to) => create({kind: 'trans', from, to,
            name: `${G.langLabel(from)} → ${G.langLabel(to)}`})} /> : (
          <div className="gls-actions">
            <Btn variant="secondary" size="s" icon="plus" onClick={() => setNewTrans(true)}>新建翻译术语表</Btn>
          </div>
        )}

        <div className="gls-actions gls-actions--foot">
          <Btn variant="secondary" size="s" icon="upload" onClick={importMd}>从剪贴板导入…</Btn>
        </div>
        <div className="t-detail-xs gls-foot">
          每部视频用哪几张表，在那部视频的转录、「润色文稿」或「翻译字幕」设置里勾——库是你的，启用是每部视频自己的事。
          导出的是一张 Markdown 表，可以直接发给别人，也可以用文本编辑器改完再导回来。
        </div>
      </div>
    );
  }

  Object.assign(window, {GlossarySection});
})();
