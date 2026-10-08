import { useEffect, useState } from 'react';
import {
  ActionButton,
  AlertDialog,
  Badge,
  Button,
  DialogContainer,
  Switch,
  TextField,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import Delete from '@react-spectrum/s2/icons/Delete';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel } from '../../model/format.ts';
import {
  catalogueCount,
  clearConfirmBody,
  clearedText,
  downloadedList,
  familyKey,
  fmtBytes,
  fontError,
  mirrorError,
  removeToast,
  type DownloadedRow,
} from '../../model/font-library.ts';
import { useRuntime } from '../../runtime/context.tsx';
import {
  clearDownloaded,
  loadCatalogue,
  loadDownloaded,
  removeFamily,
  requestSample,
  startFontLibrarySync,
  useFontLibrary,
} from '../../state/font-library-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { FONT_COPY } from './font-settings-copy.ts';
import { Group, Row, useSaveSettings, useSettingsReady } from './general-settings.tsx';

/*
 * 设置 › 字体（产品设计 §5.9「字体」、§7.6；原型 settings-fonts.jsx）：下载一组（自动下载的开关、样式表与字体文件两个镜像
 * 地址，只接受 https，不合规的当场说、不保存），已下载的字体一组（总大小与族数，每个族一行可以删除，全部清空先确认）。
 * 还没结束的导出在用的族标「导出在用」、删除钮不可点（`fonts.downloaded` 的 `inUse`，Runtime 删除时拒绝为 `FONT_IN_USE`）。
 * 只在桌面端出现：浏览器会话没有 `fonts.*`。
 */

