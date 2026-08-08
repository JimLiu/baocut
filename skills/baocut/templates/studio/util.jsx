// BaoCut — shared UI primitives on top of Spectrum 2
const S2 = window.Spectrum2DesignSystem_464ef2;
const { useState, useEffect, useRef, useCallback, useMemo } = React;

// ---------- time ----------
// Unified timestamp format everywhere: mm:ss, or HH:mm:ss past the hour.
function fmt(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  const ms = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return h ? String(h).padStart(2, '0') + ':' + ms : ms;
}
function fmtT(t) { // with tenths
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = (t % 60);
  const ms = String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  return h ? String(h).padStart(2, '0') + ':' + ms : ms;
}
function fmtDur(t) { return fmt(t); }
function parseTc(str) {
  const m = /^(?:(\d+):)?(\d+):([0-5]?\d(?:\.\d)?)$/.exec(str.trim());
  if (!m) return null;
  return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

// ---------- icon ----------
function Ic({ name, size = 18, style }) {
  return <span className={'s2-icon s2-icon--' + name} style={{ width: size, height: size, ...style }}></span>;
}

// ---------- Esc stack (layered dismissal) ----------
const escStack = [];
function useEsc(handler, active = true) {
  const ref = useRef(handler); ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const entry = { fire: () => ref.current() };
    escStack.push(entry);
    return () => { const i = escStack.indexOf(entry); if (i >= 0) escStack.splice(i, 1); };
  }, [active]);
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && escStack.length) {
    e.preventDefault(); e.stopPropagation();
    escStack[escStack.length - 1].fire();
  }
}, true);

// ---------- quiet icon button (tooltip via data-tip) ----------
const qbtnIconSize = { XS: 13, S: 15, M: 18, L: 20, XL: 22 };
function QBtn({ icon, tip, onClick, disabled, selected, size = 'M', tipDir, className = '', refEl, badge }) {
  return (
    <button
      ref={refEl}
      className={'s2-action-btn s2-action-btn--' + size + ' s2-action-btn--quiet s2-action-btn--icon-only vk-qbtn ' + (selected ? 's2-action-btn--selected ' : '') + className}
      data-tip={tip} data-tip-dir={tipDir} aria-label={tip} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick && onClick(e); }}
    >
      <Ic name={icon} size={qbtnIconSize[size] || 18} />
      {badge ? <span className="vk-qbtn-badge"></span> : null}
    </button>
  );
}

// ---------- clipboard + copy button ----------
// Real async clipboard write so callers can tell success from failure.
// Resolves to a boolean and never rejects.
function writeClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text == null ? '' : String(text)).then(() => true, () => false);
    }
  } catch (_) {}
  return Promise.resolve(false);
}

