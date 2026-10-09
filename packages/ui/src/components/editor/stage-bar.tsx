import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import type { AssetRecord, Id, Sequence } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  DialogTrigger,
  Form,
  Heading,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  NumberField,
  Popover,
  Text,
  ToastQueue,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import AspectRatio from '@react-spectrum/s2/icons/AspectRatio';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import FullScreen from '@react-spectrum/s2/icons/FullScreen';
import SpeedFast from '@react-spectrum/s2/icons/SpeedFast';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import VolumeOne from '@react-spectrum/s2/icons/VolumeOne';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useLocale } from 'react-aria/I18nProvider';
import { Slider, SliderThumb, SliderTrack } from 'react-aria-components/Slider';
import { TooltipContext, TooltipTriggerStateContext } from 'react-aria-components/Tooltip';
import { monitorGain, monitorLevel, toggleMute, type MonitorLevel } from '../../model/preview-volume.ts';
import {
  CANVAS_SIDE_MAX,
  ORIGINAL_RATIO,
  STAGE_RATIOS,
  customRatio,
  isPortrait,
  ratioText,
  safeBox,
  safeZones,
  sourceSize,
  stageRatioCanvas,
  stageRatioOf,
} from '../../model/stage-bar.ts';
import { useEditor } from '../../state/editor-store.ts';
import { PLAYBACK_RATES } from '../../state/player-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { P } from '../player/player-copy.ts';
import { S as SHELL } from '../shell-copy.ts';
import { useEditorActions } from './editor-context.tsx';
import { FULLSCREEN_PLAYER_COPY as F } from './fullscreen-player-copy.ts';
import { enterPreviewFullscreen } from './fullscreen-player.tsx';
import { STAGE_BAR_COPY as S } from './stage-bar-copy.ts';
import './editor.css';

/**
 * 舞台下沿的工具条（原型 stage.jsx 的 `StageBar`、ui.css 的 `.stagebar`）：42px 高、上边一道线，紧贴舞台、在走带之上。
 * 左边是带字的两件：画幅、倍速（图标加当前值）；右边是纯图标的三件：字幕显隐、音量、全屏。与原型不同（用户定的）：
 * 原型的倍速在右边、只有字，画幅只有字加箭头。
 *
 * - 画幅：换的是视频的画布（`updateSequence`，短边不变，一步撤销，与检查器的画幅同一种换法）；只读视频灰着。表下面是「自定义…」
 *   与竖幅才能开的「平台安全区」。安全区、倍速、字幕显隐都是这个窗口的观看态（editor-store），不进视频、不进撤销、不影响导出。
 * - 音量：只是监听音量（与 ↑/↓、M、全屏播放器同一份）。原型有配音时这枚钮变成音源 chip，这里不做（用户定的）：
 *   切音源在配音行头的 ⋯ 里。弹层里的杆不写数字，悬停或拖动时由提示说当前音量（也是用户定的）。
 * - 倍速与全屏播放器共用一份。
 * - 全屏钮要在这一下点击里向浏览器要全屏（只认瞬时的用户激活），不能挪进状态或副作用。
 */
export function StageBar({
  stageRef,
  sequence,
  assets,
}: {
  stageRef: RefObject<HTMLElement | null>;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
}) {
  return (
    <div className={bar} aria-label={S.bar} role="group">
      <RatioPicker sequence={sequence} assets={assets} />
      <RatePicker />
      <div className={spacer} />
      <div className={icons}>
        <CaptionsToggle />
        <VolumeControl />
        <Tip label={F.enterTip}>
          <ActionButton size="S" isQuiet aria-label={F.enter} onPress={() => enterPreviewFullscreen(stageRef.current)}>
            <FullScreen />
          </ActionButton>
        </Tip>
      </div>
    </div>
  );
}

/**
 * 竖幅画布上的平台安全区（原型 stage.jsx 的 `SafeAreaOverlay`）：三块斜纹遮挡区各带一枚标签，中间一道虚线框。
 * 盖在画面上、不接指针，只在舞台上画（全屏是干净的成片样子）。
 */
