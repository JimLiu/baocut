/* Provider · 模型两级菜单 —— 公共组件（第 185 轮立、第 186 轮抽出）。
   三处共用同一份行与同一套翻页：首页复合框与会话 composer 的那枚 chip（`ProviderModelPicker`），
   以及 AI 工具页「用」下拉的 Agent 组（tool-setup.jsx `RunnerPick`）。谁都不再各画一份。

   第一级只列每家编码 Agent（Claude Code / Codex CLI），一屏不再把两家的模型全摊开；
   能用的那家点了就地翻到第二级——「Agent 默认模型」打头 + 它的模型表；
   没装 / 停用的那家在第一级就说清，点了去 Settings › Agent，不进第二级。
   行文案全部由 model-agent.js 的 providerRows / modelRows 算出（App 端对应
   `app/agent/model_menu.rs`），这里只负责画与翻页。 */
(function () {
  const {useState, useEffect} = React;
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;

  /** 两级弹层的开合与层级：level = null 第一级；harness id = 第二级。开合一次都回到第一级。 */
  function usePickerLevels() {
    const [pop, setPop] = useState(false);
    const [level, setLevel] = useState(null);
    return {
      pop, level, setLevel,
      toggle: () => { setLevel(null); setPop((v) => !v); },
      close: () => { setPop(false); setLevel(null); },
    };
  }

  /* 输入区按自己的宽度收窄（product-design §3.2.3）：内容宽度不到 520px 时访问模式只剩图标、Agent 只剩图标、
     模型只留级别名。量的是输入区的内容盒（不含左右留白），留白不随这个状态变，临界宽度不会来回切。
     与 packages/ui composer.tsx 的 `compact`（`useNarrow`，同一个 520）一致。 */
  const COMPOSER_NARROW = 520;
  function useComposerNarrow(ref, width = COMPOSER_NARROW) {
    const [narrow, setNarrow] = useState(false);
    useEffect(() => {
      const el = ref.current;
      if (!el || typeof ResizeObserver === 'undefined') return undefined;
      const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < width));
      ro.observe(el);
      return () => ro.disconnect();
    }, [width]);
    return narrow;
  }

  /** 第一级：组头 + 每家一行。`list` 是要列的 harness（含停用 / 没装的，那两种行点了 onSettings）。
      `noHead`：宿主自己画了段头（工具页「用」下拉的两段开关）时不再重复一行组头。 */
  function ProviderLevel({list, sel, head, noHead, onEnter, onSettings, children}) {
    const rows = AG.providerRows(list, sel);
    return (
      <>
        <Menu>
          {noHead ? null : <MenuHead>{head || '编码 Agent'}</MenuHead>}
          {rows.map((r) => (
            <MenuItem key={r.id} icon={<window.AgentIcon h={list.find((x) => x.id === r.id) || r} />} label={r.name} sub={r.sub} on={r.on}
              suffix={r.state === 'ready' ? <NavChevron /> : <Ic n={r.state === 'missing' ? 'download' : r.state === 'attention' ? 'alert' : 'settings'} className="ic--14" />}
              onClick={() => (r.state === 'ready' ? onEnter(r.id) : onSettings())} />
          ))}
          {children}
        </Menu>
      </>
    );
  }

  /** 第二级：返回行 + 「模型」组。`onPick(modelId|null)`；children 接在模型表后面（composer 接推理强度）。
      CLI 配置里的默认模型这一版不认得时（2026-09-29，`defaultModelGate`），「Agent 默认模型」行的副文案直说要升级 CLI。 */
  function ModelLevel({h, sel, onBack, onPick, children}) {
    return (
      <>
        <Menu>
          <MenuItem icon="chevleft" label={h.name} sub={String(h.account || '本机').split(' · ')[0]} onClick={onBack} />
          <MenuRule />
          <MenuHead>模型</MenuHead>
          {AG.modelRows(h, sel, window.BC_AGENT_SETUP.defaultModelGate(h)).map((m) => (
            <MenuItem key={m.id || '__dflt'} label={m.name} sub={m.sub} on={m.on} onClick={() => onPick(m.id)} />
          ))}
          {children}
        </Menu>
      </>
    );
  }

  /* composer 与首页复合框的那枚 chip（`sel` = {harness, model, effort}）：两级之上再挂推理强度——
     推理强度是「这个模型怎么想」，跟模型住同一级，底栏因此少一枚下拉。
     chip 前面是 Agent 的图标；`compact`（输入区窄，`useComposerNarrow`）时 Agent 名字不写、模型只留级别名（`harnessShort`），
     完整的「Agent · 模型」留在无障碍标签里。 */
  function ProviderModelPicker({sel, onChange, compact}) {
    const app = useApp();
    const lv = usePickerLevels();
    const h = app.harnessList.find((x) => x.id === sel.harness) || app.harness;
    const cur = lv.level ? app.harnessList.find((x) => x.id === lv.level) : null;
    const goSettings = () => { lv.close(); app.go({r: 'settings', sec: 'agent'}); };
    const eff = D.agent.efforts;
    const curEff = eff.find((e) => e.k === (sel.effort || 'mid')) || eff[1];
    return (
      <Picker size="s" icon={h ? <window.AgentIcon h={h} UNSAFE_className="ic--16" /> : null}
        label={AG.harnessLabel(h, sel.model, sel.activeModel)}
        value={compact ? AG.harnessShort(h, sel.model, sel.activeModel) : AG.harnessLabel(h, sel.model, sel.activeModel)}
        open={lv.pop} popWidth={320} popDir="up" popAlign="right"
        onClick={lv.toggle} onClose={lv.close}>
        {!cur ? (
          <>
            <ProviderLevel list={app.harnessList} sel={sel} onEnter={lv.setLevel} onSettings={goSettings}>
              <MenuRule />
              <MenuItem icon="settings" label="设置 › Agent…" sub="编码 Agent · 订阅 · 允许策略" onClick={goSettings} />
            </ProviderLevel>
          </>
        ) : (
          <ModelLevel h={cur} sel={sel} onBack={() => lv.setLevel(null)}
            onPick={(id) => { onChange({harness: cur.id, model: id}); lv.close(); }}>
            <MenuRule />
            <Menu>
              <MenuHead>推理强度 · {curEff.label}</MenuHead>
              {eff.map((e) => (
                <MenuItem key={e.k} label={e.label} sub={e.sub} on={e.k === curEff.k}
                  onClick={() => { onChange({effort: e.k}); lv.close(); }} />
              ))}
            </Menu>
          </ModelLevel>
        )}
      </Picker>
    );
  }

  Object.assign(window, {ProviderModelPicker, useComposerNarrow, AgentProviderLevel: ProviderLevel, AgentModelLevel: ModelLevel, useAgentPickerLevels: usePickerLevels});
})();
