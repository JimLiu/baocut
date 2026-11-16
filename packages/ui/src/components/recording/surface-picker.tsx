import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import type { RecordingSources, RecordingWindow } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  ButtonGroup,
  Checkbox,
  Content,
  Dialog,
  DialogContainer,
  Header,
  Heading,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import Camera from '@react-spectrum/s2/icons/Camera';
import Close from '@react-spectrum/s2/icons/Close';
import Crop from '@react-spectrum/s2/icons/Crop';
import DeviceLaptop from '@react-spectrum/s2/icons/DeviceLaptop';
import FullScreen from '@react-spectrum/s2/icons/FullScreen';
import Layout from '@react-spectrum/s2/icons/Layout';
import Lock from '@react-spectrum/s2/icons/Lock';
import LockOpen from '@react-spectrum/s2/icons/LockOpen';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import Revert from '@react-spectrum/s2/icons/Revert';
import Settings from '@react-spectrum/s2/icons/Settings';
import {
  applyRatio,
  cardPlacement,
  drawRect,
  edgeHandles,
  fillScreen,
  fitWindow,
  MIN_AREA,
  moveRect,
  nudge,
  RATIOS,
  resizeRect,
  sizeText,
  tooSmall,
  windowAt,
  type Handle,
  type Point,
  type RatioId,
  type Rect,
} from '../../model/recording-area.ts';
import { choiceOptions, COUNTDOWNS, needsMicConfirm, type RecordingChoice } from '../../model/recording.ts';
import { useRecordingPrefs } from '../../state/recordings-store.ts';
import { RC } from './recording-copy.ts';
import { useMicLevel } from './recording-media.ts';
import { RS } from './recording-surface-copy.ts';
import { useSurface } from './recording-surface.tsx';
import { deviceItems, devicePatch, deviceView, type DeviceView } from './surface-parts.tsx';

/*
 * 选取覆盖层（屏幕录制设计 §11「选取覆盖层」）：每块屏幕一个透明的全屏小窗，坐标是这块屏幕的逻辑点。三种：
 * - 屏幕：压暗 60%，鼠标在这块屏幕上时换成强调色 40%；中央是屏幕名、尺寸与帧率、录制卡。
 * - 窗口：压暗 70%，鼠标下的窗口盖一块强调色 40%（`sources.windows[].bounds`，从前到后取第一个）；单击固定选中。问不出窗口位置时，
 *   中央给一个窗口列表。
 * - 区域：画、移动、八个把手、三分线与读数；顶部工具条（比例、重置、铺满、锁定）；不足 150 × 150 时不能开始；方向键微移，Enter 开始。
 * Esc 回到启动器（拖动中先取消拖动）。开始交给主进程，成功后覆盖层与启动器一起关。
 */

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

type PickWindow = Rect & { id: string; app: string; title: string };

/** 这块屏幕上的窗口（相对屏幕左上角的逻辑点），从前到后。 */
function windowsHere(sources: RecordingSources | null, displayId: string | null): PickWindow[] {
  return (sources?.windows ?? [])
    .filter((w): w is RecordingWindow & { bounds: NonNullable<RecordingWindow['bounds']> } => !!w.bounds && w.bounds.displayId === displayId)
    .map((w) => ({ id: w.id, app: w.app, title: w.title, x: w.bounds.x, y: w.bounds.y, width: w.bounds.width, height: w.bounds.height }));
}