export function SafeAreaOverlay() {
  const pct = (r: { x: number; y: number; w: number; h: number }) => ({ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` });
  return (
    <div className="bc-safearea" aria-hidden>
      {safeZones().map((zone) => (
        <div key={zone.key} className={`bc-safearea-zone bc-safearea-zone--${zone.key}`} style={pct(zone)}>
          <span className="bc-safearea-tag">{S.safeZones[zone.key]}</span>
        </div>
      ))}
      <div className="bc-safearea-box" style={pct(safeBox())} />
    </div>
  );
}

const bar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  boxSizing: 'border-box',
  height: 42,
  flexShrink: 0,
  paddingX: 12,
  backgroundColor: 'gray-100',
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const spacer = style({ flexGrow: 1 });
// 纯图标的小号按钮框只比图标宽 4px，间距照 4 排会挤在一起；拉开到跟左边「文字到下一个图标」差不多。
const icons = style({ display: 'flex', alignItems: 'center', gap: 12 });
const chipText = style({ font: 'ui-sm', whiteSpace: 'nowrap' });
const volumeRow = style({ display: 'flex', alignItems: 'center', gap: 8, width: 240 });
// 滑杆照媒体播放器的音量杆画（media-player.tsx）：S2 的 Slider 总在杆上方摆一个读数，这里读数只在悬停提示里出现。
const volumeSlider = style({ flexGrow: 1, minWidth: 0, paddingEnd: 8 });
const volumeTrack = style({ position: 'relative', height: 20, width: 'full', cursor: 'default' });
const volumeRail = style({ position: 'absolute', insetX: 0, top: 8, height: 4, borderRadius: 'full', backgroundColor: 'gray-300' });
const volumeFill = style({ position: 'absolute', insetStart: 0, top: 8, height: 4, borderRadius: 'full', backgroundColor: 'accent' });
// react-aria 给拇指的是 translate(-50%, -50%)：顶边放在杆的竖向中线上，拇指才压在细轨正中。
const volumeThumb = style({
  top: '[50%]',
  size: 14,
  borderRadius: 'full',
  backgroundColor: 'white',
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: 'gray-800',
  boxShadow: 'elevated',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const customRow = style({ display: 'flex', alignItems: 'end', gap: 8 });
const customField = style({ width: 112 });
const colon = style({ font: 'ui', color: 'gray-700', paddingBottom: 8 });
const customNote = style({ font: 'ui-sm', color: { default: 'gray-700', isInvalid: 'negative' }, marginTop: 12, marginBottom: 0 });

// ---- 画幅 ----

function RatioPicker({ sequence, assets }: { sequence: Sequence; assets: Record<Id, AssetRecord> }) {
  const { apply } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const safeArea = useEditor((s) => s.safeArea);
  const setSafeArea = useEditor((s) => s.setSafeArea);
  const [custom, setCustom] = useState(false);
  const canvas = sequence.canvas;
  const original = useMemo(() => sourceSize(sequence, assets), [sequence, assets]);
  const current = stageRatioOf(canvas, original);
  const text = ratioText(canvas);
  const portrait = isPortrait(canvas);

  const change = (next: { width: number; height: number }, label: string) =>
    apply([{ type: 'updateSequence', sequenceId: sequence.id, canvas: next }], S.ratioChange(label));
  const run = (key: string) => {
    if (key === 'custom') return setCustom(true);
    if (key === 'safe') return setSafeArea(!safeArea);
    const next = stageRatioCanvas(canvas, key, original);
    if (!next || (next.width === canvas.width && next.height === canvas.height)) return;
    void change(next, key === ORIGINAL_RATIO ? S.original : key);
  };
  const ratioKeys = [ORIGINAL_RATIO, ...STAGE_RATIOS.map((r) => r.key)];
  const disabled = [...(editable ? [] : [...ratioKeys, 'custom']), ...(original ? [] : [ORIGINAL_RATIO]), ...(portrait ? [] : ['safe'])];
  const tip = editable ? S.ratio : S.ratioReadOnly;

  return (
    <>
      <MenuTrigger align="start" direction="top">
        <Tip label={tip}>
          <ActionButton size="S" isQuiet aria-label={`${S.ratio} ${text}`}>
            <AspectRatio />
            <Text UNSAFE_className="bc-tabular" styles={chipText}>
              {text}
            </Text>
          </ActionButton>
        </Tip>
        <Menu aria-label={S.ratio} disabledKeys={disabled} onAction={(key) => run(String(key))}>
          <MenuSection aria-label={S.ratio} selectionMode="single" selectedKeys={current ? [current] : []}>
            <MenuItem id={ORIGINAL_RATIO} textValue={S.original}>
              <Text slot="label">{S.original}</Text>
              <Text slot="description">{original ? S.originalHint(ratioText(original)) : S.originalNone}</Text>
            </MenuItem>
            {STAGE_RATIOS.map((r) => (
              <MenuItem key={r.key} id={r.key} textValue={r.key}>
                <Text slot="label" UNSAFE_className="bc-tabular">
                  {r.key}
                </Text>
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSection aria-label={S.custom}>
            <MenuItem id="custom" textValue={S.custom}>
              {S.custom}
            </MenuItem>
          </MenuSection>
          {/* 平台安全区：竖幅才可点；开关不进文档、不进撤销。 */}
          <MenuSection aria-label={S.safeArea} selectionMode="multiple" selectedKeys={portrait && safeArea ? ['safe'] : []}>
            <MenuItem id="safe" textValue={S.safeArea}>
              <Text slot="label">{S.safeArea}</Text>
              <Text slot="description">{portrait ? S.safeAreaHint : S.safeAreaPortraitOnly}</Text>
            </MenuItem>
          </MenuSection>
        </Menu>
      </MenuTrigger>
      {custom ? (
        <CustomRatioDialog
          canvas={canvas}
          onApply={async (next, label) => {
            if (!(await change(next, label))) return false;
            ToastQueue.neutral(S.ratioApplied(label), { timeout: 3000 });
            return true;
          }}
          onClose={() => setCustom(false)}
        />
      ) : null}
    </>
  );
}

/** 自定义画幅比（原型「自定义…」）：两个数，短边不变，换出来的尺寸先写在下面；长边超过引擎上限时不让应用。 */
function CustomRatioDialog({
  canvas,
  onApply,
  onClose,
}: {
  canvas: { width: number; height: number };
  onApply(next: { width: number; height: number }, label: string): Promise<boolean>;
  onClose(): void;
}) {
  // 状态放在对话框外层：S2 的 Dialog 会把 children 在几个 slot 里各渲染一遍。
  const [w, setW] = useState(21);
  const [h, setH] = useState(9);
  const [busy, setBusy] = useState(false);
  const result = customRatio(canvas, w, h);
  const label = result.ok ? ratioText(result.canvas) : '';
  const submit = async () => {
    if (!result.ok || busy) return;
    setBusy(true);
    try {
      if (await onApply(result.canvas, label)) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="S">
        {({ close }) => (
          <>
            <Heading slot="title">{S.customTitle}</Heading>
            <Content>
              <Form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}>
                <div className={customRow}>
                  <NumberField label={S.customWidth} value={w} onChange={setW} minValue={0} styles={customField} autoFocus />
                  <span className={colon}>:</span>
                  <NumberField label={S.customHeight} value={h} onChange={setH} minValue={0} styles={customField} />
                </div>
              </Form>
              <p className={customNote({ isInvalid: !result.ok })} role="status">
                {result.ok
                  ? S.customSize(result.canvas.width, result.canvas.height)
                  : result.reason === 'tooLong'
                    ? S.customTooLong(CANVAS_SIDE_MAX)
                    : S.customInvalid}
              </p>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>
                {SHELL.common.cancel}
              </Button>
              <Button variant="accent" isDisabled={!result.ok} isPending={busy} onPress={() => void submit()}>
                {S.apply}
              </Button>
            </ButtonGroup>
          </>
        )}
      </Dialog>
    </DialogContainer>
  );
}

// ---- 字幕显隐 ----

/** 舞台上隐藏 / 显示字幕：只是这个窗口看不看得见，不改字幕轨、不影响导出（导出里烧不烧字幕另在导出里选）。 */
function CaptionsToggle() {
  const hidden = useEditor((s) => s.captionsHidden);
  const setHidden = useEditor((s) => s.setCaptionsHidden);
  return (
    <Tip label={hidden ? S.showCaptions : S.hideCaptions}>
      <ToggleButton size="S" isQuiet aria-label={F.captions} isSelected={!hidden} onChange={(shown) => setHidden(!shown)}>
        <CloseCaptions />
      </ToggleButton>
    </Tip>
  );
}

// ---- 音量 ----

/** 读数写成「70%」：悬停提示显示它，读屏也念它。 */
const VOLUME_FORMAT: Intl.NumberFormatOptions = { style: 'unit', unit: 'percent' };

/** 监听音量（原型 stage.jsx 的音量弹层）：与 ↑/↓、M、全屏播放器同一份，只管这个窗口听多大声，不改视频的混音。 */
function VolumeControl() {
  const { engine } = useEditorActions();
  const [level, setLevelState] = useState<MonitorLevel>(() => monitorLevel(engine.monitor));
  useEffect(() => engine.onMonitor((gain) => setLevelState(monitorLevel(gain))), [engine]);
  const setLevel = (next: MonitorLevel) => engine.setMonitor(monitorGain(next));
  const VolumeIcon = level.muted || level.volume === 0 ? VolumeOff : level.volume <= 50 ? VolumeOne : VolumeTwo;

  return (
    <DialogTrigger>
      <Tip label={P.volume}>
        <ActionButton size="S" isQuiet aria-label={P.volume}>
          <VolumeIcon />
        </ActionButton>
      </Tip>
      <Popover placement="top end" aria-label={P.volume}>
        <div className={volumeRow}>
          <Tip label={level.muted ? P.unmuteTip : P.muteTip}>
            <ActionButton size="S" isQuiet aria-label={level.muted ? P.unmute : P.mute} onPress={() => setLevel(toggleMute(level))}>
              <VolumeIcon />
            </ActionButton>
          </Tip>
          <VolumeSlider value={level.muted ? 0 : level.volume} onChange={(volume) => setLevel({ volume, muted: false })} />
        </div>
      </Popover>
    </DialogTrigger>
  );
}

/**
 * 不显示数字的音量杆：鼠标停在杆上或拖着拇指时，拇指上方出提示写当前音量。
 * 提示锚在整条杆上，横向偏移到拇指的位置，拖动时跟着走。
 * 步长 5（原型这里是 25）：react-aria 会把受控值吸到步长上，↑/↓ 一档 10 调出来的 70% 在 25 一档的杆上会画成 75%。
 */
function VolumeSlider({ value, onChange }: { value: number; onChange: (volume: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { direction } = useLocale();
  return (
    <Slider
      aria-label={P.volume}
      className={volumeSlider}
      minValue={0}
      maxValue={100}
      step={5}
      value={value}
      formatOptions={VOLUME_FORMAT}
      onChange={onChange}>
      <SliderTrack ref={trackRef} className={volumeTrack}>
        {({ state, isHovered }) => {
          const percent = state.getThumbPercent(0);
          // 拇指中心离杆中心多远；从右往左排版时杆是反的。
          const shift = ((direction === 'rtl' ? 1 - percent : percent) - 0.5) * (trackRef.current?.clientWidth ?? 0);
          return (
            <>
              <div className={volumeRail} />
              <div className={volumeFill} style={{ width: `${percent * 100}%` }} />
              <SliderThumb className={volumeThumb} />
              <TrackTip anchorRef={trackRef} isOpen={isHovered || state.isThumbDragging(0)} crossOffset={shift}>
                {state.getThumbValueLabel(0)}
              </TrackTip>
            </>
          );
        }}
      </SliderTrack>
    </Slider>
  );
}

/**
 * 由调用方决定开合、锚在任意元素上的 S2 提示。TooltipTrigger 要一个能聚焦的触发器，滑杆里那个是拇指里藏起来的 input，
 * 鼠标碰不到；这里直接把开合状态与锚点交给 react-aria 的提示上下文。提示只是给眼睛看的，读屏从滑杆的 aria-valuetext 读数。
 */
function TrackTip({
  anchorRef,
  isOpen,
  crossOffset,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  isOpen: boolean;
  crossOffset: number;
  children: string;
}) {
  const state = useMemo(() => ({ isOpen, open: () => {}, close: () => {}, shouldSkipAnimation: false }), [isOpen]);
  return (
    <TooltipTriggerStateContext.Provider value={state}>
      <TooltipContext.Provider value={{ triggerRef: anchorRef, crossOffset }}>
        <Tooltip>{children}</Tooltip>
      </TooltipContext.Provider>
    </TooltipTriggerStateContext.Provider>
  );
}

// ---- 倍速 ----

/** 倍速（原型 `D.speeds`）：与全屏播放器共用一份，只是这个窗口看的快慢；preview.tsx 交给引擎。 */
function RatePicker() {
  const rate = useEditor((s) => s.rate);
  const setRate = useEditor((s) => s.setRate);
  return (
    <MenuTrigger align="start" direction="top">
      <Tip label={P.rate}>
        <ActionButton size="S" isQuiet aria-label={P.rateCurrent(rate)}>
          <SpeedFast />
          <Text UNSAFE_className="bc-tabular" styles={chipText}>{`${rate}×`}</Text>
        </ActionButton>
      </Tip>
      <Menu
        aria-label={P.rate}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[String(rate)]}
        onSelectionChange={(keys) => {
          const [next] = keys === 'all' ? [] : [...keys];
          if (next !== undefined) setRate(Number(next));
        }}>
        {PLAYBACK_RATES.map((r) => (
          <MenuItem key={r} id={String(r)} textValue={`${r}×`}>
            {r === 1 ? P.rateNormal : `${r}×`}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipTrigger placement="top">
      {children}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}
