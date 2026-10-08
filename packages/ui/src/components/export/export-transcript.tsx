import { useEffect, useMemo, useState } from 'react';
import type { Id, TranscriptExportFormat } from '@baocut/protocol';
import { ActionButton, Checkbox, Picker, PickerItem, SegmentedControl, SegmentedControlItem, Switch } from '@react-spectrum/s2';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import Copy from '@react-spectrum/s2/icons/Copy';
import Transcript from '@react-spectrum/s2/icons/Transcript';
import Translate from '@react-spectrum/s2/icons/Translate';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { languageName } from '../../model/caption-tracks.ts';
import { defaultFileNames, TRANSCRIPT_FORMATS, transcriptSettings, transcriptSources, type TranscriptForm } from '../../model/export-settings.ts';
import { lengthReceipt } from '../../model/transcript-text.ts';
import { useExportPrefs } from '../../state/export-prefs-store.ts';
import { copyToClipboard } from '../editor/transcript-actions.ts';
import { EXPORT_COPY } from './export-copy.ts';
import { SubmitFoot } from './export-footer.tsx';
import { FileRows, Lane, Lanes, Note, PlaceRow, Quick, QuickField, Sec, SumRow, Summary } from './export-parts.tsx';
import type { ExportEnv, ExportSubmit } from './use-export-submit.ts';
import { useRenderedText } from './use-rendered-text.ts';

/**
 * 「文稿」页（设计稿 export-transcript.jsx、model-transcript.js）：语言、格式、带什么、出去是什么样、摘要。
 *
 * 落到 Runtime（text-export.ts，写法见命令与协议规范 §4.4）的是：主文档（转写，没有时取时间轴上的字幕）、可选一份译文
 * 作双语对照、md / txt，以及五个选项——文首元信息（只 Markdown；勾选跨会话记住，没存过时勾选）、章节标题（来自序列上的
 * 章节标记，视频没有章节时置灰）、段落时间戳、说话人、跳过已剪段（关掉时是剪之前的整份原文，时间按素材算）。
 * 分段与文稿面板同一套规则（`TRANSCRIPT_PARAGRAPH`）。
 * 与设计稿的出入：译文不能单独成稿（主文档只认转写与字幕），原文那一行锁着开；译文一次配一门。
 *
 * 「出去是什么样」的预览、右上角的复制与摘要的篇幅都取 Runtime 不写文件排出的正文（`exports.renderText`），
 * 与导出的文件逐字节相同：预览框固定高度、可滚动，铺全文；复制成功时图标换成绿色对勾，3 秒后换回。
 */

