/* 设置 —— §17.3。左栏的「模型」组依次是 API 提供方、用量，然后每种能力一页（product-design §7.6）：本机模型与 API 提供方的模型
   在同一页，不再分本地 / 云端两个 Tab；我的声音是语音合成的第二个 Tab，Skills 并进 Agent（表在 model-settings-nav.js）。
   起因是「本地模型都不能测试，也不能删除」：那一节此前只有静态行，而
   apps/baocut 的 settings/local_models.rs 顶部写着它是**照着原型的缺口做的减法**。
   补原型是解开那条注释的前置，所以这一节的动作集合、状态词表与确认语都要齐。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const Row = window.ShellRow;

  /* ---------- 通用 ---------- */
  function GeneralSection() {
    const app = useApp();
    const [pop, setPop] = useState(null);
    const [v, setV] = useState({autoOpen: true, lineLen: '中'});
    const set = (p) => setV((s) => ({...s, ...p}));
    /* 界面语言存 prefs（刷新不丢）：内置模板的名字、说明与示例文字跟着它换（2026-09-14）。 */
    return (
      <>
        <h1 className="setpage__title">通用</h1>
        <section className="setpage__group" aria-label="界面">
          <h2>界面</h2>
          <div className="setpage__card">
            <Row label="界面语言" desc="改完立即生效，不用重启。内置模板的名字与示例文字也跟着换。">
              <Picker size="s" value={app.uiLang} open={pop === 'lang'} popAlign="right" popWidth={200}
                onClick={() => setPop(pop === 'lang' ? null : 'lang')} onClose={() => setPop(null)}>
                <Menu>
                  {['跟随系统', '简体中文', '繁體中文', 'English', '日本語', '한국어', 'Español', 'Français',
                    'Deutsch', 'Nederlands', 'Português (BR)', 'Italiano', 'Русский', 'Polski', 'Türkçe', 'Tiếng Việt']
                    .map((l) => <MenuItem key={l} label={l} on={l === app.uiLang}
                      onClick={() => { app.setPref('lang', l); setPop(null); }} />)}
                </Menu>
              </Picker>
            </Row>
            <Row label="外观">
              <Segmented size="s" value={app.theme} onChange={(t) => app.setPref('theme', t)}
                items={[{k: 'system', label: '跟随系统'}, {k: 'light', label: '浅色'}, {k: 'dark', label: '深色'}]} />
            </Row>
          </div>
        </section>
        <section className="setpage__group" aria-label="编辑与转录">
          <h2>编辑与转录</h2>
          <div className="setpage__card">
            <Row label="转录完成后自动打开视频" desc="用于本地导入；链接导入在后台完成时只通知，保留你当前的页面。">
              <Switch on={v.autoOpen} onChange={(x) => set({autoOpen: x})} />
            </Row>
            <Row label="字幕行长" desc="影响自动断行的目标长度，不影响已经手工改过的行。">
              <Segmented size="s" value={v.lineLen} onChange={(x) => set({lineLen: x})}
                items={[{k: '短', label: '短'}, {k: '中', label: '中'}, {k: '长', label: '长'}]} />
            </Row>
            <Row label="文稿里的 cue 底纹" desc="给每条字幕的范围铺一层浅底，看得出断在哪。">
              <Switch ariaLabel="文稿里的 cue 底纹" on={app.prefs.cueShading === true} onChange={(x) => app.setPref('cueShading', x)} />
            </Row>
          </div>
        </section>
        <section className="setpage__group" aria-label="下载与更新">
          <h2>下载与更新</h2>
          <div className="setpage__card">
            <SaveDirRow />
            <window.AppUpdateAutoRow />
          </div>
          <window.DownloaderSettings />
        </section>
      </>
    );
  }

  /* 默认保存位置（product-design §2.7「页面」末段；architecture §5.10 `downloads.directory`）：工具结果、下载的视频与
     Agent 交出的文件都保存到这里，缺省是运行 Runtime 那台电脑的系统下载文件夹。工具页的「更改…」只改那一次，不写回这里。
     原型用 toast 代替系统文件夹选择器，选中的是一个演示目录。 */
  const DEMO_SAVE_DIR = '~/Movies/BaoCut 结果';
  function SaveDirRow() {
    const app = useApp();
    const SAVE = window.BC_SAVE_DIR;
    const cur = SAVE.setting(app.prefs);
    const isDefault = SAVE.isDefault(app.prefs);
    const pick = () => {
      app.setPref('saveDir', DEMO_SAVE_DIR);
      app.toast(`已改为 ${SAVE.label(DEMO_SAVE_DIR)}（演示：桌面应用打开系统文件夹选择器）`, 'positive');
    };
    return (
      <Row label="默认保存位置" desc="工具结果、下载的视频与 Agent 交出的文件都保存到这里。默认是系统的下载文件夹。" mono={SAVE.label(cur)}>
        {isDefault ? <Chip tone="neutral">默认</Chip> : null}
        <Btn variant="secondary" size="s" onClick={pick}>更改…</Btn>
        {isDefault ? null : (
          <Btn variant="quiet" size="s" onClick={() => { app.setPref('saveDir', ''); app.toast('已恢复为系统的下载文件夹'); }}>恢复默认</Btn>
        )}
      </Row>
    );
  }

  /* ---------- 快捷键 ---------- */
  function ShortcutsSection() {
    const app = useApp();
    const [rec, setRec] = useState(null);
    const [binds, setBinds] = useState({});
    return (
      <>
        <div className="row" style={{marginBottom: 4}}>
          <div className="t-title grow">快捷键</div>
          <Btn variant="quiet" size="s" onClick={() => { setBinds({}); app.toast('已恢复默认绑定', 'positive'); }}>
            恢复默认
          </Btn>
        </div>
        {D.setShortcuts.map((g) => (
          <div key={g.grp}>
            <div className="t-section" style={{marginTop: 16}}>{g.grp}</div>
            {g.rows.map(([name, key]) => (
              <Row key={name} label={name}>
                <BCAction className={cx('chip', 'chip--click', rec === name && 'is-on')}
                  style={{fontFamily: 'var(--mono)', minWidth: 68, justifyContent: 'center'}}
                  onClick={() => {
                    if (rec === name) {
                      setBinds((b) => ({...b, [name]: '⌥⌘' + name.slice(0, 1)}));
                      setRec(null);
                      app.toast('已改绑（原型落一个演示绑定；真 App 用 NSEvent 捕获真实按键）');
                    } else setRec(name);
                  }}>
                  {rec === name ? '按下按键…' : (binds[name] || key)}
                </BCAction>
              </Row>
            ))}
          </div>
        ))}
        <div className="signpost" style={{marginTop: 16}}>
          点一次进录制态，按下新的组合键即可；与已有快捷键冲突时会提示被谁占用。
        </div>
      </>
    );
  }

  /* ---------- 隐私 / 诊断 / 关于 ---------- */
  function PrivacySection() {
    const app = useApp();
    return (
      <>
        <div className="t-title" style={{marginBottom: 4}}>隐私与权限</div>
        <Row label="发送匿名使用统计" desc="只发功能使用次数，不含任何媒体内容或文本。">
          <Switch on={false} onChange={() => app.toast('已开启')} />
        </Row>
        <Row label="本地分析缓存" desc="波形、缩略图这类派生数据，随时可以重建。">
          <Btn variant="secondary" size="s" onClick={() => app.toast('已清空缓存', 'positive')}>清空</Btn>
        </Row>
        <Row label="删除云端账号数据" desc="已提交删除请求 · 处理中">
          <Chip tone="notice">Deletion pending</Chip>
        </Row>
        <BCAction className="viewall" style={{marginTop: 12}}
          onClick={() => app.toast('打开隐私政策')}>隐私政策</BCAction>
        {/* Agent 的访问权限（2026-10-05 从 Agent 设置的页签搬来），Web 入口没有 Agent，不显示 */}
        {window.BC_SURFACE.agent && window.AgentPermissionsSection ? <div className="setpage__perm"><div className="t-title">Agent 权限</div><window.AgentPermissionsSection /></div> : null}
      </>
    );
  }

  function DiagnosticsSection() {
    const app = useApp();
    const [open, setOpen] = useState(null);
    const [sent, setSent] = useState({});
    return (
      <>
        <div className="t-title" style={{marginBottom: 4}}>诊断</div>
        {D.setCrashes.map((c) => {
          const isSent = sent[c.id] || c.state === 'sent';
          return (
            <div key={c.id} style={{borderBottom: '1px solid var(--gray-100)', padding: '10px 0'}}>
              <div className="row gap8">
                <IconBtn icon={open === c.id ? 'chevdown' : 'chevright'} size="xs" tip="展开"
                  onClick={() => setOpen(open === c.id ? null : c.id)} />
                <span className="grow">
                  <b className="t-ui t-strong">{c.reason}</b>
                  <span className="t-detail-xs" style={{display: 'block'}}>{c.when} · {c.ver}</span>
                </span>
                <Chip tone={isSent ? 'positive' : 'neutral'}>{isSent ? '已发送' : '待发送'}</Chip>
                {isSent ? null : (
                  <Btn variant="secondary" size="s"
                    onClick={() => { setSent((s) => ({...s, [c.id]: true})); app.toast('已发送崩溃报告', 'positive'); }}>
                    发送
                  </Btn>
                )}
                <IconBtn icon="trash" size="s" tip="删除" onClick={() => app.toast('已删除这条报告')} />
              </div>
              {open === c.id ? (
                <div style={{marginTop: 8, paddingLeft: 26}}>
                  <Card layer style={{padding: 10}}>
                    <div className="t-mono t-detail-xs" style={{whiteSpace: 'pre-wrap', lineHeight: 1.6}}>
                      {`Thread 7 Crashed:\n0  bcut-render  0x1042a1f0  raster::draw_element + 128\n1  bcut-render  0x1042998c  FramePlan::render + 412\n2  BaoCut       0x1001b204  stage::paint + 96`}
                    </div>
                  </Card>
                  <Field area placeholder="崩溃前你在做什么？（可选）" style={{marginTop: 8}} />
                  <div className="t-detail-xs" style={{marginTop: 6}}>
                    路径与视频名已经脱敏；<b>这一行备注我们没法替你脱敏</b>，别写敏感内容。
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        <Row label="崩溃后自动发送" desc="默认关。开启后不再逐条询问。">
          <Switch on={false} onChange={() => app.toast('已开启自动发送')} />
        </Row>
        <Btn variant="secondary" size="s" icon="folder" style={{marginTop: 12}}
          onClick={() => app.toast('已打开日志目录')}>打开日志目录</Btn>
      </>
    );
  }

  /* 关于：居中卡片 + 更新状态（§17.7，2026-10-01），本体在 settings-update.jsx。 */
  const AboutSection = () => <window.AppUpdateAbout />;

  /* Skills：内置 Agent 自己使用的 skills，左栏 Agent 组的第二项（settings-agent-skills.jsx）。 */
  const SkillsSection = () => <div className="agent-settings" data-screen-label="Skills 设置"><h1 className="t-heading-sm">Skills</h1><window.AgentSkillsManager /></div>;

  const SECTIONS = {
    general: GeneralSection, shortcuts: ShortcutsSection, fonts: window.FontsSection, voices: window.VoicesSection,
    providers: window.ProvidersSection, usage: window.UsageSection, agent: window.AgentSection, skills: SkillsSection,
    glossary: window.GlossarySection, privacy: PrivacySection,
    diagnostics: DiagnosticsSection, about: AboutSection,
  };

  /* 左栏（§7.6）：一项 = 一节或一种能力；能力页的正文是 settings-capability.jsx，语音合成多一个「我的声音」Tab。
     表与路由换算在 model-settings-nav.js。每一项上次停在哪一页只在这次打开里记。 */
  const NV = window.BC_SETTINGS_NAV;
  const lastPage = {};

  /* 左栏固定、只滚右侧（2026-09-13）：导航与正文是两个兄弟，滚动容器只包正文。 */
  /* id：API 提供方详情 / 用量只看哪一家（路由的路径段）；from=add：从「添加 API 提供方」来 */
  function SettingsPage({sec, tab, id, from}) {
    const app = useApp();
    const r = NV.normalize(sec, tab);
    const title = '设置';
    const navK = NV.navOf(r.sec, r.tab);
    const nav = NV.byKey(navK);
    lastPage[navK] = r.sec;
    const Body = nav.capPage && r.sec !== 'voices' ? window.CapabilitySection : SECTIONS[r.sec] || GeneralSection;
    const R = window.RSP;
    const groups = NV.searchGroups('');
    const icons = {general: 'Settings', shortcuts: 'Keyboard', providers: 'Cloud', usage: 'Data', asr: 'Transcript', tts: 'AudioWave', llm: 'Text', image: 'Image', sep: 'UnlinkHoriz', vision: 'Visibility', glossary: 'FileText', privacy: 'Lock', diagnostics: 'Properties', about: 'InfoCircle'};
    const href = (n) => window.BC_APP_IA.hrefFor(NV.routeFor(n.k, null, lastPage[n.k]));
    return (
      <div className="setpage">
        <nav className="setpage__nav bc-scroll" aria-label={`${title}导航`}>
          <h2 className="app-section-title">{title}</h2>
          <R.SideNav aria-label={`${title}分类`} selectedRoute={href(nav)}>
            {groups.map((g) => <R.SideNavSection key={g.id} id={g.id}>
              <R.SideNavHeader>{g.label}</R.SideNavHeader>
              {g.items.map((n) => {
                const Icon = R.Icons[icons[n.k]];
                return <R.SideNavItem key={n.k} id={n.k} textValue={n.label} href={href(n)} data-settings-row="">
                  <R.SideNavItemContent><R.SideNavItemLink href={href(n)}>{n.k === 'agent' ? <Ic n="agent" /> : n.k === 'skills' ? <Ic n="skill" /> : n.k === 'fonts' ? <Ic n="text" /> : <Icon />}<R.Text>{n.label}</R.Text></R.SideNavItemLink></R.SideNavItemContent>
                </R.SideNavItem>;
              })}
            </R.SideNavSection>)}
          </R.SideNav>
          {app.openHelp && <R.ActionButton isQuiet onPress={(e) => app.openHelp(e)} UNSAFE_className="setpage__help"><R.Icons.HelpCircle /><R.Text>帮助</R.Text></R.ActionButton>}
        </nav>
        <div className="setpage__main bc-scroll" key={navK}>
          <div className="setpage__compact">
            <span className="t-ui">{title}</span>
            <R.Picker aria-label={`${title}分类`} selectedKey={navK} onSelectionChange={(k) => app.replace(NV.routeFor(String(k), null, lastPage[k]))}>
              {groups.flatMap((g) => g.items).map((n) => <R.PickerItem key={n.k} id={n.k}>{n.label}</R.PickerItem>)}
            </R.Picker>
            {app.openHelp && <R.ActionButton isQuiet aria-label="帮助" onPress={(e) => app.openHelp(e)}><R.Icons.HelpCircle /></R.ActionButton>}
          </div>
          <div className="setpage__in">
            {nav.capPage && <header className="setpage__intro">
              <h1>{nav.label}</h1><p>{NV.DESCRIPTIONS[navK]}</p>
            </header>}
            {nav.pages.length > 1 ? (
              <R.Tabs aria-label={`${nav.label}设置`} selectedKey={r.sec} onSelectionChange={(p) => app.replace(NV.routeFor(navK, p))}>
                <div className="setpage__tabs">
                  <R.TabList aria-label={`${nav.label}设置`}>
                    {nav.pages.map((p) => {
                      const Icon = R.Icons[{tts: 'AudioWave', voices: 'Microphone'}[p]];
                      return <R.Tab key={p} id={p}>{Icon && <Icon />}<R.Text>{NV.PAGE_LABEL[p]}</R.Text></R.Tab>;
                    })}
                  </R.TabList>
                </div>
                {nav.pages.map((p) => {
                  const PanelBody = p === 'voices' ? SECTIONS.voices : window.CapabilitySection;
                  return <R.TabPanel key={p} id={p}><PanelBody sec={navK} /></R.TabPanel>;
                })}
              </R.Tabs>
            ) : <Body sec={r.sec} tab={r.tab} id={id} from={from} />}
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, {SettingsPage});
})();
