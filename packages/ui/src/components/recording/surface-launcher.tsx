import { useState, type ReactNode } from 'react';
import { ActionButton, Button, ProgressCircle, SearchField, SegmentedControl, SegmentedControlItem, Switch, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Camera from '@react-spectrum/s2/icons/Camera';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import Close from '@react-spectrum/s2/icons/Close';
import Crop from '@react-spectrum/s2/icons/Crop';
import DeviceLaptop from '@react-spectrum/s2/icons/DeviceLaptop';
import Folder from '@react-spectrum/s2/icons/Folder';
import Layout from '@react-spectrum/s2/icons/Layout';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import Settings from '@react-spectrum/s2/icons/Settings';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import type { RecordingCursorMode, RecordingKeysMode } from '@baocut/protocol';
import type { RecordingPickerKind } from '../../host.ts';
import { filterList, lowDisk, permissionBlocked, showsIncludeSelf, sourceBlocks, unavailableCode, type RecordingChoice } from '../../model/recording.ts';
import { formatBytes } from '../../model/space.ts';
import { useRecordingPrefs } from '../../state/recordings-store.ts';
import { RC } from './recording-copy.ts';
import { unsupportedText } from './recording-host.tsx';
import { useMicLevel } from './recording-media.ts';
import { RS } from './recording-surface-copy.ts';
import { useSurface } from './recording-surface.tsx';
import { deviceItems, devicePatch, deviceView, noticeText, type DeviceView } from './surface-parts.tsx';

/*
 * 录制启动器（屏幕录制设计 §11「启动器」）：330 × 400 的置顶小窗。自上而下是头部（关闭、设置）、落点、录制对象（屏幕、窗口、区域，
 * 前两格带下拉）、摄像头与麦克风（右侧药丸）、更多选项、底部提示。没有开始按钮：点一格打开那种选取覆盖层，开始在覆盖层的录制卡上。
 * 下拉与设备行点开是窗口里原地滑出的可搜索列表。
 */

type ListKind = 'display' | 'window' | 'camera' | 'microphone';

const TARGETS: Array<{ kind: RecordingPickerKind; icon: ReactNode; list?: 'display' | 'window' }> = [
  { kind: 'display', icon: <DeviceLaptop />, list: 'display' },
  { kind: 'window', icon: <Layout />, list: 'window' },
  { kind: 'area', icon: <Crop /> },
];

export function SurfaceLauncher() {
  const s = useSurface();
  const session = s.state.session!;
  const [list, setList] = useState<ListKind | null>(null);
  const choice = s.choice;
  const sources = s.sources;

  let body: ReactNode;
  if (s.state.sources.status === 'error') {
    body = (
      <div className="bc-rl-main">
        <div className="bc-rl-err" role="alert">
          {RC.loadFailed(s.state.sources.message ?? '')}
        </div>
        <Button size="S" variant="secondary" onPress={() => void s.act({ type: 'refresh' })}>
          {RC.retry}
        </Button>
      </div>
    );
  } else if (!choice || !sources) {
    body = (
      <div className="bc-rl-main" aria-busy="true">
        <ProgressCircle size="S" isIndeterminate aria-label={RC.loading} />
      </div>
    );
  } else if (list) {
    body = <LauncherList kind={list} choice={choice} onBack={() => setList(null)} />;
  } else {
    body = <LauncherMain choice={choice} onList={setList} />;
  }

  return (
    <div className="bc-rl" role="dialog" aria-label={RS.launcher}>
      <div className="bc-rl-head">
        <TooltipTrigger placement="bottom">
          <ActionButton isQuiet size="S" aria-label={RS.close} onPress={() => void s.act({ type: 'close' })}>
            <Close />
          </ActionButton>
          <Tooltip>{RS.close}</Tooltip>
        </TooltipTrigger>
        <span className="bc-rl-head__grip" aria-hidden="true" />
        <TooltipTrigger placement="bottom">
          <ActionButton isQuiet size="S" aria-label={RS.settings} onPress={() => void s.act({ type: 'settings' })}>
            <Settings />
          </ActionButton>
          <Tooltip>{RS.settingsTip}</Tooltip>
        </TooltipTrigger>
      </div>
      <div className={`bc-rl-body${list ? ' is-list' : ''}`} key={list ?? `main-${session.id}`}>
        {body}
      </div>
    </div>
  );
}

function LauncherMain({ choice, onList }: { choice: RecordingChoice; onList(kind: ListKind): void }) {
  const s = useSurface();
  const session = s.state.session!;
  const sources = s.sources!;
  const [more, setMore] = useState(false);
  const fps = session.agent ? session.agent.options.fps : useRecordingPrefs.getState().fps;
  const screenBlocked = permissionBlocked(sources.permissions.screen);
  const blocks = sourceBlocks(sources);
  const camera = deviceView('camera', choice, sources, session.notices);
  const mic = deviceView('microphone', choice, sources, session.notices);
  const level = useMicLevel(mic.pill.state === 'on' ? mic.name : null, sources);
  const disk = lowDisk(choice, sources, fps);
  const notices = session.notices.filter((n) => n.kind !== 'camera-gone' && n.kind !== 'microphone-gone');
  const gone = session.notices.filter((n) => n.kind === 'camera-gone' || n.kind === 'microphone-gone');
  const code = sources.available ? null : unavailableCode(sources);
  const landingNote = session.landing.note;

  const onPill = (d: DeviceView) => {
    if (d.pill.action === 'open-settings') void s.act({ type: 'permission', permission: d.kind });
    else if (d.pill.action === 'turn-off') s.choose(d.kind === 'camera' ? { camera: null, cameraName: null } : { microphone: null, microphoneName: null });
    else onList(d.kind);
  };
  const onRow = (d: DeviceView) => (d.pill.action === 'open-settings' ? void s.act({ type: 'permission', permission: d.kind }) : onList(d.kind));

  return (
    <div className="bc-rl-main">
      <div className="bc-rl-dest">
        <span className="bc-rl-dest__ic">{session.landing.kind === 'agent' ? <AIMark /> : <Folder />}</span>
        <span className="bc-rl-dest__b">
          <span className="bc-rl-dest__t">{session.landing.text}</span>
          {landingNote ? <span className="bc-rl-dest__note">{landingNote}</span> : null}
        </span>
        {session.landing.kind === 'into' ? (
          <TooltipTrigger placement="bottom">
            <ActionButton isQuiet size="XS" aria-label={RS.backToEditor} onPress={() => void s.act({ type: 'close' })}>
              <Close />
            </ActionButton>
            <Tooltip>{RS.backToEditor}</Tooltip>
          </TooltipTrigger>
        ) : null}
      </div>
      {!sources.available ? (
        <div className="bc-rl-err" role="alert">
          {unsupportedText(code, code === sources.reason ? null : sources.reason)}
        </div>
      ) : screenBlocked ? (
        <div className="bc-rl-perm" role="alert">
          <span className="bc-rl-perm__ic">
            <AlertTriangle />
          </span>
          <span className="bc-rl-perm__t">{RS.screenBlocked}</span>
          <Button size="S" variant="secondary" onPress={() => void s.act({ type: 'permission', permission: 'screen' })}>
            {RC.openSettings}
          </Button>
        </div>
      ) : null}
      {session.error ? (
        <div className="bc-rl-err" role="alert">
          {RC.startFailed(session.error)}
        </div>
      ) : null}

      <div className="bc-rl-sec">{RS.targets}</div>
      <div className="bc-rl-targets" role="group" aria-label={RS.targets}>
        {TARGETS.map((t) => {
          const disabled = !sources.available || screenBlocked || !!blocks[t.kind];
          const on = choice.source === t.kind;
          const label = t.kind === 'display' ? RS.targetDisplay : t.kind === 'window' ? RS.targetWindow : RS.targetArea;
          const listLabel = t.list === 'display' ? RS.chooseDisplay : RS.chooseWindow;
          return (
            <div key={t.kind} className={`bc-rl-target${on ? ' is-on' : ''}${t.list ? ' has-list' : ''}`}>
              <button type="button" className="bc-rl-target__main" disabled={disabled} aria-pressed={on} onClick={() => void s.act({ type: 'pick', kind: t.kind })}>
                <span className="bc-rl-target__ic">{t.icon}</span>
                <span className="bc-rl-target__lb">{label}</span>
              </button>
              {t.list ? (
                <button type="button" className="bc-rl-target__more" disabled={disabled} aria-label={listLabel} title={listLabel} onClick={() => onList(t.list!)}>
                  <ChevronDown />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="bc-rl-sec">{RS.devices}</div>
      <div className="bc-rl-devs">
        <DeviceRow icon={<Camera />} view={camera} rowLabel={RS.camera} onRow={() => onRow(camera)} onPill={() => onPill(camera)} />
        <DeviceRow
          icon={<Microphone />}
          view={mic}
          rowLabel={RS.microphone}
          level={mic.pill.state === 'on' ? level : null}
          onRow={() => onRow(mic)}
          onPill={() => onPill(mic)}
        />
        <div className={`bc-rl-dev${choice.systemAudio ? ' is-on' : ''}`}>
          <button type="button" className="bc-rl-dev__main" aria-label={RS.systemAudio} onClick={() => s.choose({ systemAudio: !choice.systemAudio })}>
            <span className="bc-rl-dev__ic">{choice.systemAudio ? <VolumeTwo /> : <VolumeOff />}</span>
            <span className="bc-rl-dev__name">{choice.systemAudio ? RS.systemOn : RS.systemOff}</span>
          </button>
          <button
            type="button"
            className={`bc-rec-pill bc-rec-pill--${choice.systemAudio ? 'on' : 'off'}`}
            aria-label={RS.pillLabel(RS.systemAudio, choice.systemAudio ? RS.pillOn : RS.pillOff)}
            onClick={() => s.choose({ systemAudio: !choice.systemAudio })}>
            {choice.systemAudio ? RS.pillOn : RS.pillOff}
          </button>
        </div>
      </div>

      <button type="button" className={`bc-rl-more${more ? ' is-open' : ''}`} aria-expanded={more} onClick={() => setMore((v) => !v)}>
        <span>{RS.more}</span>
        <span className="bc-rl-more__chev">
          <ChevronDown />
        </span>
      </button>
      {more ? (
        <div className="bc-rl-opts">
          <div className="bc-rl-opt">
            <span className="bc-rl-opt__lb">{RC.cursor}</span>
            <SegmentedControl aria-label={RC.cursor} selectedKey={choice.cursor} onSelectionChange={(k) => s.choose({ cursor: k as RecordingCursorMode })}>
              <SegmentedControlItem id="separate">{RC.cursorSeparate}</SegmentedControlItem>
              <SegmentedControlItem id="baked">{RC.cursorBaked}</SegmentedControlItem>
              <SegmentedControlItem id="none">{RC.cursorNone}</SegmentedControlItem>
            </SegmentedControl>
            <span className="bc-rl-opt__note">
              {choice.cursor === 'separate' ? RC.cursorSeparateNote : choice.cursor === 'baked' ? RS.cursorBakedNote : RC.cursorNoneNote}
            </span>
          </div>
          <div className="bc-rl-opt">
            <span className="bc-rl-opt__lb">{RC.keys}</span>
            <SegmentedControl aria-label={RC.keys} selectedKey={choice.keys} onSelectionChange={(k) => s.choose({ keys: k as RecordingKeysMode })}>
              <SegmentedControlItem id="off">{RC.keysOff}</SegmentedControlItem>
              <SegmentedControlItem id="shortcuts">{RC.keysShortcuts}</SegmentedControlItem>
              <SegmentedControlItem id="all">{RC.keysAll}</SegmentedControlItem>
            </SegmentedControl>
            {choice.keys === 'all' ? <span className="bc-rl-opt__note">{RC.keysAllNote}</span> : null}
          </div>
          {showsIncludeSelf(choice.source) ? (
            <div className="bc-rl-opt">
              <Switch size="S" isSelected={choice.includeSelf} onChange={(includeSelf) => s.choose({ includeSelf })}>
                {RC.includeSelf}
              </Switch>
              <span className="bc-rl-opt__note">{choice.includeSelf ? RS.selfOn : RS.selfOff}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {disk || gone.length || notices.length ? (
        <div className="bc-rl-tips">
          {[...gone, ...notices].map((n) => (
            <div key={n.kind} className="bc-rl-tip" role="status">
              <AlertTriangle />
              <span>{noticeText(n)}</span>
            </div>
          ))}
          {disk ? (
            <div className="bc-rl-tip" role="status">
              <AlertTriangle />
              <span>{RC.diskLow(formatBytes(disk.freeBytes), disk.minutes)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 设备行（高 42）：左图标、设备名、右侧药丸；麦克风的电平是整行背景从左向右的填充。 */
function DeviceRow({ icon, view, rowLabel, level, onRow, onPill }: { icon: ReactNode; view: DeviceView; rowLabel: string; level?: number | null; onRow(): void; onPill(): void }) {
  return (
    <div className={`bc-rl-dev${view.pill.state === 'on' ? ' is-on' : ''}`}>
      {level != null ? <span className="bc-rl-dev__lvl" style={{ width: `${Math.round(level * 100)}%` }} aria-hidden="true" /> : null}
      <button type="button" className="bc-rl-dev__main" onClick={onRow} aria-label={`${rowLabel}: ${view.label}`}>
        <span className="bc-rl-dev__ic">{icon}</span>
        <span className="bc-rl-dev__name">{view.label}</span>
      </button>
      <button type="button" className={`bc-rec-pill bc-rec-pill--${view.pill.state}`} onClick={onPill} aria-label={RS.pillLabel(rowLabel, view.pillText)}>
        {view.pillText}
      </button>
    </div>
  );
}

/** 原地滑出的列表：返回、搜索、选项。选定屏幕或窗口直接打开那种覆盖层（窗口已经固定选中）。 */
function LauncherList({ kind, choice, onBack }: { kind: ListKind; choice: RecordingChoice; onBack(): void }) {
  const s = useSurface();
  const sources = s.sources!;
  const [q, setQ] = useState('');
  let title: string;
  let items: Array<{ id: string; label: string; meta?: string }>;
  let value: string;
  if (kind === 'display') {
    title = RS.chooseDisplay;
    items = sources.displays.map((d) => ({ id: d.id, label: d.name, meta: RS.displayMeta(d.width, d.height, d.primary) }));
    value = choice.displayId ?? sources.displays.find((d) => d.primary)?.id ?? '';
  } else if (kind === 'window') {
    title = RS.chooseWindow;
    items = sources.windows.map((w) => ({ id: w.id, label: RC.windowName(w.app, w.title) }));
    value = choice.windowId ?? '';
  } else {
    title = kind === 'camera' ? RS.camera : RS.microphone;
    items = deviceItems(kind, sources);
    value = (kind === 'camera' ? choice.camera : choice.microphone) ?? 'none';
  }
  const shown = filterList(items, q);
  const pick = (id: string) => {
    if (kind === 'display' || kind === 'window') {
      s.choose(kind === 'display' ? { displayId: id, source: 'display' } : { windowId: id, source: 'window' });
      void s.act({ type: 'pick', kind });
    } else s.choose(devicePatch(kind, id, sources));
    onBack();
  };
  return (
    <div className="bc-rl-list" role="group" aria-label={title}>
      <div className="bc-rl-list__hd">
        <ActionButton isQuiet size="S" onPress={onBack}>
          <ChevronLeft />
          <Text>{RS.back}</Text>
        </ActionButton>
        <span className="bc-rl-list__title">{title}</span>
      </div>
      <SearchField aria-label={RS.search(title)} size="S" value={q} onChange={setQ} autoFocus />
      <div className="bc-rl-list__items" role="listbox" aria-label={title}>
        {shown.length ? (
          shown.map((x) => (
            <button key={x.id} type="button" role="option" aria-selected={x.id === value} className={`bc-rl-list__item${x.id === value ? ' is-on' : ''}`} onClick={() => pick(x.id)}>
              <span className="bc-rl-list__name">{x.label}</span>
              {x.meta ? <span className="bc-rl-list__meta">{x.meta}</span> : null}
              {x.id === value ? (
                <span className="bc-rl-list__check">
                  <Checkmark />
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <div className="bc-rl-list__empty">{RS.empty(q)}</div>
        )}
      </div>
    </div>
  );
}