const checks = style({ display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 4 });
const row = style({ marginTop: 12 });
/** 复制成功后对勾停留多久。 */
const COPIED_MS = 3000;
/** 预览框（设计稿 `.xtxpv`）：只读、固定高度、可滚动，小号等宽字铺全文；右上角留出复制按钮的位置。 */
const previewBox = style({ position: 'relative' });
const preview = style({
  font: 'code-sm',
  color: { default: 'gray-800', isStale: 'gray-500' },
  margin: 0,
  boxSizing: 'border-box',
  height: 240,
  paddingStart: 12,
  paddingEnd: 40,
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
const copyButton = style({ position: 'absolute', top: 4, insetEnd: 4 });
const copiedIcon = iconStyle({ color: 'positive' });

export function ExportTranscriptTab({ env, submitter, onClose }: { env: ExportEnv; submitter: ExportSubmit; onClose: () => void }) {
  const sources = useMemo(() => transcriptSources(env.sequence, env.documents), [env.sequence, env.documents]);
  const frontmatter = useExportPrefs((s) => s.transcriptFrontmatter);
  const setFrontmatter = useExportPrefs((s) => s.setTranscriptFrontmatter);
  const [form, setForm] = useState<Omit<TranscriptForm, 'frontmatter'>>(() => ({
    documentId: sources[0]?.documentId ?? null,
    translationId: null,
    format: 'md',
    timestamps: true,
    chapters: true,
    speakers: true,
    skipCut: true,
  }));
  const set = (patch: Partial<Omit<TranscriptForm, 'frontmatter'>>) => setForm((f) => ({ ...f, ...patch }));
  const hasChapters = env.sequence.markers.some((m) => m.kind === 'chapter');
  /** 生效的选项：文首只在 Markdown 时、章节只在视频有章节时算数（摘要也不写一个不存在的东西）。 */
  const effective: TranscriptForm = { ...form, frontmatter: frontmatter && form.format === 'md', chapters: form.chapters && hasChapters };
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const source = sources.find((s) => s.documentId === form.documentId) ?? sources[0] ?? null;
  const translation = source?.translations.find((t) => t.documentId === form.translationId) ?? null;
  const format = TRANSCRIPT_FORMATS.find((f) => f.key === form.format) ?? TRANSCRIPT_FORMATS[0]!;
  const settings = source
    ? transcriptSettings({ ...effective, translationId: translation?.documentId ?? null }, source.documentId, {})
    : null;
  const files = settings ? defaultFileNames(env.videoName, settings, env.documents) : [];
  const sourceLabel = source ? (source.language ? languageName(source.language) : EXPORT_COPY.original) : '';
  const what = source
    ? [
        translation ? EXPORT_COPY.transcriptPair(sourceLabel, translation.label) : sourceLabel,
        format.label,
        effective.frontmatter ? EXPORT_COPY.frontmatter : null,
        effective.chapters ? EXPORT_COPY.chapters : null,
        effective.timestamps ? EXPORT_COPY.timestamps : null,
        effective.speakers ? EXPORT_COPY.speakers : null,
        effective.skipCut ? EXPORT_COPY.skipCut : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '—';
  const rendered = useRenderedText(env, settings, source ? [source.documentId, ...(translation ? [translation.documentId] : [])] : []);
  const shown = rendered.shown;
  const receipt = rendered.output ? lengthReceipt(rendered.output.entries, rendered.output.cjkCharacters, rendered.output.words) : null;
  /** 成功只换图标（绿色对勾），不弹提示；浏览器拒绝时照旧弹负向提示。 */
  const copy = async () => {
    if (rendered.output && (await copyToClipboard(rendered.output.content, null))) setCopied(true);
  };

  return (
    <>
      <Sec first>{EXPORT_COPY.language}</Sec>
      {sources.length > 1 ? (
        <div className={row}>
          <Quick>
            <QuickField label={EXPORT_COPY.sourceDocument}>
              <Picker
                size="S"
                aria-label={EXPORT_COPY.sourceDocument}
                selectedKey={source?.documentId ?? null}
                onSelectionChange={(key) => key !== null && set({ documentId: String(key) as Id, translationId: null })}>
                {sources.map((s) => (
                  <PickerItem key={s.documentId} id={s.documentId}>
                    {s.name}
                  </PickerItem>
                ))}
              </Picker>
            </QuickField>
          </Quick>
        </div>
      ) : null}
      <Lanes label={EXPORT_COPY.language}>
        {source ? (
          <>
            <Lane
              icon={<Transcript />}
              name={`${sourceLabel} · ${EXPORT_COPY.original}`}
              sub={source.name}
              end={<Switch size="S" aria-label={EXPORT_COPY.originalSwitch(source.name)} isSelected isDisabled />}
            />
            {source.translations.map((t) => {
              const on = translation?.documentId === t.documentId;
              return (
                <Lane
                  key={t.documentId}
                  icon={<Translate />}
                  name={`${t.label} · ${EXPORT_COPY.translation}`}
                  sub={env.documents[t.documentId]?.name}
                  off={!on}
                  end={<Switch size="S" aria-label={EXPORT_COPY.translationSwitch(t.label)} isSelected={on} onChange={(next) => set({ translationId: next ? t.documentId : null })} />}
                />
              );
            })}
          </>
        ) : (
          <Lane icon={<Transcript />} name={EXPORT_COPY.noTranscript} sub={EXPORT_COPY.noTranscriptSub} off />
        )}
      </Lanes>
      {source ? <Note>{source.translations.length > 1 ? `${EXPORT_COPY.sourceLocked} · ${EXPORT_COPY.oneTranslation}` : EXPORT_COPY.sourceLocked}</Note> : null}

      <Sec>{EXPORT_COPY.format}</Sec>
      <SegmentedControl aria-label={EXPORT_COPY.format} selectedKey={form.format} onSelectionChange={(key) => set({ format: key as TranscriptExportFormat })}>
        {TRANSCRIPT_FORMATS.map((f) => (
          <SegmentedControlItem key={f.key} id={f.key}>
            {f.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <Note>{format.note}</Note>

      <Sec>{EXPORT_COPY.include}</Sec>
      <div className={checks}>
        <Checkbox size="S" isDisabled={form.format !== 'md'} isSelected={effective.frontmatter} onChange={setFrontmatter}>
          {EXPORT_COPY.frontmatter}
        </Checkbox>
        <Checkbox size="S" isDisabled={!hasChapters} isSelected={effective.chapters} onChange={(chapters) => set({ chapters })}>
          {EXPORT_COPY.chapters}
        </Checkbox>
        <Checkbox size="S" isSelected={form.timestamps} onChange={(timestamps) => set({ timestamps })}>
          {EXPORT_COPY.timestamps}
        </Checkbox>
        <Checkbox size="S" isSelected={form.speakers} onChange={(speakers) => set({ speakers })}>
          {EXPORT_COPY.speakers}
        </Checkbox>
        <Checkbox size="S" isSelected={form.skipCut} onChange={(skipCut) => set({ skipCut })}>
          {EXPORT_COPY.skipCut}
        </Checkbox>
      </div>
      {form.format !== 'md' ? <Note>{EXPORT_COPY.frontmatterMdOnly}</Note> : null}
      {!hasChapters ? <Note>{EXPORT_COPY.transcriptNoChapters}</Note> : null}
      {!form.skipCut ? <Note>{EXPORT_COPY.keepCutNote}</Note> : null}

      <Sec>{EXPORT_COPY.preview}</Sec>
      {rendered.problem ? (
        <Note warn>{rendered.problem.title}</Note>
      ) : (
        <div className={previewBox}>
          {/* 可滚动的区域要能用键盘到达（tabIndex），读屏按「预览」念出。 */}
          <pre
            className={preview({ isStale: rendered.loading })}
            tabIndex={0}
            aria-label={EXPORT_COPY.preview}
            aria-busy={rendered.loading}>
            {!source ? EXPORT_COPY.noTranscript : shown ? shown.content : EXPORT_COPY.previewLoading}
          </pre>
          <ActionButton
            isQuiet
            size="S"
            styles={copyButton}
            aria-label={copied ? EXPORT_COPY.copied : EXPORT_COPY.copyText}
            isDisabled={!rendered.output}
            onPress={() => void copy()}>
            {copied ? <Checkmark styles={copiedIcon} /> : <Copy />}
          </ActionButton>
        </div>
      )}

      <Summary>
        <SumRow label={EXPORT_COPY.willExport}>{what}</SumRow>
        <FileRows names={files} />
        <SumRow label={EXPORT_COPY.transcriptLength}>{receipt ?? '—'}</SumRow>
        <PlaceRow videoId={env.videoId} sourceDir={env.sourceDir} />
      </Summary>

      <SubmitFoot env={env} submitter={submitter} settings={settings} label={EXPORT_COPY.exportTranscript} onClose={onClose} />
    </>
  );
}
