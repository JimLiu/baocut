import { useEffect, useState } from 'react';
import type { DocumentRecord, Id } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  DialogTrigger,
  MenuItem,
  Popover,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Copy from '@react-spectrum/s2/icons/Copy';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useShallow } from 'zustand/react/shallow';
import { explainExportError } from '../../model/export-rejection.ts';
import { TRANSCRIPT_FORMATS } from '../../model/export-settings.ts';
import {
  copyAllSettings,
  copyEffective,
  copyIncludes,
  scopeIsPlain,
  type CopyScope,
  type TranscriptCopyPrefs,
} from '../../model/transcript-copy-options.ts';
import {
  chapterSections,
  copyReceipt,
  copyText,
  lengthReceipt,
  writeTranscript,
  type CopyParagraph,
  type TranscriptView,
} from '../../model/transcript-text.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { copyPrefsOf, useTranscriptCopyPrefs } from '../../state/transcript-copy-prefs-store.ts';
import { EXPORT_COPY } from '../export/export-copy.ts';
import { TranscriptIncludeChecks } from '../export/transcript-include.tsx';
import { copyToClipboard } from './transcript-actions.ts';
import { TRANSCRIPT_TOOLS_COPY as T } from './transcript-copy.ts';

/**
 * 文稿面板的复制（设计稿 transcript-copy.jsx，产品设计 §5.7）：面板头上挨着的两枚钮——复制钮一点就按记住的组合复制全文
 * （`useTranscriptCopyPrefs`），下拉打开「复制设置」：格式、与导出「文稿」页同一组五个开关、正文预览与复制按钮，改了就记住。
 * 复制后的提示写清带了什么，带一个「复制设置」回到弹层。段落、章节的菜单（这一段 / 这一章）用 `useScopeCopy` 与 `copyScope`。
 *
 * 全文走 `exports.renderText`，与同样设置导出的文件逐字节相同（面板里几份转写时各排一份接起来，文首只写在第一份）。
 * 只看译文时 Runtime 排不了（主文档不收译文），由面板按同一写法排（`writeTranscript`）：不写文首，剪掉的部分不出现。
 * 节选也由面板排：范围导出的时间从范围起点算，这里要的是序列上的时刻。
 */

const pair = style({ display: 'inline-flex', alignItems: 'center' });
/** 下拉只有 16px 宽，少占面板头的地方（设计稿 `.txc__chev`）。 */
const chevron = style({ width: 16, minWidth: 16 });
const pop = style({ display: 'flex', flexDirection: 'column', gap: 12, width: 360, maxWidth: '[calc(100vw - 32px)]', boxSizing: 'border-box' });
const popTitle = style({ margin: 0, font: 'title-sm', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const formatRow = style({ display: 'flex', alignItems: 'center', gap: 8 });
const formatLabel = style({ font: 'ui-sm', color: 'gray-700' });
const note = style({ margin: 0, font: 'ui-xs', color: 'gray-600' });
/** 预览框与导出页同一种只读等宽正文（`export-transcript.tsx`），矮一些。 */
const previewText = style({
  font: 'code-xs',
  color: { default: 'gray-800', isStale: 'gray-500' },
  margin: 0,
  boxSizing: 'border-box',
  height: 160,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-25',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  overflow: 'auto',
  userSelect: 'text',
});
const foot = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 });
const receiptText = style({ font: 'ui-xs', color: 'gray-600', minWidth: 0 });

/** 改了开关之后等这么久再排预览：连着点几个只排最后一次（同导出页）。 */
const DEBOUNCE_MS = 150;

/** 组合写成一串零件（复制钮的提示、复制后的回执、范围菜单的副题）：格式，再列这个范围实际带上的项。 */
export function copyParts(eff: TranscriptCopyPrefs, scope: CopyScope): string[] {
  const format = TRANSCRIPT_FORMATS.find((f) => f.key === eff.format) ?? TRANSCRIPT_FORMATS[0]!;
  return [format.label, ...copyIncludes(eff, scope).map((key) => (key === 'keepCut' ? T.keepCut : EXPORT_COPY[key]))];
}

/**
 * 节选（这一章、这一段）的菜单项怎么摆：按复制设置写出来与只要文字一样时（`plain`）只留一项「复制文字」，否则两项，
 * 「按复制设置」的副题是 `summary`。章节头行只在视频有章节时才有，所以按有章节算。
 */
export function useScopeCopy(scope: Exclude<CopyScope, 'all'>): { plain: boolean; summary: string } {
  const prefs = useTranscriptCopyPrefs(useShallow(copyPrefsOf));
  const eff = copyEffective(prefs, { hasChapters: true, translationOnly: false });
  return { plain: scopeIsPlain(eff, scope), summary: copyParts(eff, scope).join(' · ') };
}

