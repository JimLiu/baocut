/* 文本模型的两级菜单（2026-10-28 用户要求：一长串模型不好选，先选提供方，再选它下面的模型；Agent 要能选模型和推理强度）。
   第一级：每家提供方一行——API 提供方与智能体（Codex 写文字）在同一张单子里，能用的在前（BC_LLM_TOOLS.models 的次序）；
   能用的那家点了就地翻到第二级，没连接的、不能用的那家在第一级写明原因，点了去设置，不进第二级。
   第二级：API 提供方是它的模型；智能体是「Agent 默认模型」打头 + 它的模型，再挂推理强度——与会话 composer 那枚 chip
   同一个样子（agent-picker.jsx `ProviderModelPicker`），推理强度跟模型住同一级。
   工具页（文本、翻译、配音，tool-translate.jsx `TextModelField`）、编辑器 AI 工具的模型下拉（tool-setup.jsx `ModelPick`）
   与「用」下拉的「直接调模型」页（`RunnerPick`）共用这里的两级；行文案全部由 model-llm-tools.js 算出，这里只负责画与翻页。 */
(function () {
  const L = window.BC_LLM_TOOLS;

  /** 这台电脑上的文本模型清单：API 提供方（app.cloudCatalog，连没连上看 cloudSaved）+ 装了时的 Codex 与它的模型表。 */
  function textCatalog(app) {
    const h = (app.harnessList || []).find((x) => x.id === 'codex') || null;
    const codex = h && h.found ? Object.assign({}, window.BC_CLOUD_IMAGE.codexReady(h, app.codexImageGen), {models: h.models || []}) : null;
    return L.models(app.cloudCatalog, app.cloudSaved, codex);
  }

  /** 一家提供方的图标（菜单行与收起的那一行共用）：智能体用 Agent 的图标，API 提供方用它自己的。 */
  function ProviderGlyph({id, name, agent, ...rest}) {
    return agent ? <window.AgentIcon h={{id: id.replace(/^agent:/, ''), name}} {...rest} /> : <window.VendorGlyph id={id} name={name} {...rest} />;
  }

  /** 第一级：每家一行，`onEnter(providerId)` 翻到第二级；`onSettings(row)` 去设置（没连接的去 API 提供方，智能体去 Agent）。
      `noHead`：宿主自己画了段头（「用」下拉的两段开关）时不再重复一行组头。 */
  function TextProviderLevel({list, value, noHead, onEnter, onSettings, children}) {
    const rows = L.providers(list, value);
    return (
      <Menu>
        {noHead ? null : <MenuHead>提供方</MenuHead>}
        {rows.map((r) => (
          <MenuItem key={r.id} icon={<ProviderGlyph id={r.id} name={r.name} agent={r.agent} />} label={r.name} sub={r.sub} on={r.on}
            suffix={r.ready ? <NavChevron /> : <Ic n="settings" className="ic--14" />}
            onClick={() => (r.ready ? onEnter(r.id) : onSettings(r))} />
        ))}
        {rows.length ? null : <MenuItem icon="sparkle" label="还没有文本模型" sub="连接一个 API 提供方，或打开「用 Codex 画图和写文字」" onClick={() => onSettings(null)} />}
        {children}
      </Menu>
    );
  }

  /** 第二级：返回行 + 「模型」组；智能体再接「推理强度」组。`onPick(modelKey, effort)`：选模型时同一家沿用已选的强度，
      换了一家回到默认；在推理强度组里点一档时，这家已经选着模型就用它，否则用「Agent 默认模型」。 */
  function TextModelLevel({list, providerId, value, effort, onBack, onPick}) {
    const row = L.providers(list, value).find((r) => r.id === providerId);
    if (!row) return null;
    const mine = row.on;
    return (
      <Menu>
        <MenuItem icon="chevleft" label={row.name} sub={row.sub} onClick={onBack} />
        <MenuRule />
        <MenuHead>模型</MenuHead>
        {L.modelRows(row, value).map((m) => (
          <MenuItem key={m.id} label={m.name} sub={m.sub} on={m.on} onClick={() => onPick(m.id, row.agent && mine ? effort : null)} />
        ))}
        {row.agent ? (
          <>
            <MenuRule />
            <MenuHead>推理强度 · {mine ? L.effortOf(effort).label : L.effortOf(null).label}</MenuHead>
            {L.EFFORTS.map((e) => (
              <MenuItem key={e.k} label={e.label} sub={e.sub} on={mine && e.k === L.effortOf(effort).k}
                onClick={() => onPick(mine ? value : L.CODEX_TEXT_ID, e.k)} />
            ))}
          </>
        ) : null}
      </Menu>
    );
  }

  /** 收起时是一枚下拉：「提供方 · 模型」（智能体再接推理强度），前面是提供方的图标。
      `value` 模型 key，`effort` 智能体的推理强度；`onChange({model, effort})`；`settings` 是没连接的 API 提供方去的设置页。 */
  function TextModelPicker({list, value, effort, onChange, size, settings, popWidth}) {
    const app = useApp();
    const lv = window.useAgentPickerLevels();
    const cur = list.find((m) => m.id === value) || null;
    const goSettings = (r) => {
      lv.close();
      app.go(r && r.agent ? {r: 'settings', sec: 'agent'} : settings || {r: 'settings', sec: 'cloud', tab: 'llm'});
    };
    const pick = (model, eff) => { onChange({model, effort: eff || null}); lv.close(); };
    return (
      <Picker size={size || 's'} label="文本模型" icon={cur ? <ProviderGlyph id={cur.providerId} name={cur.provider} agent={cur.agent} UNSAFE_className="ic--16" /> : null}
        value={cur ? L.pickLabel(cur, effort) : '选一个文本模型'} open={lv.pop} popWidth={popWidth || 320}
        onClick={lv.toggle} onClose={lv.close}>
        {lv.level ? (
          <TextModelLevel list={list} providerId={lv.level} value={value} effort={effort} onBack={() => lv.setLevel(null)} onPick={pick} />
        ) : (
          <TextProviderLevel list={list} value={value} onEnter={lv.setLevel} onSettings={goSettings}>
            <MenuRule />
            <MenuItem icon="settings" label="设置 › 模型 › 文本生成…" sub="连接 API 提供方 · 默认模型 · Codex 写文字" onClick={() => goSettings(null)} />
          </TextProviderLevel>
        )}
      </Picker>
    );
  }

  Object.assign(window, {TextModelPicker, TextProviderLevel, TextModelLevel, BC_TEXT_CATALOG: textCatalog});
})();
