/* React Spectrum S2 adapters shared by App, Web, and the component catalogue.
   The legacy screen API uses DOM events and input refs; translate them here.
   Product-specific canvases, timeline handles and media previews stay in their screen modules. */
(function () {
  const S = window.RSP;
  const ControlLabel = React.createContext(null);
  const {useRef, useCallback} = React;
  const sizeOf = value => String(value === 'xs' ? 's' : value || 'm').toUpperCase();
  const setRef = (ref, value) => { if (typeof ref === 'function') ref(value); else if (ref) ref.current = value; };

  const Field = React.forwardRef(function SpectrumField({size, icon, invalid, area, className,
    inputRef, inputClassName, disabled, readOnly, required, onChange, style, rows, ...props}, forwardedRef) {
    const controlLabel = React.useContext(ControlLabel);
    const handle = useRef(null);
    const ref = useCallback(value => {
      handle.current = value;
      const input = value?.getInputElement() || null;
      setRef(inputRef, input);
      setRef(forwardedRef, input);
      if (input && rows) input.rows = rows;
      if (input && inputClassName) input.classList.add(...inputClassName.split(/\s+/).filter(Boolean));
    }, [inputRef, forwardedRef, rows, inputClassName]);
    const Component = area ? S.TextArea : icon === 'search' ? S.SearchField : S.TextField;
    return <Component {...props} ref={ref} size={sizeOf(size)}
      aria-label={props['aria-label'] || props.placeholder || props.title || controlLabel || '输入内容'}
      isDisabled={disabled} isReadOnly={readOnly} isRequired={required} isInvalid={invalid || props['aria-invalid']}
      onChange={onChange ? () => {
        const input = handle.current?.getInputElement();
        onChange({target: input, currentTarget: input});
      } : undefined}
      prefix={icon && icon !== 'search' ? <Ic n={icon} className="ic--16" /> : undefined}
      UNSAFE_className={['bc-field', area && 'bc-field--area', className].filter(Boolean).join(' ')}
      UNSAFE_style={style} />;
  });

  // For screen actions with custom content (e.g. a media preview inside a button),
  // S2 owns pressing, keyboard focus and disabled behavior; the screen owns content layout.
  const Action = React.forwardRef(function SpectrumAction({className, style, disabled, children,
    selected, choiceKey, role, size = 'S', ...props}, ref) {
    const nodes = React.Children.toArray(children);
    const hint = nodes.find(node => node.props?.className === 'mtip');
    const tooltip = hint?.props.children;
    const selectedValue = selected ?? props['aria-pressed'];
    const Component = choiceKey !== undefined || selectedValue !== undefined ? S.ToggleButton : S.ActionButton;
    const resolveRef = useCallback(value => setRef(ref, value?.UNSAFE_getDOMNode() || null), [ref]);
    const button = <Component {...props} aria-label={props['aria-label'] || props.title || (typeof tooltip === 'string' ? tooltip : undefined)} role={role} id={choiceKey ?? props.id} ref={resolveRef} isDisabled={disabled} isSelected={choiceKey === undefined ? selectedValue : undefined}
      size={size.toUpperCase()} isQuiet UNSAFE_className={['bc-screen-action', className].filter(Boolean).join(' ')} UNSAFE_style={style}>{hint ? nodes.filter(node => node !== hint) : children}</Component>;
    return tooltip ? <S.TooltipTrigger delay={500}>{button}<S.Tooltip>{tooltip}</S.Tooltip></S.TooltipTrigger> : button;
  });

  function ChoiceGroup({value, onChange, className, children, disabled, ...props}) {
    return <S.ToggleButtonGroup {...props} selectionMode="single" disallowEmptySelection
      selectedKeys={new Set([value])} onSelectionChange={keys => onChange([...keys][0])}
      isDisabled={disabled} UNSAFE_className={className}>{children}</S.ToggleButtonGroup>;
  }

  function SliderInput({value, min = 0, max = 100, step = 1, onChange, disabled, className, ...props}) {
    return <S.Slider {...props} value={Number(value)} minValue={Number(min)} maxValue={Number(max)} step={Number(step)}
      isDisabled={disabled} aria-label={props['aria-label'] || '演示进度'} UNSAFE_className={className}
      onChange={value => onChange?.({target: {value: String(value)}})} />;
  }

  function Select({children, value, onChange, className, disabled, ...props}) {
    return <S.Picker {...props} selectedKey={String(value)} isDisabled={disabled} UNSAFE_className={className}
      onSelectionChange={key => onChange?.({target: {value: key}})}>
      {React.Children.map(children, option => option && <S.PickerItem id={String(option.props.value)} textValue={String(option.props.children)}>{option.props.children}</S.PickerItem>)}
    </S.Picker>;
  }

  function choiceItems(children) {
    return React.Children.toArray(children).flatMap(child =>
      child.type === React.Fragment || child.type === Menu ? choiceItems(child.props.children) : [child]);
  }
  /* `icon`：图标名（交给 Ic），或已经是 S2 图标槽里的元素（如 vendor-icon.jsx 的 Agent 图标）。 */
  const iconNode = icon => !icon ? null : React.isValidElement(icon) ? icon : <Ic n={icon} />;
  /* `tip`：按钮只剩图标时（输入区窄，product-design §3.2.3）悬停给出名字；无障碍标签照旧是 `label`。 */
  function ChoicePicker({nodes, value, label, size, open, onClick, onClose, disabled, className, popWidth, icon, field, popDir, popAlign, tip}) {
    const choices = nodes.filter(node => node.type === MenuItem);
    const selected = choices.findIndex(node => node.props.on || node.props.check || plainText(node.props.label) === value);
    // Quiet Picker intentionally ignores menuWidth in S2. Compact toolbar choices
    // use a native MenuTrigger so the menu has its own width and M-size rows.
    if (!field) return <S.MenuTrigger isOpen={open}
      onOpenChange={next => next ? onClick?.() : onClose?.()}
      direction={popDir === 'up' ? 'top' : 'bottom'} align={popAlign === 'right' ? 'end' : 'start'}>
      {withTip(tip, <S.ActionButton size={sizeOf(size)} isQuiet isDisabled={disabled}
        aria-label={label || plainText(value) || '选择选项'}
        UNSAFE_className={['bc-choice-picker', className].filter(Boolean).join(' ')}>
        {iconNode(icon)}<S.Text><span className="bc-action-label">{value ?? label}<span className="bc-trailing-icon"><S.Icons.ChevronDown /></span></span></S.Text>
      </S.ActionButton>)}
      <S.Menu aria-label={label || plainText(value) || '选择选项'} size="M" selectionMode="single"
        selectedKeys={new Set(selected < 0 ? [] : [String(selected)])}
        disabledKeys={choices.flatMap((node, i) => node.props.disabled ? [String(i)] : [])}
        UNSAFE_style={popWidth ? {width: popWidth, maxWidth: 'calc(100vw - 32px)'} : undefined}
        onAction={key => { choices[Number(key)]?.props.onClick?.(); onClose?.(); }}>
        {pickerSections(nodes, choices, true)}
      </S.Menu>
    </S.MenuTrigger>;
    return <S.Picker aria-label={label || plainText(value) || '选择选项'} size={sizeOf(size)}
      direction={popDir === 'up' ? 'top' : 'bottom'} align={popAlign === 'right' ? 'end' : 'start'}
      isQuiet={false} renderValue={() => <>{iconNode(icon)}<S.Text>{value ?? label}</S.Text></>}
      selectedKey={selected < 0 ? null : String(selected)} placeholder={value || label || '选择选项'}
      isOpen={open} onOpenChange={next => next ? onClick?.() : onClose?.()} isDisabled={disabled}
      menuWidth={popWidth} UNSAFE_className={['bc-choice-picker', className].filter(Boolean).join(' ')}
      disabledKeys={choices.flatMap((node, i) => node.props.disabled ? [String(i)] : [])}
      onSelectionChange={key => { choices[Number(key)]?.props.onClick?.(); onClose?.(); }}>
      {pickerSections(nodes, choices)}
    </S.Picker>;
  }
  function withTip(tip, button) {
    return tip ? <S.TooltipTrigger delay={500}>{button}<S.Tooltip>{tip}</S.Tooltip></S.TooltipTrigger> : button;
  }
  function pickerSections(nodes, choices, menu = false) {
    const Section = menu ? S.MenuSection : S.PickerSection;
    const Item = menu ? S.MenuItem : S.PickerItem;
    const sections = []; let heading = null; let items = [];
    const flush = () => {
      if (!items.length) return;
      sections.push(<Section key={sections.length} aria-label={heading ? undefined : '选项'}>
        {heading && <S.Header>{heading}</S.Header>}{items}
      </Section>);
      items = [];
    };
    for (const node of nodes) {
      if (node.type === MenuHead) { flush(); heading = node.props.children; }
      else if (node.type === MenuRule) { flush(); heading = null; }
      else {
        const i = choices.indexOf(node);
        items.push(<Item key={i} id={String(i)} textValue={plainText(node.props.label)}>
          {iconNode(node.props.icon)}<S.Text slot="label">{node.props.label}</S.Text>
          {(node.props.sub || node.props.suffix) && <S.Text slot="description">{node.props.sub}{node.props.sub && node.props.suffix ? ' · ' : null}{node.props.suffix}</S.Text>}
        </Item>);
      }
    }
    flush(); return sections;
  }
  function simpleChoices(children) {
    const nodes = choiceItems(children);
    return nodes.some(node => node.type === MenuItem) && nodes.every(node =>
      node.type === MenuHead || node.type === MenuRule || (node.type === MenuItem && !node.props.submenu && !node.props.children))
      ? nodes : null;
  }

  function Modal({children, onClose, title, labelledBy, size = 'M', className}) {
    return <S.DialogContainer onDismiss={onClose}>
      <S.CustomDialog size={size} isDismissible padding="none" aria-label={labelledBy ? undefined : title || '详情'}
        aria-labelledby={labelledBy} UNSAFE_className={className}>{children}</S.CustomDialog>
    </S.DialogContainer>;
  }

  // Collections need direct S2 items. Translate fragments, section headings and
  // submenus before passing children to the collection builder.
  const flatten = children => React.Children.toArray(children).flatMap(child =>
    child.type === React.Fragment || child.type === Menu ? flatten(child.props.children) : [child]);
  const plainText = node => typeof node === 'string' || typeof node === 'number' ? String(node)
    : React.isValidElement(node) ? plainText(node.props.children) : Array.isArray(node) ? node.map(plainText).join(' ') : '';
  function item(node, index) {
    const p = node.props;
    const content = <S.MenuItem id={String(index)} textValue={plainText(p.label)}
      isDisabled={p.disabled} isDestructive={p.tone === 'negative'} onAction={p.onClick}>
      {iconNode(p.icon)}
      <S.Text slot="label">{p.label}</S.Text>
      {p.sub && <S.Text slot="description">{p.sub}</S.Text>}
      {/* 图标槽已经给了行图标时，勾挪到名字右边（value 列），不和图标叠在一格 */}
      {(p.on || p.check) && (p.icon ? <S.Text slot="value"><span className="bc-menu-check"><S.Icons.Checkmark /></span></S.Text> : <S.Icons.Checkmark />)}
      {p.suffix && <S.Keyboard>{p.suffix}</S.Keyboard>}
    </S.MenuItem>;
    return p.submenu ? <S.SubmenuTrigger key={node.key || index}>{content}
      <Menu>{p.submenu.type === Menu ? p.submenu.props.children : p.submenu}</Menu>
    </S.SubmenuTrigger> : React.cloneElement(content, {key: node.key || index});
  }
  function Menu({children}) {
    const blocks = []; let itemIndex = 0; let collection = []; let section = []; let heading = null;
    const flushSection = () => {
      if (section.length) collection.push(heading
        ? <S.MenuSection key={collection.length}><S.Header>{heading}</S.Header>{section}</S.MenuSection>
        : <S.MenuSection key={collection.length}>{section}</S.MenuSection>);
      section = []; heading = null;
    };
    const flushMenu = () => {
      flushSection();
      if (collection.length) blocks.push(<S.Menu key={blocks.length} aria-label="操作">{collection}</S.Menu>);
      collection = [];
    };
    for (const node of flatten(children)) {
      if (node.type === MenuItem) section.push(item(node, itemIndex++));
      // S2 MenuSection supplies its own separator; an extra Divider doubles it.
      else if (node.type === MenuRule) flushSection();
      else if (node.type === MenuHead) { flushSection(); heading = node.props.children; }
      else { flushMenu(); blocks.push(<React.Fragment key={blocks.length}>{node}</React.Fragment>); }
    }
    flushMenu();
    return <>{blocks}</>;
  }
  function MenuItem(props) { return <Menu><MenuItem {...props} /></Menu>; }
  function MenuRule() { return <S.Divider size="S" />; }
  function MenuHead({children}) { return <S.Heading level={4} UNSAFE_className="bc-menu-heading">{children}</S.Heading>; }

  Object.assign(window, {BCControlLabel: ControlLabel, BC_SPECTRUM: {Field, Action, Select, ChoicePicker, simpleChoices, Menu, MenuItem, MenuRule, MenuHead},
    BCAction: Action, BCChoiceGroup: ChoiceGroup, BCSelect: Select, BCSliderInput: SliderInput, BCModal: Modal});
})();
