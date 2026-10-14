import { useState, type ReactNode } from 'react';
import {
  LOCALES,
  LOCALE_NATIVE_NAMES,
  isLanguagePreference,
  resolveLanguage,
} from '@baocut/protocol';
import {
  Button,
  NumberField,
  Picker,
  PickerItem,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  ToastQueue,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { AUTO_ROW, autoUpdatePatch } from '../../model/app-update.ts';
import { shortenPath } from '../../model/format.ts';
import {
  SAVE_DIR_ROW,
  LINE_LENGTH_PRESETS,
  TRASH_DAYS,
  autoUpdateOn,
  lineLengthKey,
  lineLengthText,
  trashDaysValue,
} from '../../model/general-settings.ts';
import { CUE_PARAMS } from '../../model/speech-cues.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useAppUpdate } from '../../state/app-update-store.ts';
import { useSetting, useSettings } from '../../state/settings-store.ts';
import { useShell, type ColorScheme } from '../../state/shell-store.ts';
import { DOWNLOAD_SOURCE_COPY as SOURCES } from '../../model/download-source.ts';
import { SourceKindList } from '../models/download-sources.tsx';
import { M } from './general-settings-copy.ts';
import { useSaveSettings, useSettingsReady } from './save-settings.ts';

/*
 * 设置 › 通用（设计稿 page-settings.jsx `GeneralSection`、settings-update.jsx `AppUpdateAutoRow`、import-panel.jsx
 * `DownloaderSettings`）：界面、编辑与转录、下载与更新三组照设计稿；合同里有、设计稿这一页没画的键（下载来源、严格离线、
 * 回收站保留天数）按同样的行补在后面。取值读设置镜像（`useSetting`），改了就 `settings.set`，有效值经 `settings` 主题回来。
 *
 * 不造假：Runtime 与界面都还没有用到的键（转录完成后、字幕行长）以及设计稿里没有实现的项（cue 底纹）照样画出来，
 * 但置灰，行下写一句为什么。自动更新由桌面主进程按这两个键执行，只在管更新的桌面宿主里出现。分组与行的样式与设置页的
 * Group / Row 相同。
 */

const group = style({ marginBottom: 48 });
const groupHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 });
const groupTitle = style({ margin: 0, font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const groupLead = style({ marginTop: -8, marginBottom: 16, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const card = style({ paddingX: 16, borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', borderRadius: 'xl' });
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingY: 16,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const rowText = style({ flexGrow: 1, minWidth: 0 });
const rowLabel = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const rowDesc = style({ marginTop: 4, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
/** 置灰的原因：说明下面另起一行，比说明深一档。 */
const rowNote = style({ marginTop: 4, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const rowControl = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });
const languagePicker = style({ width: 200 });
const daysField = style({ width: 112 });

export function GeneralSettings() {
  const web = useRuntime().host.platform === 'web';
  const ready = useSettingsReady();
  return (
    <>
      <InterfaceGroup />
      <EditingGroup />
      <DownloadsGroup web={web} ready={ready} />
      <SourcesGroup web={web} ready={ready} />
      <SpaceGroup web={web} ready={ready} />
    </>
  );
}

function InterfaceGroup() {
  const scheme = useShell((s) => s.colorScheme);
  const setScheme = useShell((s) => s.setColorScheme);
  const language = useShell((s) => s.language);
  const setLanguage = useShell((s) => s.setLanguage);
  const system = LOCALE_NATIVE_NAMES[resolveLanguage('system', navigator.languages ?? [navigator.language])];
  return (
    <Group title={M.interfaceGroup}>
      <Row label={M.language} desc={M.languageDesc}>
        <Picker
          size="S"
          aria-label={M.language}
          selectedKey={language}
          onSelectionChange={(key) => isLanguagePreference(key) && setLanguage(key)}
          styles={languagePicker}>
          <PickerItem id="system">{M.languageSystem(system)}</PickerItem>
          {LOCALES.map((locale) => (
            <PickerItem key={locale} id={locale}>
              {LOCALE_NATIVE_NAMES[locale]}
            </PickerItem>
          ))}
        </Picker>
      </Row>
      <Row label={M.appearance} desc={M.appearanceDesc}>
        <SegmentedControl aria-label={M.appearance} selectedKey={scheme} onSelectionChange={(key) => setScheme(key as ColorScheme)}>
          <SegmentedControlItem id="system">{M.schemeSystem}</SegmentedControlItem>
          <SegmentedControlItem id="light">{M.schemeLight}</SegmentedControlItem>
          <SegmentedControlItem id="dark">{M.schemeDark}</SegmentedControlItem>
        </SegmentedControl>
      </Row>
    </Group>
  );
}

/** 编辑与转录：三项都还没有人用，照设计稿画、置灰，写明现在实际怎么做。 */
function EditingGroup() {
  const after = useSetting('transcribe.afterComplete');
  const lineLength = useSetting('captions.maxLineLength');
  const preset = lineLengthKey(lineLength);
  const custom = lineLength && !preset ? lineLengthText(lineLength) : null;
  return (
    <Group title={M.editingGroup}>
      <Row label={M.autoOpen} desc={M.autoOpenDesc} note={M.autoOpenNote}>
        <Switch aria-label={M.autoOpen} isDisabled isSelected={(after ?? 'open-video') === 'open-video'} />
      </Row>
      <Row label={M.lineLength} desc={M.lineLengthDesc} note={M.lineLengthNote(CUE_PARAMS.maxChars, custom)}>
        <SegmentedControl aria-label={M.lineLength} isDisabled selectedKey={preset}>
          {LINE_LENGTH_PRESETS.map((p) => (
            <SegmentedControlItem key={p.key} id={p.key}>
              {p.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </Row>
      <Row label={M.cueShading} desc={M.cueShadingDesc} note={M.cueShadingNote}>
        <Switch aria-label={M.cueShading} isDisabled isSelected={false} />
      </Row>
    </Group>
  );
}

function DownloadsGroup({ web, ready }: { web: boolean; ready: boolean }) {
  return (
    <Group title={M.downloadsGroup}>
      <SaveDirRow web={web} ready={ready} />
      <AutoUpdateRow ready={ready} />
    </Group>
  );
}

/**
 * 自动检查并下载更新（设计稿 settings-update.jsx `AppUpdateAutoRow`）：一个开关管两个键——打开时两个都开，关上只关自动下载
 * （照样按节奏检查，发现新版本提醒「可以更新了」）。主进程按这两个键排检查与下载。宿主没有更新面（网页）或这一份不管更新
 * （开发构建、App Store 版）时这一行不出现。
 */
function AutoUpdateRow({ ready }: { ready: boolean }) {
  const updatable = useRuntime().host.updates !== undefined;
  const unsupported = useAppUpdate((s) => s.snapshot?.state.k === 'unsupported');
  const save = useSaveSettings();
  const check = useSetting('updates.autoCheck');
  const download = useSetting('updates.autoDownload');
  if (!updatable || unsupported) return null;
  return (
    <Row label={AUTO_ROW.label} desc={AUTO_ROW.desc}>
      <Switch
        aria-label={AUTO_ROW.label}
        isDisabled={!ready}
        isSelected={autoUpdateOn(check, download)}
        onChange={(on) => void save(autoUpdatePatch(on), on ? M.autoUpdateOn : M.autoUpdateOff)}
      />
    </Row>
  );
}

/** 默认保存位置（`downloads.directory`）：系统面板选文件夹；浏览器里选不了本机文件夹。 */
function SaveDirRow({ web, ready }: { web: boolean; ready: boolean }) {
  const runtime = useRuntime();
  const save = useSaveSettings();
  const dir = useSetting('downloads.directory');
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    setBusy(true);
    try {
      const next = await runtime.host.pickDirectory({ title: SAVE_DIR_ROW.pickTitle });
      if (next) await save({ 'downloads.directory': next }, SAVE_DIR_ROW.changed);
    } catch (error) {
      ToastQueue.negative(SAVE_DIR_ROW.pickFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    setBusy(true);
    await save({ 'downloads.directory': null }, SAVE_DIR_ROW.resetDone);
    setBusy(false);
  };
  const off = web || !ready || busy;
  return (
    <Row
      label={SAVE_DIR_ROW.label}
      desc={
        <>
          <div>{SAVE_DIR_ROW.desc}</div>
          <div>{dir ? shortenPath(dir) : SAVE_DIR_ROW.systemDefault}</div>
        </>
      }
      note={web ? SAVE_DIR_ROW.webNote : undefined}>
      {dir ? (
        <Button variant="secondary" size="S" isDisabled={off} onPress={() => void reset()}>
          {SAVE_DIR_ROW.reset}
        </Button>
      ) : null}
      <Button variant="secondary" size="S" isDisabled={off} onPress={() => void pick()}>
        {SAVE_DIR_ROW.change}
      </Button>
    </Row>
  );
}

/**
 * 下载来源与离线（设计稿 download-sources.jsx `DownloadSourcesGroup`）：两种来源各一个列表（download-sources.tsx），再是严格离线。
 * 浏览器里只读：Web 白名单不含 `settings.set`，置灰并写一句原因。
 */
function SourcesGroup({ web, ready }: { web: boolean; ready: boolean }) {
  const save = useSaveSettings();
  const strict = useSetting('offline.strict');
  return (
    <Group title={M.sourcesGroup} lead={SOURCES.lead}>
      <SourceKindList kind="models" />
      <SourceKindList kind="tools" />
      <Row label={M.strictOffline} desc={M.strictOfflineDesc} note={web ? M.webNote : undefined}>
        <Switch
          aria-label={M.strictOffline}
          isDisabled={web || !ready}
          isSelected={strict ?? false}
          onChange={(on) => void save({ 'offline.strict': on }, on ? M.strictOfflineOn : M.strictOfflineOff)}
        />
      </Row>
    </Group>
  );
}

/** 合同里有、设计稿这一页没画的：回收站保留天数。清空数字框 = 恢复默认。浏览器里只读。 */
function SpaceGroup({ web, ready }: { web: boolean; ready: boolean }) {
  const save = useSaveSettings();
  const days = useSetting('space.trashRetentionDays');
  const fallback = useSettings((s) => s.snapshot?.defaults['space.trashRetentionDays'] ?? null);
  return (
    <Group title="Space">
      <Row
        label={M.trashDays}
        desc={M.trashDaysDesc(fallback)}
        note={web ? M.webNote : undefined}>
        <NumberField
          aria-label={M.trashDays}
          size="S"
          minValue={TRASH_DAYS.min}
          maxValue={TRASH_DAYS.max}
          step={1}
          value={days ?? Number.NaN}
          isDisabled={web || !ready}
          styles={daysField}
          onChange={(input) => {
            const next = trashDaysValue(input);
            if (next !== days) void save({ 'space.trashRetentionDays': next });
          }}
        />
      </Row>
    </Group>
  );
}

export function Group({ title: text, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className={group} aria-label={text}>
      <div className={groupHead}>
        <h2 className={groupTitle}>{text}</h2>
      </div>
      {lead ? <p className={groupLead}>{lead}</p> : null}
      <div className={card}>{children}</div>
    </section>
  );
}

/** 一行：左边名字、说明与置灰的原因，右边控件。 */
export function Row({ label, desc, note, children }: { label: string; desc?: ReactNode; note?: string; children?: ReactNode }) {
  return (
    <div className={row}>
      <div className={rowText}>
        <div className={rowLabel}>{label}</div>
        {desc ? <div className={rowDesc}>{desc}</div> : null}
        {note ? <div className={rowNote}>{note}</div> : null}
      </div>
      {children ? <div className={rowControl}>{children}</div> : null}
    </div>
  );
}
