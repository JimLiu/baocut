/* 导出弹层的「工程」页 —— §17.1，随可编辑工程导出 v2 拆出（设计稿
   docs/design/editor/bcut-editable-export-v2-design.md §3 / §8）。
   ============================================================================
   这一页此前只是 export.jsx 里一段静态目标列表 + 一句说明，点一行弹个 toast 就完事——
   Premiere 写成 `.prproj`（内核实际是 FCP7 `.xml`），说明「含停用的轨，标为隐藏」
   「素材按相对路径引用」都与内核相反（隐藏轨是跳过；素材按绝对路径引用或复制）。

   这一轮把事实改对，并把「每个元素三选一」（设计稿 §2）接进来：

     目标列表   保持「点一行就导出」的原型口径（与 App 的「选中后点底部按钮」不同，
                见分歧台账）；扩展名 / 是否目录 / 认哪些烘焙格式全下沉 `model-export.js`
                的 `PROJECT_TARGETS`，这里只读。
     算法元素   全局一档三选一（转成视频素材 / 连有损属性也转 / 不转直接放弃，对应
                内核 `--bake auto|lossy|none`）；「烘焙格式」只在鼠标停在的那一行
                认得不止一种格式时才出现（只有 Shotcut / Kdenlive），
                跟着那一行的 `bakeFormats` 走——其余五个目标只认
                ProRes 4444 的 `.mov`，没有可选项就不出这一行。
     回执       点一行触发的不再是转瞬即逝的 toast，而是与视频页「完成态」同一套
                `.xdone` / `.xsum` 控件：原生 / 烘焙 / 放弃三档计数，放弃 > 0 时
                逐条列出被放弃的元素名——用户要知道工程里少了什么，不是靠猜。

   三档计数是纯模型 `BC_EXPORT.deliverySummary`（决策表 §3 的前端近似，真值源在
   内核 `bcut-editable`），这里只画和接事件。 */
(function () {
  const {useState, useMemo} = React;
  const X = window.BC_EXPORT;

  function ExportProject({ctx, onClose}) {
    const [policy, setPolicy] = useState('auto');
    const [bakeFmtByTarget, setBakeFmtByTarget] = useState({});
    const [hoverId, setHoverId] = useState(null);
    const [result, setResult] = useState(null);   // {target, summary}

    /* 与 §12.6 的停用位同口径：合并 elDocs 的 hidden，deliverySummary 据此跳过
       停用的轨与元素（内核是「跳过」，不是「标为隐藏」）。 */
    const merged = useMemo(
      () => (ctx.elements || []).map((e) => Object.assign({}, e, ctx.elDocs && ctx.elDocs[e.id])),
      [ctx.elements, ctx.elDocs]
    );

    const hoverTarget = X.PROJECT_TARGETS.find((t) => t.id === hoverId);
    const showBakeFmt = hoverTarget && hoverTarget.bakeFormats.length > 1;
    const bakeFmt = hoverTarget ? (bakeFmtByTarget[hoverTarget.id] || hoverTarget.bakeFormats[0]) : null;

    const run = (t) => {
      const summary = X.deliverySummary(merged, policy);
      setResult({target: t, summary});
    };

    if (result) {
      const {target: t, summary} = result;
      return (
        <>
          <div className="xdone">
            <div className="ok"><Ic n="check" className="ic--22" /></div>
            <b>已导出 {t.name} 工程</b>
            <span>{X.targetMeta(t)}</span>
          </div>
          <div className="xsum">
            <div className="xsum__row"><span>原生</span><b>{summary.native} 个元素</b></div>
            <div className="xsum__row"><span>烘焙</span><b>{summary.baked} 个元素</b></div>
            <div className="xsum__row"><span>放弃</span><b>{summary.dropped} 个元素</b></div>
          </div>
          <div className="xnote">原生直接映射成 {t.name} 自己的轨与片段 · 烘焙先渲成带透明通道的视频素材再放回原轨</div>
          {summary.dropped ? <div className="xnote">未进工程 · {summary.droppedNames.join('、')}</div> : null}
          <div className="xacts">
            <Btn variant="quiet" onClick={() => setResult(null)}>再导一份</Btn>
            <Btn variant="accent" onClick={onClose}>完成</Btn>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="cpsec">导到剪辑软件</div>
        {X.PROJECT_TARGETS.map((t) => (
          <div key={t.id} className="xtgt" onMouseEnter={() => setHoverId(t.id)} onFocus={() => setHoverId(t.id)}
            onClick={() => run(t)}>
            <span className="nm">{t.name}</span>
            <span className="mt">{X.targetMeta(t)}</span>
          </div>
        ))}

        <div className="cpsec">算法元素</div>
        <Segmented size="s" value={policy} onChange={setPolicy}
          items={X.BAKE_POLICIES.map((p) => ({k: p.k, label: p.label}))} />
        <div className="xnote">形状 / 声波 / 进度 / 彩纸 / 手绘 / 模板贴纸 / 计时 / 白板等没有对等词汇的元素，
          按这里的选择处理；有对等词汇的视频 / 图片 / 音频 / 文字 / 字幕始终原生进工程。</div>
        {showBakeFmt ? (
          <div className="xquick">
            <div className="xquick__f">
              <span className="xquick__lb">烘焙格式</span>
              <Segmented size="s" value={bakeFmt}
                onChange={(k) => setBakeFmtByTarget((m) => Object.assign({}, m, {[hoverTarget.id]: k}))}
                items={hoverTarget.bakeFormats.map((k) => ({k, label: X.BAKE_FORMAT_LABEL[k] || k}))} />
            </div>
          </div>
        ) : null}

        <div className="xnote">工程带完整时间轴（停用的轨与元素跳过，不进工程）· 字幕作为独立字幕轨 ·
          素材以绝对路径引用或复制 · 形状 / 声波 / 进度 / 彩纸 / 手绘等算法元素会先渲成带透明通道的视频素材</div>
      </>
    );
  }

  Object.assign(window, {ExportProject});
})();