/** 范围菜单（这一段、这一章）里的复制项：`copy-set` 按复制设置、`copy` 只要文字；两者一样时只有一项「复制文字」。 */
export function scopeCopyItems(copy: { plain: boolean; summary: string }) {
  if (copy.plain)
    return [
      <MenuItem key="copy" id="copy" textValue={T.copyText}>
        <Copy />
        <Text slot="label">{T.copyText}</Text>
      </MenuItem>,
    ];
  return [
    <MenuItem key="copy-set" id="copy-set" textValue={T.copyWithSettings}>
      <Copy />
      <Text slot="label">{T.copyWithSettings}</Text>
      <Text slot="description">{copy.summary}</Text>
    </MenuItem>,
    <MenuItem key="copy" id="copy" textValue={T.copyTextOnly}>
      <Copy />
      <Text slot="label">{T.copyTextOnly}</Text>
    </MenuItem>,
  ];
}

/**
 * 复制一个节选：`withSettings` 时按记住的组合由面板排（不写标题与文首；这一章照开关写章节标题），否则是当前视图的纯文字。
 * 正文取自面板，剪掉的部分本来就不在里面。`label` 是回执里的范围名。
 */
export function copyScope(input: {
  scope: Exclude<CopyScope, 'all'>;
  label: string;
  paras: readonly CopyParagraph[];
  chapter: { title: string; start: number } | null;
  view: TranscriptView;
  withSettings: boolean;
}): Promise<boolean> {
  const { scope, paras, view } = input;
  const eff = copyEffective(copyPrefsOf(useTranscriptCopyPrefs.getState()), { hasChapters: !!input.chapter, translationOnly: false });
  const receipt = copyReceipt(paras, view);
  if (!input.withSettings || scopeIsPlain(eff, scope)) {
    return copyToClipboard(copyText(paras, { view }), T.copied(input.label, [T.textOnly, receipt].join(' · ')));
  }
  const heading = scope === 'chapter' && eff.chapters ? input.chapter : null;
  const text = writeTranscript([{ chapter: heading, paras }], { format: eff.format, view, speakers: eff.speakers, timestamps: eff.timestamps });
  return copyToClipboard(text, T.copied(input.label, [...copyParts(eff, scope), receipt].join(' · ')));
}

/** 面板交给复制钮的东西。 */
export interface TranscriptCopyInput {
  videoId: Id | null;
  /** 已追平、能请 Runtime 排正文。 */
  ready: boolean;
  /** 序列与正文取自的文档的版本：变了预览重排。 */
  revision: string;
  /** 面板里的每份转写，双语与只看译文时配上同一门语言的译文。 */
  sources: readonly { documentId: Id; translationId: Id | null }[];
  view: TranscriptView;
  /** 语言钮上的那个名字（「English」「中文 + English」）。 */
  viewLabel: string;
  hasChapters: boolean;
  chapters: readonly { title: string; start: number }[];
  /** 视频名：只看译文、Markdown 时由面板写的一级标题（与 Runtime 写的同一个）。 */
  title: string | null;
  /** 面板的全部段落（只看译文时由面板排）；用到时才算。 */
  paragraphs(): readonly CopyParagraph[];
  documents: Record<Id, DocumentRecord>;
  disabled: boolean;
}

interface Produced {
  text: string;
  receipt: string;
}

/** 按生效的组合排出全文：只看译文时面板排，其余交给 Runtime（几份转写各排一份、接起来）。 */
async function produceAll(runtime: RuntimeSession, input: TranscriptCopyInput, eff: TranscriptCopyPrefs): Promise<Produced> {
  if (input.view === 'translation') {
    const paras = input.paragraphs().filter((p) => p.translation.trim());
    const sections = eff.chapters ? chapterSections(paras, input.chapters) : [{ chapter: null, paras }];
    const body = writeTranscript(sections, {
      format: eff.format,
      view: 'translation',
      speakers: eff.speakers,
      timestamps: eff.timestamps,
      title: eff.format === 'md' ? input.title : null,
    });
    // 与 Runtime 排出的文件一样以换行结尾。
    return { text: body ? `${body}\n` : '', receipt: copyReceipt(paras, 'translation') };
  }
  if (!input.videoId) return { text: '', receipt: '' };
  const videoId = input.videoId;
  const results = await Promise.all(copyAllSettings(eff, input.sources).map((settings) => runtime.renderTextExport({ videoId, settings })));
  const outputs = results.flatMap((r) => (r.outputs[0] ? [r.outputs[0]] : []));
  const sum = (key: 'entries' | 'cjkCharacters' | 'words') => outputs.reduce((n, o) => n + o[key], 0);
  return { text: outputs.map((o) => o.content).join('\n'), receipt: lengthReceipt(sum('entries'), sum('cjkCharacters'), sum('words')) };
}

function copyFailed(error: unknown, documents: Record<Id, DocumentRecord>) {
  ToastQueue.negative(explainExportError(error, { kind: 'transcript', stage: 'rejected', documents }).title, { timeout: 6000 });
}

