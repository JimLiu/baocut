/* 下载来源（2026-10-13 设计稿）：可以存多个来源，按种类（模型仓库 / 工具与运行库）各选一个在用。规则在 model-download-sources.js。
   · 设置 › 通用 ›「下载来源与离线」：两张列表各一组单选，内置的在前、添加的镜像在后，镜像可以编辑、删除；下面是严格离线。
   · `DownloadSourcePicker`：一种来源的紧凑选择器——下载确认框每组一个、本地模型页「下载与存储」里一个，改的是同一个「在用」。
   · 状态存 prefs.dlSources；没有时按旧的 prefs.modelsEndpoint 认回（BC_DLSRC.normalize）。环境变量是原型开关里的演示挡位，设了只读。
   只在 App。 */
(function () {
  const {useState} = React;
  const R = window.RSP;
  const DS = window.BC_DLSRC;

  /** [状态, 写回, 某种来源此刻的 {src, locked}] */
  function useDlSources() {
    const app = useApp();
    const st = DS.normalize(app.prefs.dlSources, app.prefs.modelsEndpoint);
    const env = {models: app.prefs.modelsEndpointEnv, releases: app.prefs.toolsEndpointEnv};
    const save = (next) => app.setPref('dlSources', next);
    return [st, save, (k) => DS.active(st, k, env[k])];
  }

  const envNote = (k) => `由环境变量 ${DS.kindOf(k).env} 指定，要改请改环境变量并重启 BaoCut。`;

  /** 一种来源的紧凑选择器（下载确认框、本地模型页）。`onChanged` 在换了之后回调（确认框用它重算地址） */
  function DownloadSourcePicker({k, label, onChanged}) {
    const app = useApp();
    const [st, save, activeOf] = useDlSources();
    const cur = activeOf(k);
    const choose = (id) => {
      if (!id || id === cur.src.id) return;
      const next = DS.setActive(st, k, id);
      save(next);
      app.toast(`${DS.kindOf(k).title}改为 ${DS.active(next, k).src.name}`, 'positive');
      if (onChanged) onChanged(id);
    };
    return (
      <R.Picker aria-label={label || `${DS.kindOf(k).title}的下载来源`} size="S" align="end" menuWidth={280}
        selectedKey={cur.src.id} isDisabled={cur.locked} onSelectionChange={choose} UNSAFE_className="dlsrc__picker">
        {(cur.src.id === 'env' ? [cur.src] : []).concat(DS.list(st, k)).map((s) => (
          <R.PickerItem key={s.id} id={s.id} textValue={s.name}>
            <R.Text slot="label">{s.name}</R.Text>
            <R.Text slot="description">{s.builtin ? `${s.host} · ${s.hint}` : s.base}</R.Text>
          </R.PickerItem>
        ))}
      </R.Picker>
    );
  }

  /** 添加 / 编辑镜像的小表单：名字可不填（显示主机名），基址按种类的规则校验 */
  function MirrorForm({k, st, init, except, onCancel, onSave}) {
    const [name, setName] = useState(init ? init.name : '');
    const [base, setBase] = useState(init ? init.base : '');
    const [touched, setTouched] = useState(false);
    const err = DS.mirrorError(st, k, {name, base}, except);
    const shownErr = touched || base ? err : null;
    return (
      <div className="dlsrc__form" role="group" aria-label={except ? '编辑镜像' : '添加镜像'}>
        <div className="dlsrc__fields">
          <Field size="s" aria-label="镜像的名字" placeholder="名字（可不填）" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="dlsrc__base">
            <Field size="s" aria-label="镜像的基址" placeholder={DS.kindOf(k).placeholder} value={base} invalid={!!shownErr}
              onChange={(e) => { setBase(e.target.value); setTouched(true); }} />
            {shownErr ? <span className="dlsrc__err">{shownErr}</span> : null}
          </div>
        </div>
        <div className="dlsrc__formact">
          <Btn variant="secondary" size="s" onClick={onCancel}>取消</Btn>
          <Btn variant="accent" size="s" disabled={!!err} onClick={() => onSave({name, base})}>{except ? '保存' : '添加并使用'}</Btn>
        </div>
      </div>
    );
  }

  /** 一种来源：标题与说明、单选列表（镜像带编辑 / 删除）、添加镜像 */
  function SourceKind({k}) {
    const app = useApp();
    const [st, save, activeOf] = useDlSources();
    const kind = DS.kindOf(k);
    const cur = activeOf(k);
    const [form, setForm] = useState(null);   // null | {mode: 'add'} | {mode: 'edit', id}
    const all = DS.list(st, k);
    const editing = form && form.mode === 'edit' ? st[k].mirrors.find((m) => m.id === form.id) : null;
    const pick = (id) => {
      save(DS.setActive(st, k, id));
      app.toast(`${kind.title}改为 ${all.find((s) => s.id === id).name}`, 'positive');
    };
    const add = (draft) => {
      const r = DS.addMirror(st, k, draft);
      if (!r.id) return;
      save(r.st);
      setForm(null);
      app.toast(`已添加并改用 ${DS.active(r.st, k).src.name}`, 'positive');
    };
    const update = (draft) => {
      save(DS.updateMirror(st, k, form.id, draft));
      setForm(null);
      app.toast('已保存镜像', 'positive');
    };
    const remove = (s) => app.confirm({
      title: `删除「${s.name}」？`,
      body: st[k].active === s.id
        ? `它正在用，删掉后${kind.title}改回 ${kind.builtin[0].name}。已经下好的文件不受影响。`
        : '只从列表里删掉这个地址，已经下好的文件不受影响。',
      confirmLabel: '删除', tone: 'negative',
      run: () => {
        const r = DS.removeMirror(st, k, s.id);
        save(r.st);
        if (form && form.id === s.id) setForm(null);
        app.toast(r.fellBack ? `已删除，${kind.title}改回 ${r.fellBack}` : '已删除', 'positive');
      },
    });
    const note = cur.locked ? envNote(k) : cur.src.note || null;
    return (
      <div className="dlsrc">
        <div className="dlsrc__head">
          <b>{kind.title}</b>
          {cur.locked ? <Chip tone="notice">环境变量</Chip> : null}
        </div>
        <span className="t-detail-xs dlsrc__desc">{kind.desc}</span>
        <R.RadioGroup aria-label={`${kind.title}的下载来源`} value={cur.src.id} isDisabled={cur.locked} onChange={pick} UNSAFE_className="dlsrc__list">
          {cur.src.id === 'env' ? (
            <div className="dlsrc__row"><R.Radio value="env">{cur.src.name}</R.Radio><span className="dlsrc__meta t-detail-xs">环境变量</span></div>
          ) : null}
          {all.map((s) => (
            <div key={s.id} className="dlsrc__row">
              <R.Radio value={s.id}>{s.name}</R.Radio>
              <span className="dlsrc__meta t-detail-xs">{s.builtin ? `${s.host} · ${s.hint}` : s.base}</span>
              {!s.builtin ? (
                <span className="dlsrc__act">
                  <IconBtn icon="edit" size="s" tip={`编辑「${s.name}」`} disabled={cur.locked} onClick={() => setForm({mode: 'edit', id: s.id})} />
                  <IconBtn icon="trash" size="s" tip={`删除「${s.name}」`} disabled={cur.locked} onClick={() => remove(s)} />
                </span>
              ) : null}
            </div>
          ))}
        </R.RadioGroup>
        {note ? <p className="dlsrc__note t-detail-xs">{note}</p> : null}
        {form && form.mode === 'add' ? <MirrorForm k={k} st={st} onCancel={() => setForm(null)} onSave={add} /> : null}
        {editing ? <MirrorForm key={editing.id} k={k} st={st} init={editing} except={editing.id} onCancel={() => setForm(null)} onSave={update} /> : null}
        {!form && !cur.locked ? (
          <div><Btn variant="secondary" size="s" icon="plus" onClick={() => setForm({mode: 'add'})}>添加镜像</Btn></div>
        ) : null}
      </div>
    );
  }

  /** 设置 › 通用 › 下载来源与离线 */
  function DownloadSourcesGroup() {
    const app = useApp();
    const Row = window.ShellRow;
    return (
      <section className="setpage__group" aria-label="下载来源与离线">
        <h2>下载来源与离线</h2>
        <p className="t-detail-xs dlsrc__lead">可以存多个来源，每种选一个在用。下载模型时也能在确认框里直接换，换的就是这里。每个文件都按内置的校验值核对，不论从哪里下。</p>
        <div className="setpage__card">
          <SourceKind k="models" />
          <SourceKind k="releases" />
          <Row label="严格离线" desc="打开后不下载模型和外部工具，也不从链接下载视频。云端模型与 Agent 引擎是否联网不受影响。">
            <Switch ariaLabel="严格离线" on={app.prefs.strictOffline === true} onChange={(v) => app.setPref('strictOffline', v)} />
          </Row>
        </div>
      </section>
    );
  }

  Object.assign(window, {useDlSources, DownloadSourcePicker, DownloadSourcesGroup});
})();