// Copy button with self-contained feedback: on success the glyph flips to a
// green checkmark and reverts after COPY_FEEDBACK_MS; on failure it flips to a
// red alert and a negative toast carries the error. Renders a labeled pill
// (pass className + label) or, with `quiet`, a QBtn-style icon-only button.
// `text` may be a value or, for lazily-built payloads, a `getText` thunk.
const COPY_FEEDBACK_MS = 3500;
function CopyBtn({ text, getText, note, errNote = "Couldn't copy — check clipboard access", className = '', label = 'Copy', iconSize = 12, tip, tipDir, quiet, size = 'S', disabled }) {
  const [state, setState] = useState('idle'); // 'idle' | 'ok' | 'err'
  const timer = useRef(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const onClick = useCallback((e) => {
    e.stopPropagation();
    writeClipboard(getText ? getText() : text).then((ok) => {
      if (timer.current) clearTimeout(timer.current);
      setState(ok ? 'ok' : 'err');
      timer.current = setTimeout(() => setState('idle'), COPY_FEEDBACK_MS);
      if (ok) toast(note || 'Copied', { variant: 'positive' });
      else toast(errNote, { variant: 'negative' });
    });
  }, [text, getText, note, errNote]);
  const icon = state === 'ok' ? 'checkmark' : state === 'err' ? 'alert-triangle' : 'copy';
  const stateCls = state === 'ok' ? ' vk-copybtn--ok' : state === 'err' ? ' vk-copybtn--err' : '';
  if (quiet) {
    return (
      <button
        className={'s2-action-btn s2-action-btn--' + size + ' s2-action-btn--quiet s2-action-btn--icon-only vk-qbtn vk-copybtn' + stateCls + (className ? ' ' + className : '')}
        data-tip={tip} data-tip-dir={tipDir} aria-label={tip} disabled={disabled}
        onClick={onClick}>
        <Ic name={icon} size={qbtnIconSize[size] || 15} />
      </button>
    );
  }
  return (
    <button className={('vk-copybtn ' + className).trim() + stateCls} data-tip={tip} data-tip-dir={tipDir} disabled={disabled} onClick={onClick}>
      <Ic name={icon} size={iconSize} />{label}
    </button>
  );
}

// ---------- segmented control ----------
function Segmented({ options, value, onChange, size = 'M', stretch }) {
  return (
    <div className={'vk-segc' + (stretch ? ' vk-segc--stretch' : '') + (size === 'S' ? ' vk-segc--S' : '')} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} disabled={o.disabled}
          className={'vk-segc__btn' + (o.value === value ? ' vk-segc__btn--on' : '')}
          data-tip={o.tip} aria-label={o.tip || (typeof o.label === 'string' ? o.label : o.value)}
          onClick={() => onChange(o.value)}>
          {o.icon ? <Ic name={o.icon} size={16} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- popover / portal popover ----------
function useClickOutside(ref, onClose, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    // defer so the opening click doesn't close it
    const t = setTimeout(() => document.addEventListener('pointerdown', h, true), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', h, true); };
  }, [active]);
}

// Portal popover anchored to an element rect. dir: 'down' | 'up'
function Pop({ anchorRef, onClose, dir = 'down', align = 'start', width, children, className = '', offset = 6 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useClickOutside(ref, onClose);
  useEsc(onClose);
  useEffect(() => {
    const a = anchorRef.current; if (!a) return;
    const r = a.getBoundingClientRect();
    const w = width || 240;
    let left = align === 'end' ? r.right - w : align === 'center' ? r.left + r.width / 2 - w / 2 : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let d = dir;
    if (d === 'down' && r.bottom + 320 > window.innerHeight && r.top > 340) d = 'up';
    setPos({ left, top: d === 'down' ? r.bottom + offset : undefined, bottom: d === 'up' ? window.innerHeight - r.top + offset : undefined, width: w });
  }, []);
  if (!pos) return null;
  return ReactDOM.createPortal(
    <div ref={ref} className={'vk-pop ' + className} style={pos} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>, document.body);
}

// ---------- menu ----------
function Menu({ anchorRef, onClose, items, dir, align = 'end', width = 232, className = '' }) {
  return (
    <Pop anchorRef={anchorRef} onClose={onClose} dir={dir} align={align} width={width} className={'vk-menu ' + className}>
      {items.map((it, i) => it === '-' ? <div key={i} className="vk-menu__div"></div> : (
        <button key={i} className={'vk-menu__item' + (it.danger ? ' vk-menu__item--danger' : '') + (it.disabled ? ' vk-menu__item--disabled' : '')}
          disabled={it.disabled}
          onClick={() => { if (it.disabled) return; onClose(); it.onClick && it.onClick(); }}>
          {it.icon ? <Ic name={it.icon} size={16} /> : null}
          <span className="vk-menu__label">
            <span>{it.label}</span>
            {it.sub ? <span className="vk-menu__sub">{it.sub}</span> : null}
          </span>
          {it.suffix ? <span className={'vk-menu__suffix' + (it.suffixAccent ? ' vk-menu__suffix--accent' : '')}>{it.suffix}</span> : null}
        </button>
      ))}
    </Pop>
  );
}

// ---------- modal scaffold ----------
function Overlay({ onClose, children, center = true, dim = true }) {
  useEsc(onClose);
  return ReactDOM.createPortal(
    <div className={'vk-overlay' + (dim ? ' vk-overlay--dim' : '')} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {children}
    </div>, document.body);
}

// ---------- shared LLM model picker (provider → editable model + effort) ----------
// M84: the model control is an editable combobox — type an arbitrary model id
// (a new model works before the app catalog updates) or pick a known one — and a
// reasoning-effort control folds in below for reasoning-capable models.
function ModelCombo({ options, current, onPick }) {
  const [q, setQ] = useState('');
  const typed = q.trim();
  const filtered = typed ? options.filter((o) => o.toLowerCase().includes(typed.toLowerCase())) : options;
  const showUse = typed && !options.includes(typed);
  return (
    <div className="vk-combo">
      <input className="vk-input vk-mono vk-combo__field" autoFocus value={q}
        placeholder="Model id"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && typed) onPick(typed); }} />
      <div className="vk-combo__list">
        {showUse ? <button className="vk-combo__row vk-combo__row--use" onClick={() => onPick(typed)}>Use “{typed}”</button> : null}
        {filtered.map((o) => (
          <button key={o} className={'vk-combo__row vk-mono' + (o === current ? ' vk-combo__row--sel' : '')} onClick={() => onPick(o)}>
            <span className="vk-combo__id">{o}</span>{o === current ? <Ic name="checkmark" size={13} /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModelPicker({ value, onChange, kind = 'llm' }) {
  const app = window.useApp();
  // Keep an empty custom text-provider shell reachable: the native app uses
  // this as a recovery path when legacy split-persisted model metadata is lost.
  const provs = app.providers.filter((p) => p.models.some((m) => m.kind === kind)
    || (kind === 'llm' && !p.builtin && p.models.length === 0));
  const initProv = provs.find((p) => p.models.some((m) => m.name === value)) || provs.find((p) => p.connected) || provs[0];
  const [providerId, setProviderId] = useState(initProv ? initProv.id : null);
  const curProv = provs.find((p) => p.id === providerId) || initProv || provs[0];
  const models = curProv.models.filter((m) => m.kind === kind);
  const provRef = useRef(null), modelRef = useRef(null);
  const [open, setOpen] = useState(null); // null | 'prov' | 'model'
  const modelDef = models.find((m) => m.name === value);
  const reasoning = modelDef ? modelDef.reasoning !== false : true;   // typed/custom → true
  const effort = (app.modelEfforts && app.modelEfforts[value]) || 'Auto';
  const pickModel = (v) => {
    if (!models.some((m) => m.name === v)) app.addProviderModel(curProv.id, v);
    if (app.setAiModel) app.setAiModel(v);
    onChange(v);
    setOpen(null);
  };
  return (
    <div className="vk-mpicker-wrap">
      <div className="vk-mpicker">
        <button ref={provRef} className="vk-input vk-pickerbtn vk-mpicker__prov" aria-label="Provider" onClick={() => setOpen('prov')}>
          <span className="vk-row" style={{ gap: 7 }}>
            <span className="vk-provider-mark vk-provider-mark--xs" style={{ background: `oklch(0.55 0.12 ${curProv.hue})` }}>{curProv.letter}</span>
            {curProv.name}
          </span>
          <Ic name="chevron-down" size={13} />
        </button>
        <button ref={modelRef} className="vk-input vk-pickerbtn vk-mpicker__model" aria-label="Model" onClick={() => setOpen('model')}>
          {value}<Ic name="chevron-down" size={13} />
        </button>
        {open === 'prov' ? (
          <Menu anchorRef={provRef} onClose={() => setOpen(null)} align="start" width={230}
            items={provs.map((p) => ({
              label: p.name,
              suffix: !p.connected ? 'Set up in Settings' : (p.id === curProv.id ? '✓' : undefined),
              suffixAccent: !p.connected,
              onClick: () => {
                if (!p.connected) { app.setSettingsWin({ section: 'cloud' }); return; }
                setProviderId(p.id);
                const first = p.models.find((m) => m.kind === kind); if (first) { if (app.setAiModel) app.setAiModel(first.name); onChange(first.name); }
              },
            }))} />
        ) : null}
        {open === 'model' ? (
          <Pop anchorRef={modelRef} onClose={() => setOpen(null)} align="start" width={260} className="vk-combo-pop">
            <ModelCombo options={models.map((m) => m.name)} current={value} onPick={pickModel} />
          </Pop>
        ) : null}
      </div>
      {reasoning ? <EffortControl value={effort} onChange={(e) => app.setModelEffort && app.setModelEffort(value, e)} /> : null}
    </div>
  );
}

// ---------- shared reasoning-effort control (M84, AI Models) ----------
// Auto = the model's own default (no reasoning parameter sent); the other tiers
// map to each SDK's knob in the real backend (LLMChat). Shown only for models
// that support reasoning (CloudModel.reasoning !== false; typed/custom → true).
const EFFORT_LEVELS = [
  { value: 'Auto', desc: 'The model decides — no reasoning parameter sent.' },
  { value: 'Low', desc: 'Light reasoning — fastest.' },
  { value: 'Medium', desc: 'Balanced depth and speed.' },
  { value: 'High', desc: 'Deepest reasoning — slower, higher quality.' },
];
function EffortControl({ value, onChange }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const cur = EFFORT_LEVELS.find((l) => l.value === value) || EFFORT_LEVELS[0];
  return (
    <div className="vk-effort">
      <div className="vk-effort__row">
        <span className="vk-effort__lbl">Reasoning effort</span>
        <span className="vk-spacer"></span>
        <button ref={ref} className="vk-input vk-pickerbtn vk-effort__btn" onClick={() => setOpen(true)} aria-label="Reasoning effort">
          {cur.value}<Ic name="chevron-down" size={13} />
        </button>
        {open ? <Menu anchorRef={ref} onClose={() => setOpen(false)} align="start" width={150}
          items={EFFORT_LEVELS.map((l) => ({ label: l.value, suffix: l.value === cur.value ? '✓' : undefined, onClick: () => onChange(l.value) }))} /> : null}
      </div>
      <div className="vk-effort__desc">{cur.desc}</div>
    </div>
  );
}

// Floating sub-window with macOS traffic lights. onClose = traffic-light close.
// id lets callers target the window element (e.g. vkFlyToTasks ghost source).
function SubWindow({ title, width = 640, onClose, children, height, className = '', noPad, id }) {
  return (
    <div id={id} className={'vk-window ' + className} style={{ width, height }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="vk-window__titlebar">
        <div className="vk-lights">
          <button className="vk-light vk-light--close" aria-label="Close window" onClick={onClose}></button>
          <span className="vk-light vk-light--min"></span>
          <span className="vk-light vk-light--max"></span>
        </div>
        <div className="vk-window__title">{title}</div>
        <div style={{ width: 52 }}></div>
      </div>
      <div className={'vk-window__body' + (noPad ? ' vk-window__body--nopad' : '')}>{children}</div>
    </div>
  );
}

// ---------- confirm dialog ----------
function ConfirmDialog({ title, body, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel, confirmVariant = 'negative' }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onConfirm(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <Overlay onClose={onCancel}>
      <div className="vk-dialog vk-dialog--confirm">
        <div className="vk-dialog__title">{title}</div>
        <div className="vk-dialog__body">{body}</div>
        <div className="vk-dialog__footer">
          <button className="s2-btn s2-btn--M s2-btn--secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className={'s2-btn s2-btn--M s2-btn--' + confirmVariant} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </Overlay>
  );
}

// ---------- toasts ----------
let toastId = 0;
let pushToast = null;
function toast(msg, opts = {}) { pushToast && pushToast({ id: ++toastId, msg, variant: opts.variant || 'neutral', action: opts.action }); }
function ToastHost() {
  const [list, setList] = useState([]);
  useEffect(() => {
    pushToast = (t) => {
      setList((l) => [...l.slice(-2), t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 5000);
    };
    return () => { pushToast = null; };
  }, []);
  const close = (id) => setList((l) => l.filter((x) => x.id !== id));
  return (
    <div className="vk-toasts">
      {list.map((t) => (
        <div key={t.id} className={'vk-toast vk-toast--' + t.variant}>
          <Ic name={t.variant === 'positive' ? 'checkmark-circle' : t.variant === 'negative' ? 'alert-triangle' : 'info-circle'} size={16} />
          <span className="vk-toast__msg">{t.msg}</span>
          {t.action ? <button className="vk-toast__action" onClick={() => { close(t.id); t.action.onClick(); }}>{t.action.label}</button> : null}
          <button className="vk-toast__x" aria-label="Dismiss" onClick={() => close(t.id)}><Ic name="close" size={12} /></button>
        </div>
      ))}
    </div>
  );
}

// ---------- progress cluster (§3.7: fixed width, no layout shift) ----------
function ProgressCluster({ pct, onCancel, onPause, paused, compact }) {
  return (
    <span className={'vk-prog' + (compact ? ' vk-prog--compact' : '')}>
      <span className="vk-prog__pct">{Math.round(pct)}%</span>
      <span className="vk-prog__bar"><span className="vk-prog__fill" style={{ width: pct + '%' }}></span></span>
      {onPause ? (
        <button className="vk-prog__btn" data-tip={paused ? 'Resume' : 'Pause'} aria-label={paused ? 'Resume download' : 'Pause download'} onClick={(e) => { e.stopPropagation(); onPause(); }}>
          <Ic name={paused ? 'play' : 'clock'} size={12} />
        </button>) : null}
      {onCancel ? (
        <button className="vk-prog__btn" data-tip="Cancel" aria-label="Cancel" onClick={(e) => { e.stopPropagation(); onCancel(); }}>
          <Ic name="close" size={12} />
        </button>) : null}
    </span>
  );
}

// The percentage remains useful for scanning, while the row sub-line explains
// the quiet manifest/finalization phases and, when available, shows real bytes
// for large safetensors checkpoints.
function modelDownloadBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  const KiB = 1024, MiB = KiB * 1024, GiB = MiB * 1024;
  if (value >= GiB) return (value / GiB).toFixed(2) + ' GB';
  if (value >= MiB) return Math.round(value / MiB) + ' MB';
  if (value >= KiB) return Math.round(value / KiB) + ' KB';
  return Math.round(value) + ' B';
}
function modelDownloadSubtitle(dl) {
  if (dl.paused) return 'Download paused';
  if (dl.phase === 'preparing') return 'Preparing download…';
  if (dl.phase === 'finalizing') return 'Finalizing model…';
  const labels = { weights: 'model weights', aligner: 'forced aligner · shared', vad: 'VAD · shared' };
  const prefix = 'Downloading ' + (labels[dl.stage] || labels.weights);
  return dl.totalBytes > 0
    ? prefix + ' · ' + modelDownloadBytes(dl.completedBytes) + ' / ' + modelDownloadBytes(dl.totalBytes)
    : prefix + '…';
}

// ---------- AI stepper (Set up → Running → Review) ----------
function AiStepper({ stage, apply }) {
  // flows that apply their result directly (translate, speakers) have no
  // accept/reject step — the last stop reads "Apply", not "Review"
  const steps = [{ id: 'setup', label: 'Set up' }, { id: 'running', label: 'Running' }, { id: 'review', label: apply ? 'Apply' : 'Review' }];
  const idx = steps.findIndex((s) => s.id === stage);
  return (
    <div className="vk-stepper">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          {i > 0 ? <span className={'vk-stepper__line' + (i <= idx ? ' vk-stepper__line--done' : '')}></span> : null}
          <span className={'vk-stepper__step' + (i === idx ? ' vk-stepper__step--cur' : '') + (i < idx ? ' vk-stepper__step--done' : '')}>
            {i < idx ? <Ic name="checkmark" size={11} /> : (i === idx && s.id === 'running' ? <span className="vk-spin"></span> : <span className="vk-stepper__dot"></span>)}
            {s.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------- inline editable text (§3.1 row 1: single click) ----------
function EditableText({ value, onCommit, className = '', placeholder, disabled, as = 'span', stopPlayClick = true }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  if (editing) {
    return (
      <input ref={inputRef} className={'vk-editable__input ' + className} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); setEditing(false); if (draft.trim() && draft !== value) onCommit(draft.trim()); }
          if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); setDraft(value); }
        }}
        onBlur={() => { setEditing(false); if (draft.trim() && draft !== value) onCommit(draft.trim()); }}
      />
    );
  }
  const Tag = as;
  return (
    <Tag className={'vk-editable ' + className} data-tip="Click to edit" tabIndex={disabled ? -1 : 0} role="button"
      onClick={(e) => { if (disabled) return; if (stopPlayClick) e.stopPropagation(); setDraft(value); setEditing(true); }}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDraft(value); setEditing(true); } }}>
      {value || <span className="vk-dim">{placeholder}</span>}
    </Tag>
  );
}

// ---------- timecode chip + edit popover (§3.1 row 3) ----------
function TimecodeChip({ start, end, onApply, mono = true }) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(''); const [e2, setE2] = useState(''); const [err, setErr] = useState(null);
  const btnRef = useRef(null);
  const openIt = (ev) => { ev.stopPropagation(); setS(fmtT(start)); setE2(fmtT(end)); setErr(null); setOpen(true); };
  const apply = () => {
    const ps = parseTc(s), pe = parseTc(e2);
    if (ps == null || pe == null) { setErr('Use m:ss or m:ss.s format.'); return; }
    if (pe <= ps) { setErr('End must be after start.'); return; }
    setOpen(false); onApply(ps, pe);
  };
  return (
    <>
      <button ref={btnRef} className={'vk-tc' + (mono ? ' vk-mono' : '')} data-tip="Edit timecode" aria-label="Edit timecode" onClick={openIt}>
        {fmt(start)}<span className="vk-tc__sep">–</span>{fmt(end)}
      </button>
      {open ? (
        <Pop anchorRef={btnRef} onClose={() => setOpen(false)} width={232}>
          <div className="vk-pop__title">Edit timecode</div>
          <div className="vk-tc-edit">
            <label className="vk-field-sm"><span>Start</span>
              <input className="vk-input vk-mono" value={s} onChange={(ev) => setS(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && apply()} /></label>
            <label className="vk-field-sm"><span>End</span>
              <input className="vk-input vk-mono" value={e2} onChange={(ev) => setE2(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && apply()} /></label>
          </div>
          {err ? <div className="vk-tc-edit__err">{err}</div> : null}
          <div className="vk-pop__footer">
            <button className="s2-btn s2-btn--S s2-btn--secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="s2-btn s2-btn--S s2-btn--accent" onClick={apply}>Apply</button>
          </div>
        </Pop>
      ) : null}
    </>
  );
}

// ---------- misc ----------
function spHue(hue) { return `oklch(0.62 0.14 ${hue})`; }
function spHueBg(hue) { return `oklch(0.62 0.10 ${hue} / 0.14)`; }
function useDrag(onMove, onEnd) {
  return useCallback((downEvent) => {
    downEvent.preventDefault();
    const startX = downEvent.clientX, startY = downEvent.clientY;
    let moved = false;
    const mm = (e) => { moved = true; onMove(e.clientX - startX, e.clientY - startY, e); };
    const mu = (e) => {
      window.removeEventListener('pointermove', mm); window.removeEventListener('pointerup', mu);
      onEnd && onEnd(moved, e);
    };
    window.addEventListener('pointermove', mm); window.addEventListener('pointerup', mu);
  }, [onMove, onEnd]);
}

// fake download simulation hook helper
function simulate(setter, done, opts = {}) {
  const dur = opts.dur || 3000;
  const t0 = performance.now();
  let raf;
  const tick = (now) => {
    const p = Math.min(100, ((now - t0) / dur) * 100);
    setter(p);
    if (p < 100) raf = requestAnimationFrame(tick); else done && done();
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// ---------- word-level timestamps (PRD §8: whisper word_timestamps) ----------
// The sample doc stores segment-level times; derive per-word times the way the
// real pipeline would surface them — weighted by word length within the segment.
const _vkWT = new WeakMap();
function vkWordTimes(seg) {
  // cue / paragraph projections from VK_MODEL carry real word atoms
  if (seg.words && seg.words[0] && seg.words[0].t0 != null) {
    const hit2 = _vkWT.get(seg);
    if (hit2) return hit2.words;
    const words = seg.words.map((x) => ({ w: x.text, start: x.t0, end: x.t1 }));
    _vkWT.set(seg, { words });
    return words;
  }
  const hit = _vkWT.get(seg);
  if (hit && hit.text === seg.text && hit.start === seg.start && hit.end === seg.end) return hit.words;
  const toks = seg.text.split(/\s+/).filter(Boolean);
  const wts = toks.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}']/gu, '').length) + 1.4);
  const total = wts.reduce((a, b) => a + b, 0) || 1;
  const dur = Math.max(0.01, seg.end - seg.start);
  let acc = 0;
  const words = toks.map((w, i) => {
    const s = seg.start + dur * (acc / total);
    acc += wts[i];
    return { w, start: s, end: seg.start + dur * (acc / total) };
  });
  _vkWT.set(seg, { text: seg.text, start: seg.start, end: seg.end, words });
  return words;
}
// index of the word being spoken at time t (clamped)
function vkWordIdxAt(words, t) {
  if (!words.length) return 0;
  for (let i = 0; i < words.length; i++) if (t < words[i].end) return i;
  return words.length - 1;
}

// ---------- caret position inside a contentEditable editor (M76) ----------
// 编辑器内的文本节点按文档序拼成 raw 串；正/反向偏移换算都走 caret-offset.js，
// 保证「读出光标」与「放回光标」用同一把尺子。
function vkCaretNodes(el) {
  let raw = '';
  const nodes = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) { nodes.push(n); raw += n.textContent; }
  return { raw, nodes };
}

// Returns { text, offset, collapsed } in the editor's NORMALIZED text space
// (whitespace collapsed + trimmed — exactly what the editors commit), so the
// unified split/merge keys and the model's char-offset ops share one ruler.
// null when the selection is outside the editor.
function vkCaretOffset(el) {
  const s = window.getSelection();
  if (!el || !s || !s.rangeCount || !el.contains(s.anchorNode)) return null;
  const { raw, nodes } = vkCaretNodes(el);
  let rawOff = raw.length;
  if (s.anchorNode === el) {
    rawOff = 0;
    for (let i = 0; i < s.anchorOffset && i < el.childNodes.length; i++) rawOff += el.childNodes[i].textContent.length;
  } else {
    let acc = 0, found = false;
    for (const node of nodes) {
      if (node === s.anchorNode) { rawOff = acc + s.anchorOffset; found = true; break; }
      acc += node.textContent.length;
    }
    if (!found) rawOff = raw.length;
  }
  const got = window.BCS_CARET.toNormalized(raw, rawOff);
  return { text: got.text, offset: got.offset, collapsed: s.isCollapsed };
}

// 归一化偏移 → 编辑器内可折叠的 Range；元素为空或偏移越界时退化到内容末尾。
function vkCaretRangeAt(el, offset) {
  if (!el) return null;
  const { raw, nodes } = vkCaretNodes(el);
  const r = document.createRange();
  if (!nodes.length) { r.selectNodeContents(el); r.collapse(false); return r; }
  const rawOff = window.BCS_CARET.toRaw(raw, offset);
  let acc = 0;
  for (const node of nodes) {
    const len = node.textContent.length;
    if (rawOff <= acc + len) { r.setStart(node, rawOff - acc); r.collapse(true); return r; }
    acc += len;
  }
  const last = nodes[nodes.length - 1];
  r.setStart(last, last.textContent.length);
  r.collapse(true);
  return r;
}

// 视口坐标 → 编辑器内的 Range（标准 caretPositionFromPoint，WebKit 回退
// caretRangeFromPoint）。命中点落在编辑器之外、或浏览器不支持时返回 null。
function vkCaretRangeAtPoint(el, x, y) {
  if (!el || typeof x !== 'number' || typeof y !== 'number') return null;
  let r = null;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p && p.offsetNode) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); }
  } else if (document.caretRangeFromPoint) {
    r = document.caretRangeFromPoint(x, y);
  }
  if (!r || !el.contains(r.startContainer)) return null;
  r.collapse(true);
  return r;
}

// 把 Range 设为当前选区（收起成光标）。
function vkPlaceCaret(r) {
  if (!r) return;
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

Object.assign(window, { vkWordTimes, vkWordIdxAt, vkCaretOffset, vkCaretRangeAt, vkCaretRangeAtPoint, vkPlaceCaret });

Object.assign(window, {
  fmt, fmtT, fmtDur, parseTc, Ic, useEsc, QBtn, CopyBtn, Segmented, Pop, Menu, Overlay, SubWindow,
  ConfirmDialog, toast, ToastHost, ProgressCluster, AiStepper, EditableText, TimecodeChip,
  spHue, spHueBg, useDrag, useClickOutside, simulate,
  ModelPicker, EffortControl, EFFORT_LEVELS, modelDownloadSubtitle,
});