const lead = style({ marginTop: 0, marginBottom: 24, font: 'ui-sm', color: 'gray-600' });
const mirror = style({ display: 'flex', flexDirection: 'column', gap: 4, width: 280, maxWidth: 'full' });
const error = style({ font: 'ui-xs', color: 'negative' });
const head = style({ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 });
const headTitle = style({ flexGrow: 1, margin: 0, font: 'ui', fontWeight: 'medium', color: 'gray-900' });
const meta = style({ font: 'ui-sm', color: 'gray-600' });
const empty = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });
const name = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const family = style({
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const facts = style({ font: 'ui-sm', color: 'gray-600' });
const group = style({ marginBottom: 48 });
const card = style({ paddingX: 16, borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', borderRadius: 'xl' });
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingY: 12,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});

export function FontSettings() {
  const { client } = useRuntime();
  const ready = useSettingsReady();
  const save = useSaveSettings();
  const auto = useSetting('fonts.autoDownload') !== false;
  const css = useSetting('fonts.cssEndpoint');
  const file = useSetting('fonts.fileEndpoint');
  const statuses = useFontLibrary((s) => s.statuses);
  const loaded = useFontLibrary((s) => s.loaded);

  useEffect(() => {
    void loadCatalogue(client).catch(() => {});
    void loadDownloaded(client).catch(() => {});
    return startFontLibrarySync(client);
  }, [client]);

  const total = loaded ? catalogueCount(Object.values(statuses)) : null;
  return (
    <>
      <p className={lead}>{FONT_COPY.lead(total)}</p>
      <Group title={FONT_COPY.download}>
        <Row label={FONT_COPY.autoDownload} desc={FONT_COPY.autoDownloadDesc}>
          <Switch
            aria-label={FONT_COPY.autoDownload}
            isDisabled={!ready}
            isSelected={auto}
            onChange={(on) => void save({ 'fonts.autoDownload': on })}
          />
        </Row>
        <Row label={FONT_COPY.cssEndpoint} desc={FONT_COPY.cssEndpointDesc}>
          <MirrorField
            label={FONT_COPY.cssEndpoint}
            placeholder="https://fonts.googleapis.com"
            value={css}
            isDisabled={!ready}
            onSave={(v) => save({ 'fonts.cssEndpoint': v })}
          />
        </Row>
        <Row label={FONT_COPY.fileEndpoint} desc={FONT_COPY.fileEndpointDesc}>
          <MirrorField
            label={FONT_COPY.fileEndpoint}
            placeholder="https://fonts.gstatic.com"
            value={file}
            isDisabled={!ready}
            onSave={(v) => save({ 'fonts.fileEndpoint': v })}
          />
        </Row>
      </Group>
      <DownloadedFonts />
    </>
  );
}

/** 镜像地址：不合规的当场说（字段下一行），不保存；失焦时保存，留空存为 null（用默认）。 */
function MirrorField({
  label,
  placeholder,
  value,
  isDisabled,
  onSave,
}: {
  label: string;
  placeholder: string;
  value: string | null;
  isDisabled: boolean;
  onSave(value: string | null): Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? '';
  const problem = mirrorError(shown);
  const commit = () => {
    if (draft === null || mirrorError(draft)) return;
    const next = draft.trim() || null;
    if (next === (value ?? null)) return setDraft(null);
    void onSave(next).then((ok) => ok && setDraft(null));
  };
  return (
    <div className={mirror}>
      <TextField
        aria-label={label}
        size="S"
        placeholder={placeholder}
        value={shown}
        isDisabled={isDisabled}
        isInvalid={!!problem}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {problem ? <span className={error}>{problem}</span> : null}
    </div>
  );
}

function DownloadedFonts() {
  const { client } = useRuntime();
  const downloaded = useFontLibrary((s) => s.downloaded);
  const [confirming, setConfirming] = useState(false);
  const { rows, totalBytes } = downloaded ? downloadedList(downloaded.faces, downloaded.inUse) : { rows: [], totalBytes: 0 };
  const clearAll = async () => {
    try {
      const result = await clearDownloaded(client);
      ToastQueue.positive(clearedText(result.removed, result.freedBytes, result.kept), { timeout: 5000 });
    } catch (e) {
      ToastQueue.negative(fontError(e).message, { timeout: 5000 });
    }
  };
  return (
    <section className={group} aria-label={FONT_COPY.downloaded}>
      <div className={head}>
        <h2 className={headTitle}>{FONT_COPY.downloaded}</h2>
        <span className={meta}>{rows.length ? FONT_COPY.summary(rows.length, fmtBytes(totalBytes)) : FONT_COPY.none}</span>
        <Button variant="secondary" size="S" isDisabled={!rows.length} onPress={() => setConfirming(true)}>
          {FONT_COPY.clearAll}
        </Button>
      </div>
      {rows.length ? (
        <div className={card}>
          {rows.map((r) => (
            <DownloadedFontRow key={r.family} row={r} />
          ))}
        </div>
      ) : (
        <p className={empty}>{FONT_COPY.empty}</p>
      )}
      <DialogContainer onDismiss={() => setConfirming(false)}>
        {confirming ? (
          <AlertDialog
            variant="destructive"
            title={FONT_COPY.clearTitle}
            primaryActionLabel={FONT_COPY.clear}
            cancelLabel={FONT_COPY.cancel}
            onPrimaryAction={() => void clearAll()}>
            {clearConfirmBody(rows, totalBytes)}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </section>
  );
}

function DownloadedFontRow({ row: r }: { row: DownloadedRow }) {
  const { client } = useRuntime();
  const sample = useFontLibrary((s) => s.samples[familyKey(r.family)]);
  useEffect(() => void requestSample(client, r.family), [client, r.family]);
  const remove = () =>
    removeFamily(client, r.family).then(
      ({ freedBytes }) => ToastQueue.neutral(FONT_COPY.removed(r.family, fmtBytes(freedBytes)), { timeout: 4000 }),
      (e: unknown) => ToastQueue.info(removeToast(r.family, e).text, { timeout: 5000 }),
    );
  const tip = r.inUse ? FONT_COPY.inUseTip : FONT_COPY.removeTip;
  return (
    <div className={row}>
      <span className={name}>
        <b className={family} style={sample?.state === 'ready' ? { fontFamily: `${sample.css}, system-ui, sans-serif` } : undefined}>
          {r.family}
        </b>
        <span className={facts}>{FONT_COPY.facts(String(r.weights), fmtBytes(r.sizeBytes), r.licence, r.at ? agoLabel(r.at) : null)}</span>
      </span>
      {r.inUse ? (
        <Badge variant="notice" size="S" fillStyle="subtle">
          {FONT_COPY.inUse}
        </Badge>
      ) : null}
      <TooltipTrigger placement="top">
        <ActionButton isQuiet size="S" aria-label={FONT_COPY.removeLabel(tip, r.family)} isDisabled={r.inUse} onPress={() => void remove()}>
          <Delete />
        </ActionButton>
        <Tooltip>{tip}</Tooltip>
      </TooltipTrigger>
    </div>
  );
}