/** 面板头上的复制钮与「复制设置」下拉。 */
export function TranscriptCopyButton({ input }: { input: TranscriptCopyInput }) {
  const runtime = useRuntime();
  const prefs = useTranscriptCopyPrefs(useShallow(copyPrefsOf));
  const setPrefs = useTranscriptCopyPrefs((s) => s.set);
  const [open, setOpen] = useState(false);
  const translationOnly = input.view === 'translation';
  const eff = copyEffective(prefs, { hasChapters: input.hasChapters, translationOnly });
  const parts = copyParts(eff, 'all');
  const summary = parts.join(' · ');

  // 弹层开着、已追平时排预览：组合、视图、版本变了重排，晚到的旧结果丢掉。
  const key = open && input.ready ? JSON.stringify([eff, input.view, input.revision, input.sources]) : null;
  const [preview, setPreview] = useState<{ key: string; produced: Produced | null; problem: string | null } | null>(null);
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      produceAll(runtime, input, eff).then(
        (produced) => live && setPreview({ key, produced, problem: null }),
        (error: unknown) =>
          live &&
          setPreview({
            key,
            produced: null,
            problem: explainExportError(error, { kind: 'transcript', stage: 'rejected', documents: input.documents }).title,
          }),
      );
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` 已经包含组合与版本；段落取到了（`paragraphs` 换了）也重排。`input` 每次渲染都是新对象，不进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, key, input.paragraphs]);
  const fresh = !!preview && preview.key === key;

  const finish = async (produced: Produced, fromSettings: boolean) => {
    if (!(await copyToClipboard(produced.text, null))) return;
    const message = T.copied(T.scopeAll, [...parts, produced.receipt].join(' · '));
    ToastQueue.positive(
      message,
      fromSettings
        ? { timeout: 3000 }
        : { timeout: 5000, actionLabel: T.copySettings, onAction: () => setOpen(true), shouldCloseOnAction: true },
    );
  };

  const copy = (fromSettings: boolean) => {
    setOpen(false);
    // 预览已经排好的就直接用它：剪贴板写在这一下点击里（Safari 不认等过异步之后再写）。
    if (fromSettings && fresh && preview.produced) {
      void finish(preview.produced, true);
      return;
    }
    produceAll(runtime, input, eff).then(
      (produced) => finish(produced, fromSettings),
      (error: unknown) => copyFailed(error, input.documents),
    );
  };

  const shown = preview?.produced ?? null;
  const tip = `${T.copyAllHead(input.viewLabel)} · ${summary}`;
  return (
    <span className={pair}>
      <TooltipTrigger>
        <ActionButton isQuiet size="S" aria-label={T.copyMenu} isDisabled={input.disabled} onPress={() => copy(false)}>
          <Copy />
        </ActionButton>
        <Tooltip>{tip}</Tooltip>
      </TooltipTrigger>
      <DialogTrigger isOpen={open} onOpenChange={setOpen}>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" styles={chevron} aria-label={T.copySettings} isDisabled={input.disabled}>
            <ChevronDown />
          </ActionButton>
          <Tooltip>{T.copySettings}</Tooltip>
        </TooltipTrigger>
        <Popover placement="bottom end" aria-label={T.copySettings}>
          <div className={pop}>
            <h3 className={popTitle}>{T.copyAllHead(input.viewLabel)}</h3>
            <div className={formatRow}>
              <span className={formatLabel}>{EXPORT_COPY.format}</span>
              <SegmentedControl
                aria-label={EXPORT_COPY.format}
                selectedKey={prefs.format}
                onSelectionChange={(format) => setPrefs({ format: format as TranscriptCopyPrefs['format'] })}>
                {TRANSCRIPT_FORMATS.map((f) => (
                  <SegmentedControlItem key={f.key} id={f.key}>
                    {f.label}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>
            <TranscriptIncludeChecks
              value={eff}
              disabled={{ frontmatter: prefs.format !== 'md' || translationOnly, chapters: !input.hasChapters, skipCut: translationOnly }}
              onChange={(key, on) => setPrefs({ [key]: on })}
            />
            {translationOnly ? <p className={note}>{T.copyTranslationOnly}</p> : null}
            {fresh && preview.problem ? (
              <p className={note}>{preview.problem}</p>
            ) : (
              // 可滚动的区域要能用键盘到达（tabIndex），读屏按「预览」念出。
              <pre className={previewText({ isStale: !fresh })} tabIndex={0} aria-label={EXPORT_COPY.preview} aria-busy={!fresh}>
                {shown ? shown.text || T.copyEmpty : EXPORT_COPY.previewLoading}
              </pre>
            )}
            <div className={foot}>
              <span className={receiptText}>{fresh && shown ? shown.receipt || '—' : '—'}</span>
              <Button variant="accent" size="S" autoFocus isDisabled={fresh && !!preview.problem} onPress={() => copy(true)}>
                <Copy />
                <Text>{T.copyConfirm}</Text>
              </Button>
            </div>
          </div>
        </Popover>
      </DialogTrigger>
    </span>
  );
}
