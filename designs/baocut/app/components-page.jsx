/* 控件样本页 —— Components.html 的正文。
   加了新控件就在这里加一格：这一页是控件层对着 _ds_prompt.md 自查的地方
   （控件高度 / 圆角阶梯 / 150ms 动效 / scale(0.96) / 焦点环 2px+2px）。 */
(function () {
  const {useState} = React;

  const GRAYS = ['25','50','75','100','200','300','400','500','600','700','800','900','1000'];
  const HUES = {blue:['100','200','300','400','800','900','1000','1100'], red:['100','200','300','900','1000'],
    orange:['100','200','300','400','900','1000'], green:['100','200','300','400','900','1000'],
    purple:['200','300','400','1000'], cyan:['200','300','400','1000'], magenta:['200','300','400','1000'],
    seafoam:['200','300','400','1000'], indigo:['200','300','400','1000'], yellow:['100','200','300','1000']};

  function Sec({title, note, children}) {
    return (
      <section className="sec">
        <h2>{title}</h2>
        {note ? <p className="note">{note}</p> : null}
        {children}
      </section>
    );
  }

  function App() {
    const [seg, setSeg] = useState('grid');
    const [sw, setSw] = useState(true);
    const [cb, setCb] = useState(true);
    const [rd, setRd] = useState('b');
    const [vol, setVol] = useState(80);
    const [zoom, setZoom] = useState(100);
    const [num, setNum] = useState(12);
    const [pin, setPin] = useState({x: 'left', y: 'top'});
    const [pop, setPop] = useState(null);
    const [language, setLanguage] = useState('ja');
    const [sourceLanguage, setSourceLanguage] = useState('auto');
    const [dubLanguage, setDubLanguage] = useState('zh');
    const [dlg, setDlg] = useState(false);
    const [ask, setAsk] = useState(null);
    const [toasts, setToasts] = useState([]);
    let nid = React.useRef(1);

    const toast = (text, tone, action) =>
      setToasts((t) => [...t, {id: nid.current++, text, tone, action}]);
    const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));
    const togglePop = (k) => setPop((p) => (p === k ? null : k));

    return (
      <div className="pg-wrap">
        <header className="pg-hd">
          <div className="t-heading">控件样本</div>
          <div className="t-detail" style={{marginTop: 4}}>
            <code>@react-spectrum/s2</code> · App 与 Web 共用官方控件。
            <code>app/ui.jsx</code> 与 <code>app/ui-spectrum.jsx</code> 适配现有屏幕接口。
          </div>
        </header>

        <Sec title="Button" note="pill 形状；四档尺寸 XS 20 / S 24 / M 32 / L 40 / XL 48；hover 沿色阶走一档；按下 scale(0.96)。">
          <div className="strip">
            <Btn variant="accent">开始转录</Btn>
            <Btn variant="primary">保存</Btn>
            <Btn variant="secondary">取消</Btn>
            <Btn variant="negative">删除视频</Btn>
            <Btn variant="outline">选择文件</Btn>
            <Btn variant="quiet">稍后再说</Btn>
            <Btn variant="accent" disabled>不可用</Btn>
          </div>
          <div className="strip">
            <Btn variant="accent" size="xs">XS 20</Btn>
            <Btn variant="accent" size="s">S 24</Btn>
            <Btn variant="accent" size="m">M 32</Btn>
            <Btn variant="accent" size="l">L 40</Btn>
            <Btn variant="accent" size="xl">XL 48</Btn>
          </div>
          <div className="strip">
            <Btn variant="secondary" icon="plus">新建视频</Btn>
            <Btn variant="secondary" icon="export">导出</Btn>
            <Btn variant="secondary" iconRight="chevdown">更多语言</Btn>
          </div>
        </Sec>

        <Sec title="IconButton" note="方形安静按钮，圆角走控件阶梯（XS 6 / S 7 / M 8 / L 9）。hover 有 tooltip。">
          <div className="strip">
            <IconBtn icon="play" tip="播放" />
            <IconBtn icon="split" tip="在播放头分割 (S)" />
            <IconBtn icon="undo" className="ibtn--undo" tip="撤销" />
            <IconBtn icon="redo" tip="重做" disabled />
            <IconBtn icon="captions" tip="隐藏字幕" on />
            <IconBtn icon="more" tip="更多" />
            <div className="vrule" style={{height: 24}} />
            <IconBtn icon="search" size="xs" tip="XS 20" />
            <IconBtn icon="search" size="s" tip="S 24" />
            <IconBtn icon="search" size="m" tip="M 32" />
            <IconBtn icon="search" size="l" tip="L 40" />
          </div>
        </Sec>

        <Sec title="Chip / Picker" note="chip 是只读标记或开关；picker 是带 chevron 的下拉入口，弹层贴边自动翻转。">
          <div className="strip">
            <Chip>62 cues</Chip>
            <Chip tone="accent">进行中</Chip>
            <Chip tone="positive">已完成</Chip>
            <Chip tone="notice">缺 aligner + VAD</Chip>
            <Chip tone="negative">失败</Chip>
            <Chip tone="info" pill>排队中 · 第 2 位</Chip>
            <Chip onClick={() => {}} icon="star">可点</Chip>
          </div>
          <div className="strip" style={{marginTop: 16}}>
            <Picker value="16:9" size="s" open={pop === 'ratio'} onClick={() => togglePop('ratio')}
              onClose={() => setPop(null)} popDir="down" popWidth={170}>
              <Menu>
                {['Original', '16:9', '9:16', '1:1', '4:3', '3:4', '2:1', '2.35:1', '1.85:1'].map((r) => (
                  <MenuItem key={r} label={r} on={r === '16:9'} onClick={() => setPop(null)} />
                ))}
                <MenuRule />
                <MenuItem label="Custom…" onClick={() => setPop(null)} />
              </Menu>
            </Picker>
            <Picker value="whisper-small" open={pop === 'model'} onClick={() => togglePop('model')}
              onClose={() => setPop(null)} popWidth={232}>
              <Menu>
                <MenuHead>本地</MenuHead>
                <MenuItem label="whisper-small" sub="466 MB · 已安装" on onClick={() => setPop(null)} />
                <MenuItem label="whisper-medium" sub="1.5 GB · 未安装" suffix="下载" onClick={() => setPop(null)} />
                <MenuRule />
                <MenuHead>云端</MenuHead>
                <MenuItem label="gpt-4o-transcribe" sub="OpenAI · 按分钟计价" onClick={() => setPop(null)} />
              </Menu>
            </Picker>
            <LanguageCombobox value={language} onChange={setLanguage} />
            <LanguageCombobox value={sourceLanguage} asrModel="whisper-large-v3" onChange={setSourceLanguage} />
            {/* 翻译配音：只列 IndexTTS2 会念的语言，副题标「已有译文 / 先翻译」 */}
            <LanguageCombobox value={dubLanguage} onChange={setDubLanguage} label="配音语言"
              only={['zh', 'zh-Hant', 'en']} marks={{zh: '已有译文', 'zh-Hant': '先翻译', en: '先翻译'}} heading="IndexTTS2 能念 · 3" />
          </div>
          <div className="strip" style={{marginTop: 16}}>
            <Picker value="访问模式 · 监督" size="s" open={pop === 'mode'} onClick={() => togglePop('mode')}
              onClose={() => setPop(null)} popDir="up" popWidth={288}>
              <Menu>
                {[
                  {k: 'ask', icon: 'lock', label: '监督', sub: '执行命令或修改文件前先征求许可'},
                  {k: 'auto', icon: 'sparkle', label: '自动', sub: '由编码 Agent 自带的审核者批准常规操作；高风险操作仍会询问'},
                  {k: 'full', icon: 'unlock', label: '完全访问', sub: '无需确认即可执行命令和修改文件'},
                ].map((m) => (
                  <MenuItem key={m.k} icon={m.icon} label={m.label} sub={m.sub} wrap check={m.k === 'ask'}
                    onClick={() => setPop(null)} />
                ))}
              </Menu>
            </Picker>
          </div>
        </Sec>

        <Sec title="Field" note="高 32（M），焦点是 2px 内描边；不是焦点环——焦点环留给键盘导航（Tab 试试）。">
          <div className="strip">
            <div style={{width: 240}}><Field placeholder="视频名称" defaultValue="科浪访谈 第 42 期" /></div>
            <div style={{width: 240}}><Field icon="search" placeholder="搜索视频" /></div>
            <div style={{width: 160}}><Field size="s" placeholder="S 24" /></div>
            <div style={{width: 200}}><Field invalid defaultValue="不是合法的时间码" /></div>
          </div>
          <div className="strip"><div style={{width: 420}}><Field area placeholder="给 Agent 的指令" /></div></div>
        </Sec>

        <Sec title="Segmented / Switch / Checkbox / Radio" note="开关与勾选走小控件档（14/16/18/20），不是控件档。">
          <div className="strip">
            <Segmented value={seg} onChange={setSeg} items={[{k: 'grid', label: '网格', icon: 'grid'}, {k: 'list', label: '列表', icon: 'list'}]} />
            <Segmented size="s" value={seg} onChange={setSeg} items={[{k: 'grid', label: '网格'}, {k: 'list', label: '列表'}]} />
            <div className="vrule" style={{height: 24}} />
            <Switch on={sw} onChange={setSw} label="转录完成后自动打开" />
            <Switch on={false} onChange={() => {}} label="关闭态" />
            <Switch on={true} disabled label="不可用" />
          </div>
          <div className="strip">
            <Checkbox on={cb} onChange={setCb} label="拆分前先确认翻译结果" />
            <Checkbox on={false} onChange={() => {}} label="未勾选" />
            <Checkbox on={false} disabled label="不可用" />
            <div className="vrule" style={{height: 24}} />
            <window.RSP.RadioGroup aria-label="字幕语言" value={rd} onChange={setRd} orientation="horizontal">
              <window.RSP.Radio value="a">双语</window.RSP.Radio><window.RSP.Radio value="b">仅原文</window.RSP.Radio><window.RSP.Radio value="c">仅译文</window.RSP.Radio>
            </window.RSP.RadioGroup>
          </div>
        </Sec>

        <Sec title="Slider / Stepper / Progress" note="滑杆是真的能拖能写的——前身画板受格式限制只能做展示件。">
          <div className="strip">
            <div style={{width: 220}}><Slider value={vol} onChange={setVol} /></div>
            <span className="t-mono t-detail" style={{width: 40}}>{vol}%</span>
            <div className="vrule" style={{height: 24}} />
            <Stepper value={zoom + '%'} onDec={() => setZoom((z) => Math.max(20, Math.round(z / 1.5)))}
              onInc={() => setZoom((z) => Math.min(400, Math.round(z * 1.5)))}
              onValueClick={() => toast('缩放菜单在编辑器里；这里只演示 stepper')}
              decTip="缩小" incTip="放大" />
          </div>
          <div className="strip" style={{alignItems: 'stretch'}}>
            <div style={{width: 220}}><Progress value={62} /></div>
            <div style={{width: 220}}><Progress indeterminate /></div>
            <div style={{width: 120}}><Progress value={38} thin /></div>
            <div style={{width: 320}}><Steps items={[{k: 'a', label: '设置'}, {k: 'b', label: '对比时长'}, {k: 'c', label: '生成'}]} cur={1} /></div>
          </div>
        </Sec>

        <Sec title="PromptField / ComposerAttachment" note="官方 AI PromptField、引用 token、附件列表和工具栏；各宿主决定模型、数量限制与发送行为。">
          <ComposerAttachment name="参考图片.png" preview={<Ic n="image" className="ic--16" />} onRemove={() => toast('移除附件')} />
          <PromptField onSubmit={() => toast('提示词已提交')} inputProps={{rows: 3, placeholder: '描述你要的画面'}} toolbar={<><Btn size="s" icon="plus" onClick={() => toast('选择参考图')}>选参考图</Btn><span className="t-detail-xs">0 / 4</span></>} />
        </Sec>

        <Sec title="NumField / PinGrid" note="数字框使用 S2 NumberField，支持小数、范围限制与键盘步进，Enter / 失焦提交；九宫钉点只换参照系。">
          <div className="strip">
            <NumField label="X" value={num} unit="%" min={-100} max={200} onChange={setNum} tip="距左" />
            <NumField label="W" value={40} unit="%" disabled />
            <div className="vrule" style={{height: 24}} />
            <PinGrid value={pin} onChange={setPin} />
            <span className="t-detail">{window.BC_GEOM ? window.BC_GEOM.pinTip(pin) : pin.x + ' · ' + pin.y}</span>
            <PinGrid value={pin} disabled />
          </div>
        </Sec>

        <Sec title="Card / Todo / Empty" note="卡片 10px 圆角。Todo 是本轮统一的「未做」标记——后续每补一块就是删一个标记。">
          <div className="strip" style={{alignItems: 'stretch'}}>
            <Card className="" style={{padding: 14, width: 240}}>
              <div className="t-title-sm">静态卡片</div>
              <div className="t-detail" style={{marginTop: 4}}>12 clips · 2 小时前编辑</div>
            </Card>
            <Card onClick={() => toast('卡片可点')} style={{padding: 14, width: 240, textAlign: 'left'}}>
              <div className="t-title-sm">可点卡片</div>
              <div className="t-detail" style={{marginTop: 4}}>hover 有阴影，按下 scale(0.96)</div>
            </Card>
            <Card on style={{padding: 14, width: 240}}>
              <div className="t-title-sm">选中卡片</div>
              <div className="t-detail" style={{marginTop: 4}}>2px accent 内描边</div>
            </Card>
          </div>
          <div className="strip" style={{marginTop: 16, alignItems: 'stretch'}}>
            <div style={{width: 380}}>
              <Todo title="本轮未做：Remote compute">双 Tab、6 位码配对、doctor 诊断与 Share 大卡在下一轮补。</Todo>
            </div>
            <Todo inline>Export 三段式：骨架</Todo>
          </div>
          <Empty icon="folder" title="还没有视频">从上面的类型卡开一个，或把媒体文件拖进来。</Empty>
        </Sec>

        <Sec title="Dialog / Confirm / Toast" note="对话框 16px 圆角、遮罩黑 0.4；确认框的动作是闭集，没有兜底臂。">
          <div className="strip">
            <Btn variant="secondary" onClick={() => setDlg(true)}>打开对话框</Btn>
            <Btn variant="secondary" onClick={() => setAsk({
              title: '删除「科浪访谈 第 42 期」？',
              body: '视频包与派生产物一并移除。媒体源文件不受影响。',
              tone: 'negative', confirmLabel: '删除',
            })}>删除确认</Btn>
            <div className="vrule" style={{height: 24}} />
            <Btn variant="secondary" onClick={() => toast('已在 00:12.4 分割 · 元素与字幕已联动切分')}>中性 toast</Btn>
            <Btn variant="secondary" onClick={() => toast('已应用 · 润色 45 段 · 12.4s · deepseek-v4', 'positive', {label: '撤销', undo: true, run: () => toast('已撤销')})}>收据 toast</Btn>
            <Btn variant="secondary" onClick={() => toast('把播放头移到片段内再分割', 'negative')}>失败 toast</Btn>
          </div>
        </Sec>

        <Sec title="撤销的两档警示底"
          note="橙 = 一步反悔、代价为零；红 = 撤销会把一整批产出移除，只能重跑。黄留给查找高亮，撤销不用。常驻的那两颗只在 hover 时上底色。">
          <div className="strip">
            <BCAction className="toast__act toast__act--undo" type="button">撤销</BCAction>
            <span className="t-detail-xs">toast · 橙</span>
            <div className="vrule" style={{height: 24}} />
            <BCAction className="ccbtn ccbtn--undo" type="button">撤销</BCAction>
            <span className="t-detail-xs">AI 收据 · 红</span>
            <div className="vrule" style={{height: 24}} />
            <BCAction className="ccbtn ccbtn--revert" type="button">还原本段</BCAction>
            <IconBtn icon="undo" size="s" className="ibtn--undo" tip="撤销 ⌘Z" />
            <span className="t-detail-xs">常驻 · 只在 hover 上底</span>
          </div>
        </Sec>

        <Sec title="排版角色" note="14px 是 UI 默认、12px 是标签、11px 是下限。没有 13 和 15。">
          <div className="col gap6">
            <div className="t-heading">Heading 22 / 800</div>
            <div className="t-heading-sm">Heading sm 20 / 800</div>
            <div className="t-heading-xs">Heading xs 18 / 800</div>
            <div className="t-title">Title 16 / 700</div>
            <div className="t-title-sm">Title sm 14 / 700</div>
            <div className="t-ui">UI 14 / 400 —— 界面正文默认</div>
            <div className="t-label">Label 12 / 500</div>
            <div className="t-detail">Detail 12 / 400 —— 元数据用间隔号 · 2 小时前编辑</div>
            <div className="t-detail-xs">Detail xs 11 / 400 —— UI 字号下限</div>
            <div className="t-section">Section 11 / 700 uppercase</div>
            <div className="t-mono t-detail">Mono 12 —— 00:03:26.4 / 1920×1080 / whisper-small</div>
          </div>
        </Sec>

        <Sec title="色阶" note="几乎所有东西都是灰。accent 蓝只标一屏里的那一个动作；其余色相留给状态、徽标与数据。">
          <div className="ramp">
            {GRAYS.map((g) => (
              <div className="sw-cell" key={g}>
                <div className="sw-chip" style={{background: 'var(--gray-' + g + ')'}} />
                <span>gray-{g}</span>
              </div>
            ))}
          </div>
          {Object.keys(HUES).map((h) => (
            <div className="ramp" key={h} style={{marginTop: 8}}>
              {HUES[h].map((s) => (
                <div className="sw-cell" key={s}>
                  <div className="sw-chip" style={{background: 'var(--' + h + '-' + s + ')'}} />
                  <span>{h}-{s}</span>
                </div>
              ))}
            </div>
          ))}
        </Sec>

        <Sec title="图标" note={'20×20 网格、1.5 视觉笔宽、活字区 2–18。共 ' + window.BC_ICON_NAMES.length
          + ' 枚：' + (window.BC_ICON_NAMES.length - window.BC_ICON_LINE.length)
          + ' 枚是 Spectrum 2 workflow 原件（填充），' + window.BC_ICON_LINE.length
          + ' 枚是 DS 里没有的语义、照通行编辑器的同名图标做形状参考重绘（描边，细节有意不同）。'}>
          <div className="grid-ic">
            {window.BC_ICON_NAMES.map((n) => (
              <div className="ic-cell" key={n}>
                <Ic n={n} />
                <span>{n}</span>
                <em>{window.BC_ICON_LINE.indexOf(n) >= 0 ? '重绘' : 'S2'}</em>
              </div>
            ))}
          </div>
        </Sec>

        <Dialog open={dlg} title="自定义画幅比" onClose={() => setDlg(false)} width={300}
          footer={[
            <Btn key="c" variant="secondary" onClick={() => setDlg(false)}>取消</Btn>,
            <Btn key="k" variant="accent" onClick={() => { setDlg(false); toast('画幅已改为 21:9'); }}>应用</Btn>,
          ]}>
          <div className="row gap8">
            <div style={{width: 88}}><Field size="s" defaultValue="21" /></div>
            <span className="t-detail">:</span>
            <div style={{width: 88}}><Field size="s" defaultValue="9" /></div>
          </div>
        </Dialog>

        <ConfirmDialog ask={ask} onCancel={() => setAsk(null)}
          onConfirm={() => { setAsk(null); toast('已删除', 'positive'); }} />

        <ToastHost toasts={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<window.RSP.Provider locale="zh-CN"><App /></window.RSP.Provider>);
})();
