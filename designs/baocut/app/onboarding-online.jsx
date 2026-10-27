/* 首次启动引导的「在线服务」一面（GitHub issue 100：不想把模型都下到本机——磁盘不够、电脑跑不动——引导里就能直接配在线服务）。
   只在有 API 提供方的三步出现：语音识别、语音合成、图像生成（默认显示哪一面、候选、主按钮在 model-onboarding.js「在线服务」一节）。
   - 顶上「本机模型 | 在线服务」切换；本机一只都跑不了时没有切换，直接是在线服务。
   - 在线服务是单选卡片（同翻译配音的取向卡，RSP.RadioGroup）：目录里有这种能力的 API 提供方，连着的在前。
     选中一家还没连的，卡片里展开与 设置 › API 提供方 同一个「添加账号」表单（settings-provider-detail.jsx，`compact`：不要名称），
     验证通过才保存，存进同一份账号表，设置页立刻看得到；连上后选中它，主按钮「用 X 并继续」把这种能力的默认模型设成它。
   - 开头一句如实说明：不下载、按调用量付费、要处理的内容会发给这家（product-design §7.4 费用如实；从本地转云端要用户自己选）。
   只在 App 入口加载（Web 不弹引导）。 */
(function () {
  const S = window.RSP;
  const OB = window.BC_ONBOARDING;
  const V = () => window.BC_VENDORS;

  /** 「本机模型 | 在线服务」 */
  function OnbModeSwitch({mode, onChange}) {
    return (
      <div className="onb-mode">
        <window.BCControlLabel.Provider value="用本机模型还是在线服务">
          <Segmented size="s" value={mode} onChange={onChange} items={[{k: 'local', label: '本机模型'}, {k: 'online', label: '在线服务'}]} />
        </window.BCControlLabel.Provider>
      </div>
    );
  }

  /** 一家 API 提供方（单选卡）：右边连着的写「已连接」；下面一句写默认用哪只模型或这把密钥还能用在哪；选中而没连时展开添加账号 */
  function ProviderCard({r, on, settings, onPick, onConnected}) {
    const v = r.vendor;
    // 点在单选框自己的 label 上交给它；已选中时点卡片（包括里面的表单）不做事
    const click = (e) => { if (!on && !e.target.closest('label')) onPick(r.id); };
    return (
      <div className={cx('onb-model', 'onb-prov', on && 'is-on')} onClick={click}>
        <span className="onb-model__hd">
          <S.Radio value={r.id}><span className="onb-prov__nm"><window.VendorIcon id={r.id} name={v.name} />{v.name}</span></S.Radio>
          {v.kind === 'relay' ? <Chip tone="neutral">中转</Chip> : v.kind === 'custom' ? <Chip tone="neutral">自建</Chip> : null}
          <span className="grow" />
          {r.ready ? <span className="onb-model__ok"><Ic n="ok" className="ic--14" />已连接</span> : null}
        </span>
        <span className="onb-model__desc">{OB.onlineLine(r, V())}</span>
        {on && !r.ready ? (
          // 单选组拿方向键切换选项：表单里的方向键留给输入框；单选组带插槽的 TextContext 也在这里清掉（按钮文字不带插槽）
          <div className="onb-prov__form" onKeyDown={(e) => e.stopPropagation()}>
            <S.AriaTextContext.Provider value={null}>
              {v.site ? (
                <p className="t-detail-xs onb-prov__site">还没有密钥？到 <a href={v.site} target="_blank" rel="noreferrer">{V().hostOf(v.site)}</a> 创建一把，复制过来。</p>
              ) : null}
              <window.ProviderAddAccountForm compact vendor={v} settings={settings[r.id] || {}}
                baseFor={(region) => V().accountBase(r.id, {region}, settings)} onSaved={(o) => onConnected(r, o)} />
            </S.AriaTextContext.Provider>
          </div>
        ) : null}
      </div>
    );
  }

  /**
   * 在线服务那一面。`list`：OB.onlineChoices；`pick`：选中的提供方 id（null 没选）；`only`：本机跑不了、没有切换时为真。
   * 连上的写进与设置同一份 store（patchProvider 启用这家、setAccounts 加一个账号，只存掩码）。
   */
  function OnbOnline({app, stepK, list, pick, only, onPick}) {
    const settings = app.providerSettings;
    const connect = (r, o) => {
      const first = !(app.providerAccounts[r.id] || []).length;
      app.patchProvider(r.id, Object.assign({enabled: true}, o.region && first ? {region: o.region} : {}));
      app.setAccounts(r.id, (accts) => [...accts, V().makeAccount(o, accts, Date.now())]);
    };
    return (
      <div className="onb-online">
        <p className="onb-hint">
          {only ? '这台电脑跑不了本机的这类模型，可以用在线服务。' : ''}
          {`不用下载，不占这台电脑的空间。用你自己在这家的 API 密钥，按调用量付费；${OB.SENDS[stepK]}会发给它。`}
        </p>
        <S.RadioGroup aria-label="用哪一家在线服务" value={pick} onChange={onPick} UNSAFE_className="onb-provs">
          {list.map((r) => (
            <ProviderCard key={r.id} r={r} on={pick === r.id} settings={settings} onPick={onPick} onConnected={connect} />
          ))}
        </S.RadioGroup>
        <p className="onb-note">一把密钥对这家的全部能力生效。账号与密钥在 设置 › API 提供方 里管理，默认用哪只模型在各能力页里改。</p>
      </div>
    );
  }

  Object.assign(window, {OnbModeSwitch, OnbOnline});
})();
