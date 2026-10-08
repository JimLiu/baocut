import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  LOCALES,
  LOCALE_NATIVE_NAMES,
  isLanguagePreference,
  resolveLanguage,
  type ExternalToolStatus,
  type SettingInputValues,
  type SettingKey,
} from '@baocut/protocol';
import {
  Button,
  NumberField,
  Picker,
  PickerItem,
  SegmentedControl,
  SegmentedControlItem,
  StatusLight,
  Switch,
  TextField,
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
  downloaderLine,
  endpointProblem,
  endpointValue,
  lineLengthKey,
  lineLengthText,
  trashDaysValue,
} from '../../model/general-settings.ts';
import { CUE_PARAMS } from '../../model/speech-cues.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useAppUpdate } from '../../state/app-update-store.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useSetting, useSettings } from '../../state/settings-store.ts';
import { useShell, type ColorScheme } from '../../state/shell-store.ts';
import { M } from './general-settings-copy.ts';

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
const stackedRow = style({
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
const fieldLine = style({ display: 'flex', alignItems: 'start', flexWrap: 'wrap', gap: 8, marginTop: 12 });
const endpointInput = style({ flexGrow: 1, minWidth: 220 });
const languagePicker = style({ width: 200 });
const daysField = style({ width: 112 });

type Patch = { [K in SettingKey]?: SettingInputValues[K] | null };

/** 写设置：失败时提示原因，返回是否写成。 */
export function useSaveSettings(): (values: Patch, done?: string) => Promise<boolean> {
  const runtime = useRuntime();
  return useCallback(
    async (values: Patch, done?: string) => {
      try {
        await runtime.client.request('settings.set', { values });
        if (done) ToastQueue.positive(done, { timeout: 3000 });
        return true;
      } catch (error) {
        ToastQueue.negative(M.saveFailed((error as Error).message), { timeout: 5000 });
        return false;
      }
    },
    [runtime],
  );
}

/** 连上了 Runtime、设置镜像也到了：能改。 */
export function useSettingsReady(): boolean {
  const connected = useConnection((s) => s.state.status === 'connected');
  const loaded = useSettings((s) => s.snapshot !== null);
  return connected && loaded;
}

export function GeneralSettings() {
  const web = useRuntime().host.platform === 'web';
  const ready = useSettingsReady();
  return (
    <>
      <InterfaceGroup />
      <EditingGroup />
      <DownloadsGroup web={web} ready={ready} />
      <SourcesGroup ready={ready} />
      <SpaceGroup ready={ready} />
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
      <DownloaderRow web={web} />
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

type ToolCheck = { status: 'checking' } | { status: 'done'; tool: ExternalToolStatus | null } | { status: 'failed'; message: string };

/**
 * 视频下载工具（设计稿 `DownloaderSettings`）：只读的一行，写 yt-dlp 此刻能不能用。检测只在本机跑 `yt-dlp --version`、不联网
 * （`externalTools.detect`）。设计稿的安装、更新与「安装范围」不在这里做：BaoCut 只在 Agent 从链接导入、你同意之后才下载它。
 * 浏览器里不检测（Runtime 不对网页开放外部工具）。
 */
function DownloaderRow({ web }: { web: boolean }) {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const [check, setCheck] = useState<ToolCheck>({ status: 'checking' });
  const recheck = useCallback(() => {
    setCheck({ status: 'checking' });
    runtime.detectExternalTool('yt-dlp').then(
      (tool) => setCheck({ status: 'done', tool }),
      (error: Error) => setCheck({ status: 'failed', message: error.message }),
    );
  }, [runtime]);
  useEffect(() => {
    if (!web && connected) recheck();
  }, [web, connected, recheck]);
  if (web) return <Row label={M.downloader} desc={M.downloaderWeb} />;
  const line = check.status === 'done' ? downloaderLine(check.tool) : null;
  const desc = check.status === 'checking' ? M.checking : check.status === 'failed' ? M.checkFailed(check.message) : (line?.desc ?? '');
  return (
    <Row label={M.downloader} desc={desc}>
      {line ? (
        <StatusLight size="S" variant={line.tone}>
          {line.status}
        </StatusLight>
      ) : null}
      <Button variant="secondary" size="S" isDisabled={!connected} isPending={check.status === 'checking' && connected} onPress={recheck}>
        {M.checkAgain}
      </Button>
    </Row>
  );
}

/** 合同里有、设计稿这一页没画的：下载来源与严格离线。 */
function SourcesGroup({ ready }: { ready: boolean }) {
  const save = useSaveSettings();
  const strict = useSetting('offline.strict');
  return (
    <Group title={M.sourcesGroup}>
      <EndpointRow
        settingKey="models.downloadEndpoint"
        label={M.modelsEndpoint}
        desc={M.modelsEndpointDesc}
        placeholder="https://huggingface.co"
        ready={ready}
      />
      <EndpointRow
        settingKey="tools.downloadEndpoint"
        label={M.toolsEndpoint}
        desc={M.toolsEndpointDesc}
        placeholder={M.toolsEndpointPlaceholder}
        ready={ready}
      />
      <Row label={M.strictOffline} desc={M.strictOfflineDesc}>
        <Switch
          aria-label={M.strictOffline}
          isDisabled={!ready}
          isSelected={strict ?? false}
          onChange={(on) => void save({ 'offline.strict': on }, on ? M.strictOfflineOn : M.strictOfflineOff)}
        />
      </Row>
    </Group>
  );
}

/** 一个下载来源：填基址保存，清空保存或点「恢复默认」回到默认来源。规则与合同的校验相同，不合的不让存。 */
function EndpointRow({
  settingKey,
  label,
  desc,
  placeholder,
  ready,
}: {
  settingKey: 'models.downloadEndpoint' | 'tools.downloadEndpoint';
  label: string;
  desc: string;
  placeholder: string;
  ready: boolean;
}) {
  const save = useSaveSettings();
  const saved = useSetting(settingKey) ?? '';
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(saved), [saved]);
  const next = endpointValue(value);
  const problem = endpointProblem(value);
  const commit = async (endpoint: string | null) => {
    setBusy(true);
    await save({ [settingKey]: endpoint }, endpoint ? M.endpointChanged(endpoint) : M.endpointReset(label));
    setBusy(false);
  };
  const off = !ready || busy;
  return (
    <div className={stackedRow}>
      <div className={rowLabel}>{label}</div>
      <div className={rowDesc}>{desc}</div>
      <div className={fieldLine}>
        <TextField
          aria-label={label}
          size="S"
          value={value}
          onChange={setValue}
          placeholder={placeholder}
          isInvalid={problem !== null}
          errorMessage={problem ?? undefined}
          isDisabled={off}
          styles={endpointInput}
        />
        <Button variant="secondary" size="S" isDisabled={off || problem !== null || (next ?? '') === saved} onPress={() => void commit(next)}>
          {M.save}
        </Button>
        {saved ? (
          <Button variant="secondary" size="S" isDisabled={off} onPress={() => void commit(null)}>
            {M.resetDefault}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** 合同里有、设计稿这一页没画的：回收站保留天数。清空数字框 = 恢复默认。 */
function SpaceGroup({ ready }: { ready: boolean }) {
  const save = useSaveSettings();
  const days = useSetting('space.trashRetentionDays');
  const fallback = useSettings((s) => s.snapshot?.defaults['space.trashRetentionDays'] ?? null);
  return (
    <Group title="Space">
      <Row
        label={M.trashDays}
        desc={M.trashDaysDesc(fallback)}>
        <NumberField
          aria-label={M.trashDays}
          size="S"
          minValue={TRASH_DAYS.min}
          maxValue={TRASH_DAYS.max}
          step={1}
          value={days ?? Number.NaN}
          isDisabled={!ready}
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

export function Group({ title: text, children }: { title: string; children: ReactNode }) {
  return (
    <section className={group} aria-label={text}>
      <div className={groupHead}>
        <h2 className={groupTitle}>{text}</h2>
      </div>
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
