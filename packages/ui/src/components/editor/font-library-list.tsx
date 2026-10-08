import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { FontCategory, FontScript } from '@baocut/protocol';
import { ActionButton, Picker, PickerItem, SearchField, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import Close from '@react-spectrum/s2/icons/Close';
import Download from '@react-spectrum/s2/icons/Download';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import {
  FONT_CATEGORIES,
  FONT_OFFLINE_NOTE,
  FONT_SCRIPTS,
  FONT_STRICT_OFFLINE_NOTE,
  KERNEL_FALLBACK,
  SYSTEM_FONT,
  alreadyDownloadedText,
  catalogueCount,
  familyKey,
  fontError,
  fontLabel,
  fontSections,
  liveFontJobs,
  liveRow,
  orderKey,
  pickToast,
  pickerRows,
  rowEnd,
  type FontRow,
} from '../../model/font-library.ts';
import {
  FONT_LIST_HEIGHT,
  FONT_ROW_HEIGHT,
  fontListLayout,
  samplesToLoad,
  scrollToRow,
  visibleRange,
} from '../../model/font-list-window.ts';
import { useRuntime } from '../../runtime/context.tsx';
import {
  cancelFamily,
  chooseFamily,
  downloadFamily,
  loadCatalogue,
  requestSample,
  startFontLibrarySync,
  useFontLibrary,
  useFontRecent,
  type SampleState,
} from '../../state/font-library-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useSetting } from '../../state/settings-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { FontDetail, toastError } from './font-detail.tsx';
import { FONT_COPY as FC } from './font-copy.ts';
import { intlLocale } from '@baocut/protocol';

/**
 * 选字框的一张表（原型 panel-font-picker.jsx 的 LibraryPicker）：搜索、分类与文字筛选，分段「这个视频里用到 → 最近用过 →
 * 全部字体」（检索或筛选时合成「搜索结果」），每一行写着此刻的状态。约两千行按定高虚拟滚动，只画视野里的；样张滚进视野
 * 120ms 后才取。打开着的时候行序不动（下载完的族不在光标底下跳位置）。原型的「品牌字体」一段与「导入字体…」没有：
 * 品牌库的字体还不能在字体框里选，真实应用也没有导入本机字体文件的路径。
 */

type Client = ReturnType<typeof useRuntime>['client'];

const panel = style({ display: 'flex', flexDirection: 'column', width: 260, maxWidth: 'full', padding: 8, boxSizing: 'border-box' });
const inlinePanel = style({
  display: 'flex',
  flexDirection: 'column',
  padding: 8,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const filters = style({ display: 'flex', gap: '[6px]', marginTop: '[6px]' });
const filter = style({ flexGrow: 1, flexBasis: 0, minWidth: 0 });
const note = style({
  display: 'flex',
  alignItems: 'center',
  gap: '[6px]',
  marginTop: '[6px]',
  paddingX: 8,
  paddingY: '[6px]',
  borderRadius: 'default',
  backgroundColor: 'orange-100',
  font: 'ui-sm',
  color: 'orange-1000',
});
const scroller = style({ position: 'relative', overflowY: 'auto', marginTop: '[6px]' });
const head = style({
  position: 'absolute',
  insetStart: 0,
  insetEnd: 0,
  boxSizing: 'border-box',
  height: 26,
  paddingTop: 8,
  paddingX: 8,
  paddingBottom: 4,
  font: 'ui-xs',
  fontWeight: 'bold',
  color: 'gray-600',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
});
const count = style({ fontWeight: 'normal', textTransform: 'none', color: 'gray-500' });
const row = style({
  position: 'absolute',
  insetStart: 0,
  insetEnd: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 33,
  borderRadius: 'default',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100' },
});
const pickButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexGrow: 1,
  minWidth: 0,
  height: 'full',
  paddingX: 8,
  borderWidth: 0,
  borderRadius: 'default',
  backgroundColor: 'transparent',
  color: 'gray-900',
  textAlign: 'start',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  cursor: 'default',
});
const name = style({ flexGrow: 1, minWidth: 0, fontSize: 'ui-lg', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const end = style({ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, paddingEnd: 4 });
const tag = style({
  paddingX: 4,
  font: 'ui-xs',
  whiteSpace: 'nowrap',
  color: { default: 'gray-600', tone: { ok: 'green-900', bad: 'negative' } },
});
const pct = style({ minWidth: 32, font: 'code-xs', color: 'gray-700', textAlign: 'end' });
const info = style({ opacity: { default: 0, isShown: 1 } });
const empty = style({ paddingX: 8, paddingY: '[14px]', textAlign: 'center', font: 'ui-sm', color: 'gray-500' });

/** 浏览器说离线（`navigator.onLine`）：上线、断线时跟着变。 */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** 选中一个族：立即生效（`onPick`），还没下载的开始下载并按原型的规则给 toast。 */
export function pickFamily(client: Client, family: string, fallback: string): void {
  if (family === SYSTEM_FONT) return;
  void chooseFamily(client, family).then(
    (started) => {
      if (!started) return;
      const toast = pickToast(started, fallback);
      if (!toast.cancellable) return void ToastQueue.neutral(toast.text, { timeout: 5000 });
      // 带动作的 toast 在 S2 里不会按 timeout 自己消失：下载结束（下完、失败、取消）或 8 秒后由这里关掉。
      const close = ToastQueue.neutral(toast.text, {
        actionLabel: FC.cancelDownload,
        shouldCloseOnAction: true,
        onAction: () => {
          // 点的时候再看：已经下完就照实说。
          const live = liveFontJobs(useJobs.getState().jobs).has(familyKey(family));
          const status = useFontLibrary.getState().statuses[familyKey(family)];
          if (live || status?.state === 'downloading') void cancelFamily(client, family).catch(() => {});
          else ToastQueue.neutral(alreadyDownloadedText(family), { timeout: 4000 });
        },
        onClose: () => done(),
      });
      let closed = false;
      let seenDownloading = false;
      const timer = setTimeout(() => done(), 8000);
      const unsubscribe = useFontLibrary.subscribe((s) => {
        const state = s.statuses[familyKey(family)]?.state;
        if (state === 'downloading') seenDownloading = true;
        else if (state === 'downloaded' || seenDownloading) done();
      });
      function done() {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        unsubscribe();
        close();
      }
    },
    (error: unknown) => ToastQueue.negative(fontError(error).message, { timeout: 5000 }),
  );
}

export function FontLibraryList({ value, onPick, inline = false }: { value: string; onPick(family: string): void; inline?: boolean }) {
  const { client } = useRuntime();
  const statuses = useFontLibrary((s) => s.statuses);
  const order = useFontLibrary((s) => s.order);
  const loaded = useFontLibrary((s) => s.loaded);
  const samples = useFontLibrary((s) => s.samples);
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const usage = useFontLibrary((s) => (videoId ? s.usage[videoId] : undefined));
  const recent = useFontRecent((s) => s.recent);
  const jobs = useJobs((s) => s.jobs);
  const strict = useSetting('offline.strict') === true;
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FontCategory | null>(null);
  const [script, setScript] = useState<FontScript | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [failed, setFailed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadCatalogue(client).catch(() => setFailed(true));
    return startFontLibrarySync(client);
  }, [client]);

  const rows = useMemo(() => pickerRows(statuses, order, value), [statuses, order, value]);
  // 打开着的选字框里行序不动：表取到之后记下一次，之后按它排（下次打开再按新状态排）。
  const frozen = useRef<Map<string, number> | null>(null);
  if (!frozen.current && loaded) frozen.current = orderKey(rows);
  const inVideo = useMemo(() => usage?.families.map((f) => f.family) ?? [], [usage]);
  const sections = useMemo(
    () => fontSections(rows, { query, category, script, inVideo, recent, frozen: frozen.current ?? undefined }),
    // frozen 只在表取到的那一刻变（跟着 loaded）
    [rows, query, category, script, inVideo, recent, loaded],
  );
  const layout = useMemo(() => fontListLayout(sections), [sections]);
  const viewport = Math.min(FONT_LIST_HEIGHT, layout.height);
  const live = useMemo(() => liveFontJobs(jobs), [jobs]);
  const downloadable = useMemo(() => catalogueCount(rows), [rows]);

  // 第一次画出整表时把当前选中的那一行滚进视野。
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !loaded || !scrollRef.current) return;
    scrolled.current = true;
    const top = scrollToRow(layout.items, value, FONT_LIST_HEIGHT);
    scrollRef.current.scrollTop = top;
    setScrollTop(top);
  }, [layout, loaded, value]);

  // 样张：停下 120ms 后取视野里还没取过的。
  useEffect(() => {
    const timer = setTimeout(() => {
      const known = (family: string) => family === SYSTEM_FONT || !!useFontLibrary.getState().samples[familyKey(family)];
      for (const family of samplesToLoad(layout.items, scrollTop, viewport, known)) void requestSample(client, family);
    }, 120);
    return () => clearTimeout(timer);
  }, [client, layout, scrollTop, viewport]);

  const fallback = usage?.fallback ?? KERNEL_FALLBACK;
  const pick = (family: string) => {
    onPick(family);
    pickFamily(client, family, fallback);
  };

  const detailRow = detail ? statuses[familyKey(detail)] : undefined;
  if (detail && detailRow) {
    return (
      <div className={inline ? inlinePanel : panel}>
        <FontDetail
          row={liveRow(detailRow, live.get(familyKey(detail)))}
          onBack={() => setDetail(null)}
          onPick={() => pick(detailRow.family)}
        />
      </div>
    );
  }

  const [start, stop] = visibleRange(layout.items, scrollTop, viewport);
  const offline = strict ? FONT_STRICT_OFFLINE_NOTE : !online ? FONT_OFFLINE_NOTE : null;
  return (
    <div className={inline ? inlinePanel : panel}>
      <SearchField aria-label={FC.searchFonts} placeholder={FC.searchFontsPlaceholder} size="S" value={query} onChange={setQuery} autoFocus />
      <div className={filters}>
        <Picker
          aria-label={FC.category}
          size="S"
          styles={filter}
          value={category ?? 'all'}
          onChange={(key) => setCategory(key === 'all' || key === null ? null : (key as FontCategory))}>
          {[{ key: 'all', label: FC.allCategories }, ...FONT_CATEGORIES].map((c) => (
            <PickerItem key={c.key} id={c.key}>
              {c.label}
            </PickerItem>
          ))}
        </Picker>
        <Picker
          aria-label={FC.script}
          size="S"
          styles={filter}
          value={script ?? 'all'}
          onChange={(key) => setScript(key === 'all' || key === null ? null : (key as FontScript))}>
          {[{ key: 'all', label: FC.allScripts }, ...FONT_SCRIPTS].map((s) => (
            <PickerItem key={s.key} id={s.key}>
              {s.label}
            </PickerItem>
          ))}
        </Picker>
      </div>
      {offline ? (
        <div className={note}>
          <AlertTriangle />
          {offline}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className={scroller}
        style={{ height: loaded ? viewport : undefined }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {!loaded ? (
          <div className={empty}>{failed ? FC.listFailed : FC.listLoading}</div>
        ) : !layout.items.length ? (
          <div className={empty}>{FC.noMatch}</div>
        ) : (
          <div style={{ height: layout.height, position: 'relative' }}>
            {layout.items.slice(start, stop).map((item) =>
              item.kind === 'head' ? (
                <div key={item.key} className={head} style={{ top: item.top }} role="presentation">
                  {item.title}
                  {item.section === 'all' ? <span className={count}>{FC.downloadable(new Intl.NumberFormat(intlLocale()).format(downloadable))}</span> : null}
                </div>
              ) : (
                <FontRowView
                  key={item.key}
                  top={item.top}
                  row={liveRow(item.row, live.get(familyKey(item.row.family)))}
                  on={familyKey(item.row.family) === familyKey(value)}
                  sample={samples[familyKey(item.row.family)]}
                  client={client}
                  onPick={() => pick(item.row.family)}
                  onDetail={() => setDetail(item.row.family)}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 一行：样张 ＋ 选中勾 ＋ 状态（标签 / 下载 / 进度与取消 / 失败与重试）＋ 悬停时的详情钮。 */
function FontRowView({
  row: f,
  top,
  on,
  sample,
  client,
  onPick,
  onDetail,
}: {
  row: FontRow;
  top: number;
  on: boolean;
  sample: SampleState | undefined;
  client: Client;
  onPick(): void;
  onDetail(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const system = f.family === SYSTEM_FONT;
  const tail = system ? ({ kind: 'none' } as const) : rowEnd(f);
  const fontFamily = sample?.state === 'ready' ? `${sample.css}, system-ui, sans-serif` : undefined;
  return (
    <div
      className={row({ isHovered: hovered || focused })}
      style={{ top, height: FONT_ROW_HEIGHT }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(false)}>
      <RACButton className={pickButton} aria-label={FC.use(fontLabel(f.family))} onPress={onPick}>
        <span className={name} style={fontFamily ? { fontFamily } : undefined}>
          {fontLabel(f.family)}
        </span>
        {on ? <Checkmark /> : null}
      </RACButton>
      <span className={end}>
        {tail.kind === 'badge' ? <span className={tag({ tone: tail.tone === 'positive' ? 'ok' : undefined })}>{tail.label}</span> : null}
        {tail.kind === 'download' ? (
          <Tip text={FC.download}>
            <ActionButton
              isQuiet
              size="XS"
              aria-label={FC.downloadFamily(f.family)}
              onPress={() => void downloadFamily(client, f.family).catch(toastError)}>
              <Download />
            </ActionButton>
          </Tip>
        ) : null}
        {tail.kind === 'progress' ? (
          <>
            <span className={pct}>{tail.label}</span>
            <Tip text={FC.cancelDownload}>
              <ActionButton
                isQuiet
                size="XS"
                aria-label={FC.cancelDownloadFamily(f.family)}
                onPress={() => void cancelFamily(client, f.family).catch(toastError)}>
                <Close />
              </ActionButton>
            </Tip>
          </>
        ) : null}
        {tail.kind === 'retry' ? (
          <>
            <span className={tag({ tone: 'bad' })} title={tail.message}>
              {tail.label}
            </span>
            <Tip text={FC.retryTip(tail.message)}>
              <ActionButton
                isQuiet
                size="XS"
                aria-label={FC.retryFamily(f.family)}
                onPress={() => void downloadFamily(client, f.family).catch(toastError)}>
                <Refresh />
              </ActionButton>
            </Tip>
          </>
        ) : null}
        {system ? null : (
          <span className={info({ isShown: hovered || focused })}>
            <Tip text={FC.detailsTip}>
              <ActionButton isQuiet size="XS" aria-label={FC.detailsFamily(f.family)} onPress={onDetail}>
                <InfoCircle />
              </ActionButton>
            </Tip>
          </span>
        )}
      </span>
    </div>
  );
}

function Tip({ text, children }: { text: string; children: ReactElement }) {
  return (
    <TooltipTrigger placement="top">
      {children}
      <Tooltip>{text}</Tooltip>
    </TooltipTrigger>
  );
}
