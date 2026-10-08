/* API 提供方图标（product-design §7.6）：出现在 API 提供方列表与能力页的提供方分组（20px）、API 提供方详情页头（32px）。
   图标来自 lobe-icons（MIT，署名见仓库根的 THIRD_PARTY_NOTICES.md），放在 assets/vendors/<id>.svg；
   单色的用 mask + currentColor 跟主题着色，彩色的原样用 <img>，自建端点与没有图标的用首字母头像。
   编码 Agent 的图标（product-design §3.2.3）是 `AgentIcon`：同一批文件，按 BC_VENDORS.agentIcon 查，
   做成 S2 图标（createIcon）放进菜单行与按钮的图标槽，和 S2 自带图标一样定位、定尺寸。 */
(function () {
  const V = () => window.BC_VENDORS;
  function VendorIcon({id, name: label, size = 20, className}) {
    const v = V().byId(id);
    const icon = v && v.icon;
    const cls = cx('vicon', size >= 32 ? 'vicon--l' : 'vicon--s', className);
    if (!icon) {
      const name = label || (v && v.name) || String(id || '').replace(/^custom:/, '');
      return <span className={cx(cls, 'vicon--letter')} aria-hidden="true">{(name.trim()[0] || '?').toUpperCase()}</span>;
    }
    const src = `assets/vendors/${icon.file || id}.svg`;
    if (icon.mono) return <span className={cx(cls, 'vicon--mono')} aria-hidden="true" style={{WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")`}} />;
    return <img className={cls} src={src} alt="" aria-hidden="true" />;
  }

  /* 三种画法各一枚 S2 图标（20 网格，和 workflow 图标一样由 spectrum.css 按紧凑档显示 16px）：单色的 SVG 当遮罩、填 currentColor（停用的行跟着变淡），彩色的原样画，没有图标的画首字母。 */
  const R = React.createElement;
  const MonoGlyph = window.RSP.createIcon(({src, ...props}) => R('svg', {...props, viewBox: '0 0 20 20',
    style: {...props.style, WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")`}, className: cx(props.className, 'vglyph--mono')},
    R('rect', {width: 20, height: 20, fill: 'currentColor'})));
  const ColorGlyph = window.RSP.createIcon(({src, ...props}) => R('svg', {...props, viewBox: '0 0 20 20'},
    R('image', {href: src, width: 20, height: 20})));
  const LetterGlyph = window.RSP.createIcon(({letter, ...props}) => R('svg', {...props, viewBox: '0 0 20 20'},
    R('rect', {className: 'vglyph__box', x: 1, y: 1, width: 18, height: 18, rx: 4}),
    R('text', {className: 'vglyph__letter', x: 10, y: 14.2, textAnchor: 'middle', fontSize: 11, fontWeight: 700}, letter)));

  /** 编码 Agent（harness）的图标。`h` = {id, name, added?}；其余参数（UNSAFE_className、slot）交给 S2 图标。 */
  function AgentIcon({h, ...rest}) {
    const icon = V().agentIcon(h);
    if (!icon) {
      const name = String((h && (h.name || h.id)) || '').trim();
      return <LetterGlyph {...rest} letter={(name[0] || '?').toUpperCase()} />;
    }
    const src = `assets/vendors/${icon.file}.svg`;
    return icon.mono ? <MonoGlyph {...rest} src={src} /> : <ColorGlyph {...rest} src={src} />;
  }
  Object.assign(window, {VendorIcon, AgentIcon});
})();
