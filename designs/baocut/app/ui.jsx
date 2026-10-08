/* BaoCut — React Spectrum S2 adapters (product-design §2.6).
   Official controls own appearance and accessibility. This layer preserves screen
   callbacks and composes product-specific controls such as the prompt and pin grid.
   See ui-spectrum.jsx for DOM-ref, menu-collection and legacy event adapters. */
(function () {
  const {useState, useRef, useEffect, useCallback, useLayoutEffect} = React;
  const R = React.createElement;
  const S = window.RSP;
  const sizeOf = size => String(size || 'm').toUpperCase();
  const cx = (...a) => a.filter(Boolean).join(' ');

  /* Official AI controls own the prompt, tokens and toolbar (product-design §2.6).
     Keep PromptFieldValue between edits so selection and reference tokens survive.
     Image descriptions use the same token field; Enter adds a line without submitting. */
  /* Placeholders (template-spec §5.5): the draft string marks them as `{{label}}`; the field shows them as S2
     placeholder tokens (click selects, typing replaces, Tab / Shift+Tab move between tokens). Conversion lives in
     BC_PROMPT_SLOTS so parent strings round-trip exactly and never force a rebuild loop.
     `selectSlot`: bump it to focus the field and select the next placeholder after the caret (wrapping). */
  function PromptField({inputRef, inputProps = {}, toolbar, attachments, onSubmit, onStop,
    busy = false, canSubmit = true, hasAttachments = false, renderCompletions, selectSlot = 0, ...rest}) {
    const A = S.AI;
    const P = window.BC_PROMPT_SLOTS;
    const textValue = text => {
      const segs = P.toTokens(text);
      const last = segs[segs.length - 1];
      return new A.PromptFieldValue(segs).withCaretPosition(last ? {index: segs.length - 1, offset: last.text.length} : {index: 0, offset: 0});
    };
    const [state, setState] = useState(() => ({text: inputProps.value || '', value: textValue(inputProps.value || '')}));
    if (inputProps.value !== undefined && inputProps.value !== state.text) {
      setState({text: inputProps.value, value: textValue(inputProps.value)});
    }
    const nativeRef = useRef(null);
    useEffect(() => { if (inputProps.autoFocus) (inputRef || nativeRef).current?.focus(); }, []);
    useEffect(() => {
      if (!selectSlot) return undefined;
      (inputRef || nativeRef).current?.focus();
      /* The token field only syncs a programmatic selection to the DOM while focused: focus first, then select. */
      const id = setTimeout(() => setState(s => {
        const i = P.nextSlot(s.value.segments, s.value.caretPosition.index);
        if (i < 0) return s;
        const range = new A.PromptFieldValue.SelectedRange({index: i, offset: 0}, {index: i, offset: s.value.segments[i].text.length});
        return {...s, value: s.value.withSelectedRange(range)};
      }), 60);
      return () => clearTimeout(id);
    }, [selectSlot]);
    const change = value => {
      const text = P.fromTokens(value.segments);
      setState({text, value});
      inputProps.onChange?.({target: {value: text}});
    };
    const disabled = !!inputProps.disabled;
    const submit = () => { if (!disabled && !busy && canSubmit) onSubmit?.(); };
    const paste = e => { inputProps.onPaste?.(e); if (e.defaultPrevented) e.stopPropagation(); };
    return <div {...rest} className={cx('bc-ai-prompt', rest.className)} onPasteCapture={paste}>
      <A.PromptField ref={inputRef || nativeRef} value={state.value} onChange={change}
        onSubmit={submit} isGenerating={busy} onStop={onStop} size="S" variant="subtle" aiDisclaimer={<></>}>
        {attachments}
        <div inert={disabled || undefined} role="group" aria-label={inputProps['aria-label'] || '输入提示词'}>
          <A.PromptTokenField placeholder={inputProps.placeholder} onKeyDown={e => {
            inputProps.onKeyDown?.(e);
            if (!onSubmit && e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              change(state.value.replaceRange(state.value.selectedRange.start, state.value.selectedRange.end, '\n'));
            }
            if (!e.defaultPrevented && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !state.text.trim() && hasAttachments) {
              e.preventDefault(); submit();
            }
          }}
            completionTrigger={renderCompletions ? /(?<=^|\s)@|^\// : undefined}
            renderCompletions={renderCompletions} />
        </div>
        <A.PromptFieldToolbar><div className="bc-ai-toolbar">
          {toolbar}
          {onSubmit && (busy && onStop
            ? <A.PromptFieldSubmitButton />
            : disabled || !canSubmit || busy
              ? <S.Button variant="primary" size="S" isDisabled aria-label="发送"><Ic n="fwd" /></S.Button>
              : !state.text.trim() && hasAttachments
                ? <S.Button variant="primary" size="S" aria-label="发送附件" onPress={submit}><Ic n="fwd" /></S.Button>
                : <A.PromptFieldSubmitButton />)}
        </div></A.PromptFieldToolbar>
      </A.PromptField>
    </div>;
  }

  function ComposerAttachmentViewer({item, items, onClose}) {
    if (window.MediaAttachmentPreview) return <window.MediaAttachmentPreview item={item} items={items} onClose={onClose} />;
    const type = window.BC_ATTACHMENTS.kind(item);
    return <BCModal title={item.name} size="L" onClose={onClose}>
      <div className="bc-attachment-preview">
        <header><strong>{item.name}</strong><S.ActionButton aria-label="关闭附件预览" onPress={onClose}><S.Icons.Close /></S.ActionButton></header>
        {item.url && type === 'image' ? <img src={item.url} alt={item.name} /> : <p>没有可预览的文件内容，请重新选择文件。</p>}
      </div>
    </BCModal>;
  }
  function ComposerAttachments({items, onRemove}) {
    const A = S.AI;
    const [preview, setPreview] = useState(null);
    if (!items.length) return null;
    return <><div className="bc-ai-attachments"><A.AttachmentList aria-label="附上的文件"
      onRemove={keys => onRemove(Number([...keys][0]))}>
      {items.map((item, i) => <A.Attachment key={item.id || i} id={String(i)} textValue={item.name} size="S" isInvalid={item.isInvalid}>
        <BCAction slot={null} className="bc-ai-attachment-open" aria-label={`打开附件：${item.name}`} onClick={() => setPreview(item)}>
          {item.preview ? <span className="bc-ai-reference-preview">{item.preview}</span> : <A.AttachmentPreview src={window.BC_ATTACHMENTS.kind(item) === 'image' ? item.url : undefined} mimeType={window.BC_ATTACHMENTS.mime(item)} />}
          <S.Content><S.Text slot="title">{item.name}</S.Text></S.Content>
        </BCAction>
      </A.Attachment>)}
    </A.AttachmentList></div>{preview && <ComposerAttachmentViewer item={preview} items={items} onClose={() => setPreview(null)} />}</>;
  }

  function ComposerAttachment({name, preview, onRemove, className, title}) {
    return <div className={className} title={title || name}>
      <S.AI.AttachmentList aria-label="参考图" onRemove={onRemove}>
        <S.AI.Attachment id="reference" textValue={name} size="S">
          <span className="bc-ai-reference-preview">{preview}</span><S.Content><S.Text slot="title">{name}</S.Text></S.Content>
        </S.AI.Attachment>
      </S.AI.AttachmentList>
    </div>;
  }

  /* ---------- Button ---------- */

  function Btn({variant = 'secondary', size = 'm', icon, iconRight, children, className, disabled, style, ...rest}) {
    const quiet = variant === 'quiet';
    const Component = quiet ? S.ActionButton : S.Button;
    return <Component {...rest} size={sizeOf(size)} isDisabled={disabled}
      {...(quiet ? {isQuiet: true} : {variant: ['primary', 'accent', 'negative'].includes(variant) ? variant : 'secondary', fillStyle: variant === 'outline' ? 'outline' : 'fill'})}
      UNSAFE_className={cx('bc-button', className)} UNSAFE_style={style}>
      {icon && <Ic n={icon} className="ic--16" />}
      {(children != null || iconRight) && <S.Text><span className="bc-action-label">{children}{iconRight && <span className="bc-trailing-icon">{iconRight === 'chevright' ? <NavChevron /> : <Ic n={iconRight} className="ic--14" />}</span>}</span></S.Text>}
    </Component>;
  }

  function IconBtn({icon, size = 'm', on, onLayer, tip, className, children, disabled, style, ...rest}) {
    const Component = on === undefined ? S.ActionButton : S.ToggleButton;
    const button = <Component {...rest} size={sizeOf(size)} isQuiet isDisabled={disabled}
      isSelected={on} aria-label={tip || rest['aria-label'] || icon}
      UNSAFE_className={cx('bc-icon-button', className)} UNSAFE_style={style}>
      {children || <Ic n={icon} />}
    </Component>;
    return tip ? <Tip label={tip}>{button}</Tip> : button;
  }

  /* ---------- Tooltip（hover 才挂，不占布局） ---------- */

  function Tip({label, side = 'top', children}) {
    return label ? <S.TooltipTrigger delay={500}><>{children}</><S.Tooltip placement={side}>{label}</S.Tooltip></S.TooltipTrigger> : children;
  }

  /* ---------- Chip ---------- */

  function Chip({tone, pill, onClick, on, icon, children, className, ...rest}) {
    if (onClick) {
      const Component = on === undefined ? S.ActionButton : S.ToggleButton;
      return <Component {...rest} size="S" onClick={onClick} isSelected={on}
        UNSAFE_className={className}>{icon && <Ic n={icon} className="ic--14" />}<S.Text>{children}</S.Text></Component>;
    }
    const variant = {positive: 'positive', negative: 'negative', notice: 'notice', accent: 'informative', blue: 'informative'}[tone] || 'neutral';
    return <S.Badge {...rest} variant={variant} fillStyle="subtle" UNSAFE_className={className}>
      {icon && <Ic n={icon} className="ic--14" />}<S.Text>{children}</S.Text>
    </S.Badge>;
  }

  /* ---------- Popover: native top layer + window-space trigger anchor ---------- */
  const popStack = [];
  /* nonModal：悬停弹出的浮层用，不铺遮罩、不隐藏页面其余部分，指针移开即可关 */
  function Popover({open, onClose, label = '选项', align = 'left', dir = 'down', width, className, anchorRef, padding = 'default', nonModal = false, children}) {
    const marker = useRef(null);
    const trigger = useRef(null);
    useLayoutEffect(() => {
      trigger.current = anchorRef?.current || marker.current?.parentElement;
    });
    useEffect(() => {
      if (!open) return;
      const token = {};
      popStack.push(token);
      return () => { popStack.splice(popStack.indexOf(token), 1); };
    }, [open]);
    const placement = dir === 'right' ? 'right top' : `${dir === 'up' ? 'top' : 'bottom'} ${align === 'right' ? 'end' : 'start'}`;
    return <><span ref={marker} hidden />
      <S.Popover isOpen={!!open} onOpenChange={value => { if (!value) onClose?.(); }}
        triggerRef={trigger} placement={placement} hideArrow padding={padding} aria-label={label} isNonModal={nonModal || undefined}
        UNSAFE_className={cx('bc-popover', className)} UNSAFE_style={width ? {width} : undefined}>
        <div data-pop="" onClick={e => e.stopPropagation()}>{children}</div>
      </S.Popover>
    </>;
  }

  /* ---------- Menu ---------- */

  const {Menu, MenuItem, MenuRule, MenuHead} = window.BC_SPECTRUM;

  /* ---------- Picker（chip 形态的下拉入口） ---------- */

  /* `icon`：图标名，或一个 S2 图标槽元素（Agent 图标）；`tip`：只剩图标时的悬停提示。 */
  function Picker({label, value, size = 'm', open, wide, field, icon, tip, disabled, onClick, className, children, popWidth, popDir = 'down', popAlign = 'left', onClose}) {
    const nodes = window.BC_SPECTRUM.simpleChoices(children);
    if (nodes) return <window.BC_SPECTRUM.ChoicePicker nodes={nodes} {...{label, value, size, open, disabled, onClick, onClose, popWidth, icon, field, popDir, popAlign, tip}}
      className={cx(wide && 'bc-picker--wide', className)} />;
    return <div className={cx('bc-picker', wide && 'bc-picker--wide')}>
      <S.ActionButton size={sizeOf(size)} isDisabled={disabled} onClick={onClick}
        aria-label={label} aria-expanded={!!open} aria-haspopup="dialog"
        UNSAFE_className={className}>
        {icon && (React.isValidElement(icon) ? icon : <Ic n={icon} className="ic--16" />)}<S.Text><span className="bc-action-label">{value != null ? value : label}<span className="bc-trailing-icon"><S.Icons.ChevronDown /></span></span></S.Text>
      </S.ActionButton>
      {children != null && <Popover open={open} onClose={onClose} dir={popDir} align={popAlign} width={popWidth}>{children}</Popover>}
    </div>;
  }

  /* ---------- Field ---------- */

  /* Both inputRef and forwarded ref resolve to the actual input for selection and focus. */
  const Field = window.BC_SPECTRUM.Field;

  /* ---------- Segmented ---------- */

  /* 通用语言框：转录（`asrModel`）、翻译字幕、翻译配音共用这一只。配音给 `only`（这只 TTS
     会念的 code，换引擎就换表）、`marks`（每项副题，如「已有译文 / 先翻译」）、`heading`
     （全目录那组的组头）；最近使用与翻译字幕共享一份。 */
  function LanguageCombobox({value, onChange, asrModel, only, marks, heading, label, any}) {
    const L = window.BC_LANGUAGES, A = window.BC_ASR_LANG;
    const key = window.BC_SURFACE?.storageKey(asrModel ? 'bc-asr-recent' : 'bc-translation-recent') || 'bc-language-recent';
    const clean = asrModel ? A.recent : L.recent;
    const [recent, setRecent] = useState(() => { try { return clean(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return []; } });
    const groups = asrModel ? A.groups(asrModel, '', recent, value) : L.groups('', recent, only);
    const unique = [...new Map(groups.flatMap(g => g.items).map(l => [l.code, l])).values()];
    const items = any ? [{code: '__any', name: any}, ...unique] : unique;
    return <S.ComboBox aria-label={label || (asrModel ? '转录语言' : '目标语言')}
      placeholder="选择语言" selectedKey={value || (any ? '__any' : null)}
      onSelectionChange={code => {
        if (code == null) return;
        onChange(code === '__any' ? null : code);
        if (code !== '__any') { const next = clean([code, ...recent]); setRecent(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch {} }
      }}>
      {items.map(l => <S.ComboBoxItem key={l.code} id={l.code} textValue={`${l.name} ${l.native || ''} ${l.code}`}>
        <S.Text slot="label">{l.code === '__any' ? l.name : L.label(l)}</S.Text>
        {marks?.[l.code] && <S.Text slot="description">{marks[l.code]}</S.Text>}
      </S.ComboBoxItem>)}
    </S.ComboBox>;
  }

  function Segmented({items, value, onChange, size, className}) {
    const controlLabel = React.useContext(window.BCControlLabel);
    return <S.ToggleButtonGroup selectionMode="single" disallowEmptySelection
      selectedKeys={new Set([value])} onSelectionChange={keys => onChange?.([...keys][0])}
      size={sizeOf(size)} UNSAFE_className={className} aria-label={controlLabel || "选项"}>
      {items.map(it => {
        const k = typeof it === 'string' ? it : it.k;
        const label = typeof it === 'string' ? it : it.label;
        return <S.ToggleButton key={k} id={k} aria-label={it.tip || label || k}
          onMouseEnter={it.hover?.onMouseEnter} onMouseLeave={it.hover?.onMouseLeave}>
          {it.icon && <Ic n={it.icon} className="ic--16" />}{label && <S.Text>{label}</S.Text>}
        </S.ToggleButton>;
      })}
    </S.ToggleButtonGroup>;
  }

  /* ---------- Switch / Checkbox / Radio ---------- */

  function Switch({on, onChange, label, disabled, className, ariaLabel}) {
    const controlLabel = React.useContext(window.BCControlLabel);
    return <S.Switch isSelected={!!on} onChange={onChange} isDisabled={disabled}
      aria-label={ariaLabel || (typeof label === 'string' ? label : controlLabel || '启用选项')} UNSAFE_className={className}>{label}</S.Switch>;
  }

  function Checkbox({on, onChange, label, disabled, className, ...rest}) {
    return <S.Checkbox {...rest} isSelected={!!on} onChange={onChange} isDisabled={disabled}
      aria-label={rest['aria-label'] || (typeof label === 'string' ? label : '选择')} UNSAFE_className={className}>{label}</S.Checkbox>;
  }

  /* ---------- Slider（真的能写，不是展示件） ---------- */

  function Slider({value, min = 0, max = 100, step = 1, onChange, disabled, className, label, ...rest}) {
    const controlLabel = React.useContext(window.BCControlLabel);
    return <S.Slider size="S" {...rest} value={value} minValue={min} maxValue={max} step={step}
      onChange={onChange} isDisabled={disabled} aria-label={label || rest['aria-label'] || controlLabel || '调整数值'}
      UNSAFE_className={cx('bc-slider', className)} />;
  }

  /* ---------- Stepper ---------- */

  function Stepper({value, onDec, onInc, onValueClick, decTip, incTip, disabledDec, disabledInc}) {
    return R('div', {className: 'stp'},
      R(IconBtn, {icon: 'minus', size: 's', onClick: onDec, tip: decTip, disabled: disabledDec}),
      onValueClick
        ? R(S.ActionButton, {size: 'S', UNSAFE_className: 'stp__v', onClick: onValueClick, style: {background: 'none', border: 'none', cursor: 'pointer'}}, value)
        : R('span', {className: 'stp__v'}, value),
      R(IconBtn, {icon: 'plus', size: 's', onClick: onInc, tip: incTip, disabled: disabledInc}));
  }

  /* Native NumberField handles parsing, bounds and keyboard stepping. Empty values
     remove optional motion properties; required values restore their committed number. */
  function NumField({value, onChange, step, min, max, unit, label, tip, disabled, digits = 1, className, placeholder, onEmpty}) {
    const controlLabel = React.useContext(window.BCControlLabel);
    const [revision, setRevision] = useState(0);
    return <div className={cx('numf', className)} title={tip}>
      <S.NumberField key={revision} size="S" hideStepper prefix={label} aria-label={tip || controlLabel || label || '数值'}
        value={value == null ? NaN : value} minValue={min} maxValue={max} step={step ?? 10 ** -digits}
        formatOptions={{minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false}}
        isDisabled={disabled} placeholder={placeholder} UNSAFE_className="numf__i"
        onChange={(n) => { if (Number.isFinite(n)) onChange?.(n); else if (value != null) { if (onEmpty) onEmpty(); else setRevision(r => r + 1); } }} />
      {unit && <span className="numf__u">{unit}</span>}
    </div>;
  }

  /** Native disclosure owns keyboard interaction, expanded state and panel association. */
  function BCDisclosure({title, children, className, open, onOpenChange}) {
    return <S.Disclosure size="S" isQuiet isExpanded={open} onExpandedChange={onOpenChange} UNSAFE_className={className}>
      <S.DisclosureTitle>{title}</S.DisclosureTitle>
      <S.DisclosurePanel>{children}</S.DisclosurePanel>
    </S.Disclosure>;
  }
  window.BCDisclosure = BCDisclosure;

  /* ---------- PinGrid（九宫钉点） ----------
     3×3，行优先：顶 / 中 / 底 × 左 / 中 / 右。当前格实心，点只换参照系。点用 CSS 画，不占图标表。 */
  const PIN_XS = ['left', 'center', 'right'];
  const PIN_YS = ['top', 'middle', 'bottom'];
  const PIN_TIPS = {
    'left top': '左上角', 'center top': '顶边中点', 'right top': '右上角',
    'left middle': '左边中点', 'center middle': '正中', 'right middle': '右边中点',
    'left bottom': '左下角', 'center bottom': '底边中点', 'right bottom': '右下角',
  };
  function PinGrid({value, onChange, disabled, label = '钉点'}) {
    return R(S.ToggleButtonGroup, {UNSAFE_className: cx('pingrid', disabled && 'is-disabled'), 'aria-label': label,
      selectionMode: 'single', disallowEmptySelection: true, size: 'XS', isDisabled: disabled,
      selectedKeys: new Set(value ? [value.x + ' ' + value.y] : []),
      onSelectionChange: keys => { const [x, y] = [...keys][0].split(' '); onChange?.({x, y}); }},
      PIN_YS.flatMap((y) => PIN_XS.map((x) => {
        const on = !!value && value.x === x && value.y === y;
        return R(S.ToggleButton, {
          key: x + y, id: x + ' ' + y, type: 'button',
          UNSAFE_className: cx('pingrid__c', on && 'is-on'),
          title: PIN_TIPS[x + ' ' + y],
          'aria-label': PIN_TIPS[x + ' ' + y],
        }, R('span', {className: 'pingrid__d'}));
      })));
  }

  /* ---------- ProgressBar ---------- */

  function Progress({value, indeterminate, thin, className, label}) {
    return <S.ProgressBar value={value || 0} isIndeterminate={indeterminate} size={thin ? 'S' : 'M'}
      aria-label={label || '处理进度'} UNSAFE_className={className} />;
  }

  /* ---------- Steps ----------
     多步流程头部的步骤条（智能重构图、翻译配音共用）：每步一格、底边 2px 线；当前步蓝、做过的灰、
     还没到的浅。`items` 是 [{k, label}]，`cur` 是当前下标。 */

  function Steps({items, cur, className, label}) {
    return R('div', {className: cx('steps', className), 'aria-label': label || '处理步骤'},
      (items || []).map((st, i) => R('span', {key: st.k || i, className: i === cur ? 'is-on' : i < cur ? 'is-done' : ''}, `${i + 1} ${st.label}`)));
  }

  /* ---------- Card ---------- */

  function Card({onClick, on, layer, className, children, ...rest}) {
    return R(onClick ? window.BCAction : 'div', {
      type: onClick ? 'button' : undefined,
      className: cx('card', onClick && 'card--click', on && 'is-on', layer && 'card--layer', className),
      onClick,
      ...rest,
    }, children);
  }

  /* ---------- Dialog ---------- */

  function Dialog({open, title, children, footer, onClose, width}) {
    return <S.DialogContainer onDismiss={() => onClose?.()}>
      {open && <S.Dialog size={width > 880 ? 'XL' : width > 720 ? 'L' : width && width < 420 ? 'S' : 'M'} aria-label={title || '详情'}>
        {title && <S.Heading slot="title">{title}</S.Heading>}
        <S.Content>{children}</S.Content>
        {footer && <S.ButtonGroup>{footer}</S.ButtonGroup>}
      </S.Dialog>}
    </S.DialogContainer>;
  }

  /* 确认框：唯一执行器，动作是闭集（对齐 apps/baocut 的 ConfirmAction 无兜底臂） */
  function ConfirmDialog({ask, onCancel, onConfirm}) {
    if (!ask) return null;
    return R(Dialog, {
      open: true,
      title: ask.title,
      onClose: onCancel,
      footer: [
        R(Btn, {key: 'c', variant: 'secondary', onClick: onCancel}, ask.cancelLabel || '取消'),
        R(Btn, {key: 'k', variant: ask.tone === 'negative' ? 'negative' : 'accent', onClick: onConfirm}, ask.confirmLabel || '确定'),
      ],
    }, ask.body);
  }

  /* ---------- Toast ----------
     toast 只停几秒（2026-10-08 用户要求：「toast 只显示几秒即可，不用一直在那里」）。S2 不让带按钮的 toast 自动关，
     这里自己计时关掉；指针停在 toast 上或焦点在里面时顺延，免得正要点「撤销」时它消失。 */

  const TOAST_MS = 5000;
  const toastHeld = () => !!document.querySelector('[role="region"] [role="alertdialog"]:hover, [role="region"] [role="alertdialog"]:focus-within');

  function ToastHost({toasts, onDismiss}) {
    const active = useRef(new Map());
    useEffect(() => {
      const ids = new Set((toasts || []).map(t => t.id));
      for (const [id, close] of active.current) if (!ids.has(id)) { close(); active.current.delete(id); }
      for (const t of toasts || []) {
        if (active.current.has(t.id)) continue;
        const variant = ['positive', 'negative', 'info'].includes(t.tone) ? t.tone : 'neutral';
        let timer = null;
        const close = S.ToastQueue[variant](t.text, {
          timeout: TOAST_MS, actionLabel: t.action?.label, onAction: t.action?.run, shouldCloseOnAction: true,
          onClose: () => { clearTimeout(timer); onDismiss?.(t.id); }
        });
        if (t.action) {
          const arm = () => { timer = setTimeout(() => (toastHeld() ? arm() : close()), TOAST_MS); };
          arm();
        }
        active.current.set(t.id, () => { clearTimeout(timer); close(); });
      }
    }, [toasts, onDismiss]);
    useEffect(() => () => { for (const close of active.current.values()) close(); active.current.clear(); }, []);
    return <S.ToastContainer placement="bottom" />;
  }

  /* ---------- 「本轮未做」统一标记 ----------
     每一处未完成的面板都用这一个组件——后续每补一块就是删一个标记，进度可见。
     绝不各写各的占位文案。 */

  function Todo({title, children, inline}) {
    if (inline) return R('div', {className: 'todo todo--inline'}, R(Ic, {n: 'alert', className: 'ic--14'}), R('span', null, children || title));
    return R('div', {className: 'todo'},
      R(Ic, {n: 'alert'}),
      R('div', null,
        R('div', {className: 'todo__t'}, title || '本轮未做'),
        children ? R('div', {style: {marginTop: 2}}, children) : null));
  }

  function Empty({icon, title, children}) {
    return R('div', {className: 'empty'},
      icon ? R(Ic, {n: icon, className: 'ic--26', style: {opacity: 0.5}}) : null,
      title ? R('div', {className: 'empty__t'}, title) : null,
      children ? R('div', {className: 't-detail'}, children) : null);
  }

  const Rule = ({className}) => R(S.Divider, {size: 'S', UNSAFE_className: className});
  const VRule = ({className}) => R(S.Divider, {orientation: 'vertical', size: 'S', UNSAFE_className: className});

  /* 点击处的字符位置。用来把「单击进正文」的光标落在**点的那个字**上，
     而不是一律跳到开头或结尾——前者是编辑器，后者是表单控件。
     浏览器两套 API（WebKit 的 caretRangeFromPoint / Firefox 的 caretPositionFromPoint）
     给的都是「文本节点 + 节点内偏移」，这里再折算成整块文本里的偏移，
     这样调用方拿到的是一个可以直接喂给 textarea.setSelectionRange 的数。
     取不到时返回 null，由调用方决定退到行尾。 */
  function caretIndexFromPoint(el, x, y) {
    let node = null, off = 0;
    try {
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y);
        if (r) { node = r.startContainer; off = r.startOffset; }
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos) { node = pos.offsetNode; off = pos.offset; }
      }
    } catch (e) { return null; }
    if (!node || !el.contains(node)) return null;
    if (node.nodeType !== 3) return null;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n = 0, cur;
    while ((cur = walk.nextNode())) {
      if (cur === node) return n + off;
      n += cur.nodeValue.length;
    }
    return null;
  }

  /* 复制到剪贴板。async clipboard API 在没有用户激活、或页面不是安全上下文时
     会**同步抛**（不是 reject），所以先 try 再退回 execCommand；
     两条都不成时如实返回 false，让调用方报「复制失败」而不是假报成功。 */
  function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
      }
    } catch (e) { /* 落到 legacyCopy */ }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  // Read-only text blocks opt into whole-block double-click selection.
  function selectTextBlock(event) {
    const block = event.currentTarget;
    const selection = block.ownerDocument.getSelection();
    if (!selection) return;
    selection.selectAllChildren(block);
    event.preventDefault();
    event.stopPropagation();
  }

  Object.assign(window, {
    hasOpenPopover: () => popStack.length > 0,
    selectTextBlock,
    cx, copyToClipboard, caretIndexFromPoint, PromptField, ComposerAttachment, ComposerAttachments, ComposerAttachmentViewer, Btn, IconBtn, Tip, Chip, Popover, Menu, MenuItem, MenuRule, MenuHead,
    Picker, Field, LanguageCombobox, Segmented, Switch, Checkbox, Slider, Stepper, NumField, PinGrid,
    Progress, Steps, Card, Dialog, ConfirmDialog, ToastHost, Todo, Empty, Rule, VRule,
  });
})();