export function SurfacePicker() {
  const s = useSurface();
  const session = s.state.session!;
  const choice = s.choice!;
  const display = s.init.display;
  const here = display?.workerDisplayId ?? null;
  const bounds: Rect = { x: 0, y: 0, width: display?.bounds.width ?? window.innerWidth, height: display?.bounds.height ?? window.innerHeight };
  const [ask, setAsk] = useState<RecordingChoice | null>(null);
  const confirmNoMic = useRecordingPrefs((p) => p.confirmNoMic);
  const dragging = useRef<(() => void) | null>(null);

  const go = async (next: RecordingChoice) => {
    setAsk(null);
    const fps = session.agent ? session.agent.options.fps : useRecordingPrefs.getState().fps;
    const result = await s.act({ type: 'start', options: { ...choiceOptions(next), fps } });
    if (result.ok) useRecordingPrefs.getState().setChoice(next);
  };
  const start = (patch: Partial<RecordingChoice>) => {
    const next = { ...choice, ...patch };
    if (needsMicConfirm(next.microphone, confirmNoMic)) setAsk(next);
    else void go(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || ask) return;
      if ((e.target as Element | null)?.closest?.('[role="menu"], [role="dialog"], input')) return;
      if (dragging.current) {
        dragging.current();
        dragging.current = null;
        return;
      }
      void s.act({ type: 'escape' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask, s]);

  const card = (ready: boolean, patch: Partial<RecordingChoice>, ref?: RefObject<HTMLDivElement | null>) => (
    <RecordingCard ready={ready && !session.starting} onStart={() => start(patch)} cardRef={ref} />
  );

  let body: ReactNode;
  if (session.picker === 'display') body = <DisplayMode here={here} card={card} />;
  else if (session.picker === 'window') body = <WindowMode here={here} bounds={bounds} card={card} />;
  else body = <AreaMode here={here} bounds={bounds} card={card} onStart={(area) => start({ area, source: 'area' })} dragging={dragging} />;

  return (
    <div className={`bc-rp bc-rp--${session.picker}`} role="dialog" aria-modal="true" aria-label={RS.picker}>
      {body}
      <DialogContainer onDismiss={() => setAsk(null)}>{ask ? <MicConfirm onBack={() => setAsk(null)} onGo={() => void go(ask)} /> : null}</DialogContainer>
    </div>
  );
}

type CardFn = (ready: boolean, patch: Partial<RecordingChoice>, ref?: RefObject<HTMLDivElement | null>) => ReactNode;

/** 屏幕模式：录这块屏幕。 */
function DisplayMode({ here, card }: { here: string | null; card: CardFn }) {
  const s = useSurface();
  const [over, setOver] = useState(false);
  const d = s.sources?.displays.find((x) => x.id === here) ?? null;
  const fps = s.state.session?.agent ? s.state.session.agent.options.fps : useRecordingPrefs.getState().fps;
  return (
    <div className="bc-rp-layer" onPointerEnter={() => setOver(true)} onPointerMove={() => !over && setOver(true)} onPointerLeave={() => setOver(false)}>
      <div className={`bc-rp-shade ${over ? 'bc-rp-shade--accent' : 'bc-rp-shade--60'}`} />
      <div className="bc-rp-center">
        <span className="bc-rp-hero-ic" data-bc-icons="own">
          <DeviceLaptop />
        </span>
        <div className="bc-rp-name">{d?.name ?? RS.targetDisplay}</div>
        {d ? <div className="bc-rp-meta">{RS.displayInfo(d.width, d.height, fps)}</div> : null}
        {card(!!d, { source: 'display', displayId: here })}
      </div>
    </div>
  );
}

/** 窗口模式：鼠标下的窗口高亮，单击固定选中；问不出窗口位置时给列表。 */
function WindowMode({ here, bounds, card }: { here: string | null; bounds: Rect; card: CardFn }) {
  const s = useSurface();
  const choice = s.choice!;
  const sources = s.sources;
  const wins = windowsHere(sources, here);
  const anyBounds = (sources?.windows ?? []).some((w) => !!w.bounds);
  const [hover, setHover] = useState<string | null>(null);
  const pinned = wins.find((w) => w.id === choice.windowId) ?? null;
  const active = pinned ?? wins.find((w) => w.id === hover) ?? null;
  const inside = (e: ReactPointerEvent | React.MouseEvent) => !!(e.target as Element).closest('.bc-rp-win__content');
  const at = (e: { clientX: number; clientY: number }) => windowAt(wins, { x: e.clientX, y: e.clientY });

  if (!anyBounds) {
    // 这台电脑问不出窗口的位置：在中央选一个窗口。
    const list = sources?.windows ?? [];
    return (
      <div className="bc-rp-layer">
        <div className="bc-rp-shade bc-rp-shade--70" />
        <div className="bc-rp-list" role="group" aria-label={RS.windowList}>
          <span className="bc-rl-list__title">{RS.windowList}</span>
          <div className="bc-rl-list__items" role="listbox" aria-label={RS.windowList}>
            {list.map((w) => (
              <button
                key={w.id}
                type="button"
                role="option"
                aria-selected={w.id === choice.windowId}
                className={`bc-rl-list__item${w.id === choice.windowId ? ' is-on' : ''}`}
                onClick={() => s.choose({ windowId: w.id })}>
                <span className="bc-rl-list__name">{RC.windowName(w.app, w.title)}</span>
              </button>
            ))}
          </div>
          {card(!!choice.windowId && list.some((w) => w.id === choice.windowId), { source: 'window' })}
        </div>
      </div>
    );
  }

  const adjust = () => {
    if (!active) return;
    s.choose({ source: 'area', area: { displayId: here, rect: fitWindow(active, bounds) }, areaLocked: false });
    void s.act({ type: 'pick', kind: 'area' });
  };
  return (
    <div
      className="bc-rp-layer"
      onPointerMove={(e) => {
        if (inside(e)) return;
        setHover(at(e)?.id ?? null);
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        if (inside(e)) return;
        const w = at(e);
        if (w) s.choose({ windowId: w.id });
      }}>
      <div className="bc-rp-shade bc-rp-shade--70" />
      {active ? (
        <div className={`bc-rp-win${pinned ? ' is-pinned' : ''}`} style={{ left: active.x, top: active.y, width: active.width, height: active.height }}>
          <div className="bc-rp-win__content">
            <span className="bc-rp-app-ic" data-bc-icons="own">
              <Layout />
            </span>
            <div className="bc-rp-name">{active.app}</div>
            <div className="bc-rp-meta">{sizeText(active)}</div>
            {card(true, { source: 'window', windowId: active.id })}
            <Button size="S" variant="secondary" onPress={adjust}>
              <Crop />
              <Text>{RS.adjustArea}</Text>
            </Button>
          </div>
        </div>
      ) : (
        <div className="bc-rp-center bc-rp-win__content">
          <div className="bc-rp-hint">{RS.windowHint}</div>
          {card(false, { source: 'window' })}
        </div>
      )}
    </div>
  );
}

/** 区域模式。选区在别的屏幕上时这块只压暗，在这里一画就换到这块。 */
function AreaMode({
  here,
  bounds,
  card,
  onStart,
  dragging,
}: {
  here: string | null;
  bounds: Rect;
  card: CardFn;
  onStart(area: RecordingChoice['area']): void;
  dragging: { current: (() => void) | null };
}) {
  const s = useSurface();
  const choice = s.choice!;
  const sources = s.sources;
  const saved = choice.area && (choice.area.displayId === here || (choice.area.displayId === null && isPrimary(sources, here))) ? choice.area.rect : null;
  const [live, setLive] = useState<{ rect: Rect | null; pt: Point; moved: boolean } | null>(null);
  const sel: Rect | null = live ? live.rect : saved;
  const locked = choice.areaLocked && !!sel;
  const ratio = choice.ratio;
  const wins = windowsHere(sources, here);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState({ width: 416, height: 140 });
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el && Math.abs(el.offsetHeight - cardSize.height) > 1) setCardSize({ width: 416, height: el.offsetHeight });
  });

  const commit = (rect: Rect | null) =>
    s.choose(rect ? { area: { displayId: here, rect: round(rect) }, source: 'area' } : { area: null, areaLocked: false });

  const begin = (e: ReactPointerEvent, kind: 'draw' | 'move' | 'resize', handle?: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (locked) return;
    const p0 = { x: e.clientX, y: e.clientY };
    const start = sel;
    let rect: Rect | null = start;
    let moved = false;
    let cancelled = false;
    const target = e.currentTarget as Element;
    target.setPointerCapture?.(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      if (cancelled) return;
      const dx = ev.clientX - p0.x;
      const dy = ev.clientY - p0.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      const pt = { x: ev.clientX, y: ev.clientY };
      if (kind === 'draw') rect = drawRect(p0, pt, ratio, bounds);
      else if (kind === 'move' && start) rect = moveRect(start, dx, dy, bounds);
      else if (start && handle) rect = resizeRect(start, handle, dx, dy, ratio, bounds);
      setLive({ rect, pt, moved: true });
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      dragging.current = null;
      setLive(null);
      if (cancelled) return;
      if (moved) return commit(rect);
      // 单击（没拖）：让区域贴合鼠标下的那个窗口。
      if (kind === 'draw') {
        const w = windowAt(wins, { x: ev.clientX, y: ev.clientY });
        if (w) commit(fitWindow(w, bounds));
      }
    };
    dragging.current = () => {
      cancelled = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      setLive(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.('input, [role="menu"], [role="dialog"]')) return;
      if (!sel) return;
      if (!locked && e.key.startsWith('Arrow')) {
        e.preventDefault();
        commit(nudge(sel, e.key, e.shiftKey, bounds));
      } else if (e.key === 'Enter' && !tooSmall(sel)) {
        e.preventDefault();
        onStart({ displayId: here, rect: round(sel) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const small = tooSmall(sel);
  const edges = sel ? edgeHandles(sel) : { n: false, s: false, e: false, w: false };
  const place = sel ? cardPlacement(sel, bounds, cardSize) : null;
  return (
    <div className={`bc-rp-layer bc-rp-area${locked ? ' is-locked' : ''}`} onPointerDown={(e) => begin(e, 'draw')}>
      {sel ? (
        <div className="bc-rp-sel" style={{ left: sel.x, top: sel.y, width: sel.width, height: sel.height }} onPointerDown={(e) => begin(e, 'move')}>
          {live?.moved ? (
            <>
              <i className="bc-rp-sel__third bc-rp-sel__third--v1" />
              <i className="bc-rp-sel__third bc-rp-sel__third--v2" />
              <i className="bc-rp-sel__third bc-rp-sel__third--h1" />
              <i className="bc-rp-sel__third bc-rp-sel__third--h2" />
            </>
          ) : null}
          {!locked
            ? HANDLES.filter((h) => h.length === 2 || edges[h as 'n' | 's' | 'e' | 'w']).map((h) => (
                <span
                  key={h}
                  className={`bc-rp-handle bc-rp-handle--${h} ${h.length === 2 ? 'bc-rp-handle--corner' : 'bc-rp-handle--edge'}`}
                  onPointerDown={(e) => begin(e, 'resize', h)}
                />
              ))
            : null}
          {small ? (
            <div className="bc-rp-small" role="alert">
              <b>{RS.tooSmall(MIN_AREA)}</b>
              <span>{RS.tooSmallSize(sizeText(sel))}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="bc-rp-shade bc-rp-shade--45" />
          <div className="bc-rp-center bc-rp-center--hint">
            <div className="bc-rp-hint-lg">{RS.areaHint}</div>
            <div className="bc-rp-hint">{RS.areaHintSub}</div>
          </div>
        </>
      )}
      {live?.moved && sel ? (
        <div className="bc-rp-readout" style={{ left: live.pt.x + 14, top: live.pt.y + 14 }}>
          {sizeText(sel)}
        </div>
      ) : null}
      <div className="bc-rp-tools" role="toolbar" aria-label={RS.areaTools} onPointerDown={(e) => e.stopPropagation()}>
        <span className="bc-rp-tools__size">{sel ? sizeText(sel) : RS.areaEmpty}</span>
        <SegmentedControl
          aria-label={RS.ratio}
          selectedKey={ratio}
          onSelectionChange={(k) => {
            const r = k as RatioId;
            const next = sel && !locked ? applyRatio(sel, r, bounds) : null;
            s.choose(next ? { ratio: r, area: { displayId: here, rect: round(next) } } : { ratio: r });
          }}>
          {RATIOS.map((r) => (
            <SegmentedControlItem key={r.id} id={r.id}>
              {r.id === 'free' ? RS.ratioFree : r.id}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={RS.reset} isDisabled={!sel || locked} onPress={() => commit(null)}>
            <Revert />
          </ActionButton>
          <Tooltip>{RS.reset}</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={RS.fill} isDisabled={locked} onPress={() => commit(applyRatio(fillScreen(bounds), ratio, bounds) ?? fillScreen(bounds))}>
            <FullScreen />
          </ActionButton>
          <Tooltip>{RS.fill}</Tooltip>
        </TooltipTrigger>
        <TooltipTrigger>
          <ToggleButton isQuiet size="S" aria-label={RS.lock} isSelected={locked} isDisabled={!sel} onChange={(areaLocked) => s.choose({ areaLocked })}>
            {locked ? <Lock /> : <LockOpen />}
          </ToggleButton>
          <Tooltip>{locked ? RS.lockOn : RS.lockOff}</Tooltip>
        </TooltipTrigger>
      </div>
      {place && sel ? (
        <div className="bc-rp-card-at" style={{ left: place.x, top: place.y }} onPointerDown={(e) => e.stopPropagation()}>
          {card(!small, { source: 'area', area: { displayId: here, rect: round(sel) } }, cardRef)}
        </div>
      ) : null}
    </div>
  );
}

function isPrimary(sources: RecordingSources | null, id: string | null): boolean {
  return !!sources?.displays.find((d) => d.id === id)?.primary;
}

function round(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

/**
 * 录制卡（§11「录制卡」）：宽 416，两块叠放的半透明卡。第一块是关闭（回到启动器）、开始（两行：「开始录制」与落点）与倒计时齿轮；
 * 第二块是摄像头与麦克风两个小控件。没选定目标时开始不可点。
 */
function RecordingCard({ ready, onStart, cardRef }: { ready: boolean; onStart(): void; cardRef?: RefObject<HTMLDivElement | null> }) {
  const s = useSurface();
  const session = s.state.session!;
  const choice = s.choice!;
  return (
    <div className="bc-rc" ref={cardRef} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="bc-rc__block bc-rc__main">
        <TooltipTrigger placement="bottom">
          <ActionButton UNSAFE_className="bc-rc__circle" aria-label={RS.cancel} onPress={() => void s.act({ type: 'escape' })}>
            <Close />
          </ActionButton>
          <Tooltip>{RS.cancelTip}</Tooltip>
        </TooltipTrigger>
        <button type="button" className="bc-rc__start" disabled={!ready} onClick={onStart}>
          <span className="bc-rc__dot" aria-hidden="true" />
          <span className="bc-rc__lines">
            <b>{RS.start}</b>
            <small>{session.landing.text}</small>
          </span>
        </button>
        <MenuTrigger>
          <ActionButton UNSAFE_className="bc-rc__circle" aria-label={RS.countdown}>
            <Settings />
          </ActionButton>
          <Menu
            aria-label={RS.recordingOptions}
            selectionMode="single"
            selectedKeys={[String(choice.countdown)]}
            onSelectionChange={(keys) => {
              const k = keys === 'all' ? null : [...keys][0];
              if (k == null) return;
              const n = Number(k);
              s.choose({ countdown: n });
              useRecordingPrefs.getState().setCountdown(n);
            }}>
            <MenuSection>
              <Header>
                <Heading>{RS.countdown}</Heading>
              </Header>
              {COUNTDOWNS.map((n) => (
                <MenuItem key={n} id={String(n)} textValue={n ? RS.countdownSeconds(n) : RS.countdownOff}>
                  {n ? RS.countdownSeconds(n) : RS.countdownOff}
                </MenuItem>
              ))}
            </MenuSection>
          </Menu>
        </MenuTrigger>
      </div>
      <div className="bc-rc__block bc-rc__devs">
        <DeviceMini kind="camera" />
        <DeviceMini kind="microphone" />
      </div>
      {session.error ? <div className="bc-rl-err">{RC.startFailed(session.error)}</div> : null}
    </div>
  );
}

/** 录制卡第二块的小控件：点开是设备菜单（第一项「不用」）；药丸是「允许」时点它打开系统设置。 */
function DeviceMini({ kind }: { kind: 'camera' | 'microphone' }) {
  const s = useSurface();
  const session = s.state.session!;
  const view: DeviceView = deviceView(kind, s.choice!, s.sources, session.notices);
  const level = useMicLevel(kind === 'microphone' && view.pill.state === 'on' ? view.name : null, s.sources);
  const label = kind === 'camera' ? RS.camera : RS.microphone;
  const inner = (
    <>
      {kind === 'microphone' && view.pill.state === 'on' ? (
        <span className="bc-rc-dev__lvl" style={{ width: `${Math.round(level * 100)}%` }} aria-hidden="true" />
      ) : null}
      <span className="bc-rc-dev__ic">{kind === 'camera' ? <Camera /> : <Microphone />}</span>
      <span className="bc-rc-dev__name">{view.label}</span>
      <span className={`bc-rec-pill bc-rec-pill--${view.pill.state}`}>{view.pillText}</span>
    </>
  );
  if (view.pill.action === 'open-settings') {
    return (
      <button type="button" className="bc-rc-dev" aria-label={RS.pillLabel(label, view.pillText)} onClick={() => void s.act({ type: 'permission', permission: kind })}>
        {inner}
      </button>
    );
  }
  const items = deviceItems(kind, s.sources);
  const value = (kind === 'camera' ? s.choice!.camera : s.choice!.microphone) ?? 'none';
  return (
    <MenuTrigger>
      <ActionButton UNSAFE_className="bc-rc-dev" aria-label={`${label}: ${view.label}`}>
        {inner}
      </ActionButton>
      <Menu
        aria-label={label}
        selectionMode="single"
        selectedKeys={[value]}
        onSelectionChange={(keys) => {
          const k = keys === 'all' ? null : [...keys][0];
          if (k != null) s.choose(devicePatch(kind, String(k), s.sources));
        }}>
        {items.map((d) => (
          <MenuItem key={d.id} id={d.id} textValue={d.label}>
            {d.label}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

/** 没有选择麦克风时的确认：返回 / 不用麦克风继续，带「不再提示」（关掉设置里的「没有麦克风时先确认」）。 */
function MicConfirm({ onBack, onGo }: { onBack(): void; onGo(): void }) {
  const [never, setNever] = useState(false);
  return (
    <Dialog size="S">
      <Heading slot="title">{RS.noMicTitle}</Heading>
      <Content>
        <p className="bc-rc-ask__p">{RS.noMicBody}</p>
        <Checkbox isSelected={never} onChange={setNever}>
          {RS.noMicNever}
        </Checkbox>
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={onBack}>
          {RS.back}
        </Button>
        <Button
          variant="accent"
          onPress={() => {
            if (never) useRecordingPrefs.getState().setConfirmNoMic(false);
            onGo();
          }}>
          {RS.noMicGo}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
