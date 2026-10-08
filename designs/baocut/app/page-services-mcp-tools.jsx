/* MCP 服务 › 工具 —— §17.6（2026-09-17）。
   MCP 服务给 Agent 的就是一套工具：这一段把 tools/list 里会出现什么摆出来 ——
   每个工具的名字、描述、参数（类型 / 必填 / 说明）和去向（直接应答 / 调用前询问 / 不提供）。
   目录、schema、去向都在 model-mcp-tools.js；这里只组合。服务运行中也能逐个开关
   （客户端会收到 notifications/tools/list_changed）。 */
(function () {
  const {useState} = React;
  const T = window.BC_MCPTOOLS;

  const GATE_TONE = {auto: 'positive', ask: 'notice', hidden: 'mute', off: 'mute'};

  function ToolParams({tool}) {
    if (!tool.params.length) return <div className="t-detail mcpt__none">不需要参数</div>;
    return (
      <div className="mcpt__params" role="table" aria-label={tool.name + ' 的参数'}>
        {tool.params.map((p) => (
          <div className="mcpt__param" role="row" key={p.name}>
            <span role="cell" className="mcpt__pname"><code>{p.name}</code>{p.required ? <i>必填</i> : null}</span>
            <code role="cell" className="mcpt__ptype">{T.typeLabel(p)}</code>
            <span role="cell" className="t-detail">{p.desc}{p.dflt !== undefined ? ' 默认 ' + String(p.dflt) + '。' : ''}</span>
          </div>
        ))}
      </div>
    );
  }

  function ToolRow({tool, access, off, open, onOpen, onToggle, copy}) {
    const g = T.gate(tool, access, off);
    const a = T.annotations(tool);
    const enabled = g !== 'off';
    return (
      <div className={cx('mcpt', open && 'is-open', (g === 'off' || g === 'hidden') && 'is-dim')}>
        <div className="mcpt__head">
          <BCAction type="button" className="mcpt__main" aria-expanded={open} onClick={onOpen}>
            <Ic n={open ? 'chevdown' : 'chevright'} className="ic--14 mcpt__chev" />
            <span className="mcpt__id"><code>{tool.name}</code><span className="t-detail">{tool.title}</span></span>
          </BCAction>
          <Chip tone={GATE_TONE[g]}>{T.gateLabel(g, tool)}</Chip>
          <Switch on={enabled} onChange={() => onToggle(tool.name)} ariaLabel={'提供 ' + tool.name} />
        </div>
        {open ? (
          <div className="mcpt__body">
            <p className="t-detail mcpt__desc">{tool.desc}</p>
            <ToolParams tool={tool} />
            <div className="row gap8 mcpt__foot">
              <span className="t-detail-xs grow">
                {a.readOnlyHint ? 'readOnlyHint' : 'destructiveHint: ' + a.destructiveHint + ' · idempotentHint: ' + a.idempotentHint}
              </span>
              <Btn size="s" variant="quiet" icon="copy"
                onClick={() => copy(JSON.stringify(T.descriptor(tool), null, 2), tool.name + ' 的定义')}>复制定义</Btn>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function McpToolsSection({access, off, onToggle, live, copy}) {
    const [open, setOpen] = useState('');
    return (
      <>
        <div className="row gap8 svc__sec mcpt__sec">
          <span className="t-section grow">工具</span>
          <span className="t-detail-xs" role="status">{T.summary(access, off)}</span>
        </div>
        <Card layer className="svc__panel mcpt__card">
          <div className="t-detail">
            客户端连上后，Agent 在 <code>tools/list</code> 里看到的就是下面这些。每个工具的参数都有类型，Agent 不需要先读文档就能调用；<code>project</code> 取自 <code>list_projects</code>，只认「可访问的视频」里的那些。
          </div>
          {T.groups().map((g) => (
            <div key={g.k} className="mcpt__group">
              <div className="mcpt__ghead"><b>{g.label}</b><span className="t-detail-xs">{g.hint}</span></div>
              {g.tools.map((t) => (
                <ToolRow key={t.name} tool={t} access={access} off={off} copy={copy}
                  open={open === t.name} onOpen={() => setOpen(open === t.name ? '' : t.name)} onToggle={onToggle} />
              ))}
            </div>
          ))}
          <div className="row gap8 mcpt__all">
            <span className="t-detail-xs grow">{live ? '运行中开关工具会立即生效，客户端会收到工具列表变更通知。' : '写入、任务与生成类工具要把「允许的操作」设为「修改前询问」或「直接放行」才会提供。'}</span>
            <Btn size="s" variant="quiet" icon="copy"
              onClick={() => copy(JSON.stringify({tools: T.exposed(access, off).map(T.descriptor)}, null, 2), '工具列表')}>复制 tools/list</Btn>
          </div>
        </Card>
      </>
    );
  }

  Object.assign(window, {McpToolsSection});
})();
