/* 设置 › 本地模型 › 添加模型（issue 113）：内置引擎 audio.cpp 支持的模型都能加进列表。
   一块按组、可搜索的目录（BC_AUDIOCPP_CATALOG）：每一族一行，选精度后「添加」；加进来的行与内置的一样下载、试听、删除。
   语音合成与音乐生成两组能添加；语音识别、音源分离与其余任务归「暂时用不上」，写清为什么，不给按钮。
   第四段「自己指定文件」：Hugging Face 上的一个 .gguf，或这台电脑上的一个 .gguf（原地引用，不复制），选它按哪一族跑。
   加进来的都没经过 BaoCut 逐只验证（与「添加更多 Agent」同一个承诺），效果以试听与检查为准。
   分组、说法、记录与合并的规则在 model-audiocpp.js。 */
(function () {
  const {useState, useMemo} = React;
  const R = window.RSP;
  const A = window.BC_AUDIOCPP;
  const CAT = window.BC_AUDIOCPP_CATALOG;
  const mb = window.BC_LOCALMODELS.mb;

  /** 族名旁的标签：上游成熟度 + 许可提醒 */
  function FamilyChips({fam}) {
    const st = A.statusLabel(fam);
    // 「暂时用不上」的不能添加，许可不提醒
    const flag = A.groupOf(fam) === 'idle' ? null : A.licenseFlag(A.licenseOf(fam));
    return <>
      {st ? <Chip>{st}</Chip> : null}
      {flag === 'nc' ? <Chip tone="notice">仅限非商用</Chip> : flag === 'check' ? <Chip tone="notice">商用待核实</Chip> : null}
    </>;
  }

  /** 目录的一行：一族。能添加的组给精度选择与「添加」；内置或加过的那只写状态 */
  function FamilyRow({fam, models, onAdd}) {
    const pkgs = A.pkgsOf(fam);
    const group = A.groupOf(fam);
    const firstOpen = pkgs.find((p) => !A.stateOf(p, models)) || A.defaultPkg(fam);
    const [pick, setPick] = useState(firstOpen ? firstOpen.id : null);
    const pkg = pkgs.find((p) => p.id === pick) || firstOpen;
    const state = pkg ? A.stateOf(pkg, models) : null;
    const lic = A.licenseOf(fam);
    const parts = pkg ? A.partsOf(fam, pkg) : [];
    const optLabel = (p) => {
      const s = A.stateOf(p, models);
      return `${A.precLabel(p)} · ${mb(A.sizeOf(fam, p))}${s ? (s.kind === 'builtin' ? ' · 已内置' : ' · 已添加') : ''}`;
    };
    // 同一族里精度之外还有不同大小的模型（Qwen3-TTS 0.6B / 1.7B 等）：选项写包名
    const named = new Set(pkgs.map((p) => A.precLabel(p))).size < pkgs.length;
    return <li className="acadd__row">
      <div className="grow acadd__txt">
        <span className="acadd__name"><b className="t-ui t-strong">{fam.name}</b><FamilyChips fam={fam} /></span>
        {group === 'idle'
          ? <span className="t-detail">{A.idleReason(fam)}</span>
          : <span className="t-detail">{A.traitsLine(fam) || (fam.tasks || []).map((t) => A.TASK_LABEL[t] || t).join('、')}</span>}
        {group === 'idle' ? null : <span className="t-detail-xs">
          {lic.name}{lic.commercialUse === true ? '' : ' · ' + lic.summary}
          {group !== 'idle' && pkgs.length ? ` · ${pkgs.length} 个可选` : ''}
          {parts.length ? ` · 连同 ${parts.map(A.pkgName).join('、')} 一起下` : ''}
        </span>}
      </div>
      {group === 'idle' ? null : !pkgs.length ? <span className="t-detail-xs acadd__state">上游还没有能直接下载的 GGUF</span> : (
        <div className="acadd__act">
          {pkgs.length > 1 ? (
            <R.Picker aria-label={`${fam.name} 的版本`} size="S" align="end" menuWidth={named ? 360 : 220}
              selectedKey={pkg.id} onSelectionChange={(k) => setPick(String(k))} UNSAFE_className="acadd__picker">
              {pkgs.map((p) => (
                <R.PickerItem key={p.id} id={p.id} textValue={named ? A.pkgName(p) : optLabel(p)}>
                  <R.Text slot="label">{named ? A.pkgName(p) : optLabel(p)}</R.Text>
                  {named ? <R.Text slot="description">{optLabel(p)}</R.Text> : null}
                </R.PickerItem>
              ))}
            </R.Picker>
          ) : <span className="t-detail-xs">{optLabel(pkg)}</span>}
          {state ? <span className="t-detail-xs acadd__state">{state.kind === 'builtin' ? '已内置' : '已添加'}</span>
            : <Btn size="s" variant="secondary" icon="plus" onClick={() => onAdd({kind: 'catalog', pkg: pkg.id})}>添加</Btn>}
        </div>
      )}
    </li>;
  }

  /* 原型里「选择文件…」不开系统面板，填一个演示文件 */
  const DEMO_LOCAL = {path: '~/Downloads/my-voice-q8_0.gguf', mb: 1843};
  /* 原型里仓库文件的大小与哈希在添加时读（产品里问 Hugging Face 的文件列表，拿 LFS 的 sha256 与大小），这里给演示值 */
  const DEMO_HF_MB = 1536;

  /** 自己指定一个 .gguf：来源、地址或文件、按哪一族跑、名字 */
  function CustomForm({form, setForm, tried}) {
    const fams = A.customFamilies(CAT.families).slice().sort((a, b) => a.name.localeCompare(b.name));
    const set = (k) => (v) => setForm((f) => ({...f, [k]: v}));
    const parsed = A.parseHfFile(form.url);
    const urlErr = tried && form.src === 'hf' && !parsed.ok ? (A.PARSE_TEXT[parsed.code] || '填一个文件地址') : '';
    const fam = fams.find((f) => f.f === form.fam);
    return <div className="acadd__form">
      <R.RadioGroup label="文件在哪儿" orientation="horizontal" value={form.src} onChange={set('src')}>
        <R.Radio value="hf">Hugging Face 上</R.Radio>
        <R.Radio value="local">这台电脑上</R.Radio>
      </R.RadioGroup>
      {form.src === 'hf' ? (
        <R.TextField label="文件地址" placeholder="https://huggingface.co/用户/仓库/blob/main/模型.gguf" value={form.url} onChange={set('url')}
          description={parsed.ok ? `仓库 ${parsed.repo} · 修订 ${parsed.revision} · 文件 ${parsed.path}；添加时读大小与校验值，以后按它校验` : '贴那个文件的网页地址，或写成 用户/仓库/文件.gguf；整套多文件的模型从目录里加。'}
          isInvalid={!!urlErr} errorMessage={urlErr} UNSAFE_className="acadd__field acadd__mono" />
      ) : (
        <div className="acadd__pickfile">
          <R.TextField label="文件" isReadOnly value={form.path} placeholder="还没选" UNSAFE_className="acadd__field acadd__mono"
            description="原地引用：直接读这个文件，不复制、不改它；加完就算装好。移动或删掉它之后要重新添加。"
            isInvalid={tried && !form.path} errorMessage="先选一个 .gguf 文件" />
          <Btn size="s" variant="secondary" onClick={() => setForm((f) => ({...f, path: DEMO_LOCAL.path}))}>选择文件…</Btn>
        </div>
      )}
      <R.Picker label="按哪一族跑" size="M" selectedKey={form.fam} onSelectionChange={(k) => set('fam')(String(k))}
        description={fam ? `${fam.cap === 'music' ? '音乐生成' : '语音合成'} · ${A.traitsLine(fam) || fam.name}。audio.cpp 按族读这个文件，选错了检查会报错。` : 'audio.cpp 按族决定怎么读这个文件。'}
        isInvalid={tried && !fam} errorMessage="选一族" UNSAFE_className="acadd__field">
        {fams.map((f) => <R.PickerItem key={f.f} id={f.f} textValue={f.name}>{f.name}</R.PickerItem>)}
      </R.Picker>
      <R.TextField label="名字（可选）" placeholder={A.baseName((form.src === 'hf' ? (parsed.ok ? parsed.path : '') : form.path) || '') || '默认用文件名'}
        value={form.name} onChange={set('name')} UNSAFE_className="acadd__field" />
    </div>;
  }
  /** 表单 → 一条记录；不完整时 null */
  function customEntry(form) {
    if (!form.fam) return null;
    if (form.src === 'local') {
      return form.path ? {kind: 'custom', fam: form.fam, src: 'local', path: form.path, name: form.name.trim(), mb: DEMO_LOCAL.mb} : null;
    }
    const p = A.parseHfFile(form.url);
    return p.ok ? {kind: 'custom', fam: form.fam, src: 'hf', repo: p.repo, revision: p.revision, path: p.path, name: form.name.trim(), mb: DEMO_HF_MB} : null;
  }

  /**
   * 添加模型对话框。`cat` 是打开它的能力页（tts / music），决定先看哪一组；`onAdd(entry)` 由设置页落记录并接着下载。
   */
  function AddModelDialog({cat, models, onClose, onAdd}) {
    const [group, setGroup] = useState(cat === 'music' ? 'music' : 'tts');
    const [q, setQ] = useState('');
    const [form, setForm] = useState({src: 'hf', url: '', path: '', fam: cat === 'music' ? 'yue2' : 'qwen3_tts', name: ''});
    const [tried, setTried] = useState(false);
    const custom = group === 'custom';
    const rows = useMemo(() => (custom ? [] : A.search(CAT.families, models, q, group)), [group, q, models.length, custom]);
    const addCustom = () => {
      setTried(true);
      const e = customEntry(form);
      if (e) onAdd(e);
    };
    return <Dialog open title="添加 audio.cpp 模型" width={760} onClose={onClose}
      footer={custom
        ? <><Btn onClick={onClose}>取消</Btn><Btn variant="accent" onClick={addCustom}>{form.src === 'local' ? '添加' : '添加并下载…'}</Btn></>
        : <Btn onClick={onClose}>完成</Btn>}>
      <p className="acadd__lede">
        BaoCut 内置的 audio.cpp 引擎（{CAT.engine}）支持的模型都能加进来，加进来以后跟内置的一样下载、试听和删除。
        它们没有经过 BaoCut 逐只验证，效果以试听和检查为准。
      </p>
      <R.SegmentedControl aria-label="模型分组" selectedKey={group} onSelectionChange={(k) => setGroup(String(k))} UNSAFE_className="acadd__seg">
        {A.GROUPS.map((g) => (
          <R.SegmentedControlItem key={g.k} id={g.k}><R.Text>{g.label} {A.countOf(CAT.families, g.k)}</R.Text></R.SegmentedControlItem>
        ))}
        <R.SegmentedControlItem id="custom"><R.Text>自己指定文件</R.Text></R.SegmentedControlItem>
      </R.SegmentedControl>
      {custom ? <CustomForm form={form} setForm={setForm} tried={tried} /> : (
        <Card layer className="acadd">
          <div className="acadd__search">
            <R.SearchField aria-label="搜索 audio.cpp 模型" placeholder="搜索名字、语言或特点" value={q} onChange={setQ} UNSAFE_className="acadd__sf" />
            <span className="acadd__count">{q.trim() ? `找到 ${rows.length} 个` : group === 'idle' ? `${rows.length} 个 · 暂时不能添加` : `${rows.length} 个模型族`}</span>
          </div>
          {rows.length ? <ul className="acadd__list" aria-label="audio.cpp 模型">
            {rows.map((f) => <FamilyRow key={f.f} fam={f} models={models} onAdd={onAdd} />)}
          </ul> : <div className="acadd__empty">
            <p className="t-detail">这一组里没有「{q.trim()}」。要加的文件不在目录里，可以自己指定。</p>
            <Btn size="s" onClick={() => setGroup('custom')}>自己指定文件…</Btn>
          </div>}
        </Card>
      )}
    </Dialog>;
  }

  /** 能力页（语音合成、音乐生成）上的入口一行 */
  function AddModelEntry({cat, onOpen}) {
    const Row = window.ShellRow;
    const n = A.moreCount(CAT.families, cat);
    return <Row label="添加更多模型"
      desc={`内置之外，audio.cpp 还支持 ${n} 种${cat === 'music' ? '音乐生成' : '语音合成'}模型，内置的也有别的精度；也能指定一个 GGUF 文件。`}>
      <Btn size="s" variant="secondary" icon="plus" onClick={onOpen}>添加模型…</Btn>
    </Row>;
  }

  Object.assign(window, {AddModelDialog, AddModelEntry});
})();
