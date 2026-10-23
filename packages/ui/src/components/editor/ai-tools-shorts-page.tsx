import { useMemo, useState } from 'react';
import type { DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { NumberField, Picker, PickerItem, Radio, RadioGroup, SegmentedControl, SegmentedControlItem, TextField } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  aiTool,
  intentPrompt,
  SHORTS_COUNTS,
  SHORTS_CUSTOM,
  SHORTS_DEFAULTS,
  SHORTS_FOCUS,
  SHORTS_LENGTHS,
  SHORTS_RATIOS,
  SHORTS_STYLES,
  SHORTS_TRACKS,
  shortsAutoHint,
  shortsFocus,
  shortsFocusOpen,
  shortsLengthRange,
  shortsLines,
  shortsSplitApplies,
  toolEffect,
  toolTemplate,
  type ShortsCount,
  type ShortsFocus,
  type ShortsLength,
  type ShortsRatio,
  type ShortsSettings,
  type ShortsStyle,
  type ShortsTracks,
} from '../../model/ai-tools.ts';
import { speechSpeakers } from '../../model/dub-setup.ts';
import { chapterPieces } from '../../model/export-range.ts';
import { topicUsable } from '../../model/writing-topic.ts';
import { useSemanticStatus } from '../../state/semantic-store.ts';
import { SemanticNote } from '../semantic-note.tsx';
import { AgentGateLine } from './agent-gate-line.tsx';
import { AiToolPrompt, useToolHandoff } from './ai-tool-prompt.tsx';
import { Option, Row, ToolCard } from './ai-tools-agent-page.tsx';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';
import { PanelHead } from './panel-head.tsx';
import { recordShortsRun } from './shorts-runs.ts';
import { useDocumentBodies } from './use-document-body.ts';

const body = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingTop: 12, paddingBottom: 16 });
const secHead = style({ marginTop: 20, marginBottom: 0, font: 'detail', fontWeight: 'bold', color: 'gray-700' });
const rows = style({ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 });
const hint = style({ margin: 0, font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });
const field = style({ width: 'full' });
const pair = style({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' });
const radioSub = style({ display: 'block', paddingStart: 24, marginTop: -2, marginBottom: 4, font: 'ui-xs', color: 'gray-600' });

/**
 * 剪成短视频的参数页（原型 panel-aitools-shorts.jsx `ShortsCutSetup`，产品设计 §5.10「参数页」）：只交给 Agent，所以没有「用」一行；
 * 总是新开一条会话，所以也没有「会话」一行。自上而下：说明卡（找出值得单独发的话题、各剪成一支新的子视频），范围、「已经切过的不再找」与主题，
 * 切成什么样（几支、多长缺省都是「自动」——交给 Agent 按话题定，下面一行说明自动怎么定；画幅），取景（画幅不是保留原画幅时；
 * 「跟着说话的人」要转写里分出 2 个以上说话人，分得出时是缺省，分不出时置灰、缺省回到「自动」；自动或跟着说话的人取景时另有「多人全景时分屏」，缺省开），
 * 字幕（带哪几轨、样式），提示词框（意图句加一行一句的参数，最后一行
 * 「找好就直接创建」可以单独删），主按钮与去向。按下就新开会话发出去，那条会话打开到眼前，工具页回列表；这一轮记下来（`recordShortsRun`），
 * 跑完、切出了子视频时这部视频的 AI 工具 Tab 翻到结果页（ai-tools-shorts-result.tsx）。
 * 视频不属于项目时同样新开会话：新会话与视频所在的那条会话共用工作目录（`planHandoff` 的 `folderOf`），不建项目，子视频建在原视频旁边。
 */
export function ShortsToolPage({
  videoId,
  sequence,
  documents,
  skipDone,
  onBack,
}: {
  videoId: Id;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  /** 结果页「再切几支」进来：勾上「已经切过的不再找」。 */
  skipDone?: boolean;
  onBack(): void;
}) {
  const handoff = useToolHandoff();
  const info = aiTool('shortscut');

  const chapters = useMemo(() => chapterPieces(sequence), [sequence]);
  const [scopeKey, setScopeKey] = useState<string>('all');
  const scopeIndex = chapters.findIndex((c) => c.id === scopeKey);
  const scope = scopeIndex >= 0 ? C.scopeChapter(scopeIndex + 1, chapters[scopeIndex]!.label) : null;

  const hasTranslation = useMemo(() => Object.values(documents).some((d) => d.kind === 'translation'), [documents]);
  const [form, setForm] = useState<ShortsSettings>(() => ({ ...SHORTS_DEFAULTS, ...(skipDone ? { skipDone: true } : {}) }));
  const set = (patch: Partial<ShortsSettings>) => setForm((prev) => ({ ...prev, ...patch }));
  // 取景（短视频分屏设计 §8.1）：用户没选过时跟着这部视频定——转写里分得出 2 个以上说话人就「跟着说话的人」，否则「自动」；
  // 正文还没取到时按分不出算。
  const speeches = useMemo(() => Object.values(documents).filter((d) => d.kind === 'speech' && !!d.sourceAssetId), [documents]);
  const speechBodies = useDocumentBodies(speeches);
  const speakers = useMemo(() => Math.max(0, ...speechBodies.map((b) => (b === undefined ? 0 : speechSpeakers(b).length))), [speechBodies]);
  const [chosenFocus, setChosenFocus] = useState<ShortsFocus | null>(null);
  const s: ShortsSettings = { ...form, focus: shortsFocus(chosenFocus, speakers) };
  const range = shortsLengthRange(s);
  const autoHint = shortsAutoHint(s);

  // 主题（创作辅助集成设计 §2.8）：可空；写了且本机语义能用时提示词多一句，Agent 先用 `speech_relevant` 圈出讲这件事的段落。
  // 没装模型时照常全片分析，写一句原因。
  const [topic, setTopic] = useState('');
  const topicOk = topicUsable(useSemanticStatus().status);
  const topicOn = topicOk && topic.trim() !== '';

  const intent = intentPrompt({ tool: 'shortscut', title: handoff.ref?.name ?? null, scope });
  const template = toolTemplate('shortscut', intent, { lines: shortsLines(s, { hasTranslation, topic: topicOn ? topic : null }) });

  return (
    <>
      <PanelHead title={info.name} back={{ label: C.back, onPress: onBack }} />
      <div className={`${body} bc-scroll`}>
        <ToolCard name={info.name} lines={info.setup ?? [info.desc]} effect={toolEffect('shortscut')} />

        <div className={rows}>
          <Row label={C.scope}>
            <Picker
              aria-label={C.scope}
              size="S"
              styles={field}
              isDisabled={!chapters.length}
              selectedKey={scopeIndex >= 0 ? scopeKey : 'all'}
              onSelectionChange={(key) => setScopeKey(String(key ?? 'all'))}>
              {[
                <PickerItem key="all" id="all">
                  {C.scopeAll}
                </PickerItem>,
                ...chapters.map((c, i) => (
                  <PickerItem key={c.id} id={c.id}>
                    {C.scopeChapter(i + 1, c.label)}
                  </PickerItem>
                )),
              ]}
            </Picker>
            {chapters.length ? null : <p className={hint}>{C.scopeNoChapters}</p>}
          </Row>
          <Option
            label={C.shortsSkipDone}
            sub={s.skipDone ? C.shortsSkipDoneOn : C.shortsSkipDoneOff}
            isSelected={s.skipDone}
            onChange={(on) => set({ skipDone: on })}
          />
          <Row label={C.shortsTopic}>
            <TextField aria-label={C.shortsTopic} size="S" styles={field} placeholder={C.shortsTopicPlaceholder} value={topic} onChange={setTopic} />
            {topic.trim() && !topicOk ? <SemanticNote entry="shorts" /> : <p className={hint}>{topicOn ? C.shortsTopicOn : C.shortsTopicEmpty}</p>}
          </Row>
        </div>

        <h3 className={secHead}>{C.shortsShape}</h3>
        <div className={rows}>
          <Row label={C.shortsCount}>
            <Picker
              aria-label={C.shortsCount}
              size="S"
              styles={field}
              selectedKey={String(s.count)}
              onSelectionChange={(key) => {
                if (key == null) return;
                const next: ShortsCount = key === 'auto' ? 'auto' : Number(key);
                set({ count: next });
              }}>
              {SHORTS_COUNTS.map((c) => (
                <PickerItem key={String(c.key)} id={String(c.key)}>
                  {c.label}
                </PickerItem>
              ))}
            </Picker>
          </Row>
          <Row label={C.shortsLength}>
            <Picker
              aria-label={C.shortsLength}
              size="S"
              styles={field}
              selectedKey={s.length}
              onSelectionChange={(key) => {
                if (!key) return;
                const next = key as ShortsLength;
                // 切到自定义时从眼下这一档的两头起步；从自动切过去时沿用上回自定义的两头。
                const start = range ?? { min: s.lenMin, max: s.lenMax };
                set(next === 'custom' ? { length: next, lenMin: start.min, lenMax: start.max } : { length: next });
              }}>
              {SHORTS_LENGTHS.map((l) => (
                <PickerItem key={l.key} id={l.key}>
                  {l.label}
                </PickerItem>
              ))}
            </Picker>
            {s.length === 'custom' ? (
              <div className={pair}>
                <NumberField
                  aria-label={C.shortsMin}
                  size="S"
                  minValue={SHORTS_CUSTOM.min}
                  maxValue={SHORTS_CUSTOM.max}
                  step={1}
                  formatOptions={{ style: 'unit', unit: 'second', unitDisplay: 'short' }}
                  value={s.lenMin}
                  onChange={(n) => Number.isFinite(n) && set({ lenMin: n })}
                />
                <span className={hint}>{C.shortsTo}</span>
                <NumberField
                  aria-label={C.shortsMax}
                  size="S"
                  minValue={SHORTS_CUSTOM.min}
                  maxValue={SHORTS_CUSTOM.max}
                  step={1}
                  formatOptions={{ style: 'unit', unit: 'second', unitDisplay: 'short' }}
                  value={s.lenMax}
                  onChange={(n) => Number.isFinite(n) && set({ lenMax: n })}
                />
              </div>
            ) : null}
          </Row>
          {autoHint ? <p className={hint}>{autoHint}</p> : null}
          <Row label={C.shortsRatio}>
            <SegmentedControl aria-label={C.shortsRatio} selectedKey={s.ratio} onSelectionChange={(key) => set({ ratio: key as ShortsRatio })}>
              {SHORTS_RATIOS.map((r) => (
                <SegmentedControlItem key={r.key} id={r.key}>
                  {r.label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </Row>
        </div>

        {s.ratio === 'source' ? null : (
          <>
            <h3 className={secHead}>{C.shortsFraming}</h3>
            <div className={rows}>
              <RadioGroup aria-label={C.shortsFraming} size="S" value={s.focus} onChange={(value) => setChosenFocus(value as ShortsFocus)}>
                {SHORTS_FOCUS.map((f) => {
                  const open = shortsFocusOpen(f.key, speakers);
                  return (
                    <div key={f.key}>
                      <Radio value={f.key} isDisabled={!open}>
                        {f.label}
                      </Radio>
                      <span className={radioSub}>{open ? f.sub : f.off}</span>
                    </div>
                  );
                })}
              </RadioGroup>
              {/* 多人全景时分屏（短视频分屏设计 §8.1）：自动与跟着说话的人取景时才有，自己定的取景每支只有一个位置。 */}
              {shortsSplitApplies(s.focus) ? (
                <Option
                  label={C.shortsSplit}
                  sub={s.split ? (s.focus === 'speaker' ? C.shortsSplitSpeakerOn : C.shortsSplitOn) : C.shortsSplitOff}
                  isSelected={s.split}
                  onChange={(on) => set({ split: on })}
                />
              ) : null}
            </div>
          </>
        )}

        <h3 className={secHead}>{C.shortsSubtitles}</h3>
        <div className={rows}>
          {hasTranslation ? (
            <Row label={C.shortsTracks}>
              <SegmentedControl aria-label={C.shortsTracks} selectedKey={s.tracks} onSelectionChange={(key) => set({ tracks: key as ShortsTracks })}>
                {SHORTS_TRACKS.map((t) => (
                  <SegmentedControlItem key={t.key} id={t.key}>
                    {t.label}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </Row>
          ) : (
            <p className={hint}>{C.shortsNoTranslation}</p>
          )}
          <RadioGroup aria-label={C.shortsStyle} size="S" value={s.style} onChange={(value) => set({ style: value as ShortsStyle })}>
            {SHORTS_STYLES.map((t) => (
              <div key={t.key}>
                <Radio value={t.key}>{t.label}</Radio>
                <span className={radioSub}>{t.sub}</span>
              </div>
            ))}
          </RadioGroup>
        </div>

        {handoff.guide ? <AgentGateLine guide={handoff.guide} /> : null}
        <AiToolPrompt
          key="shortscut"
          videoId={videoId}
          tool="shortscut"
          template={template}
          handoff={handoff}
          onDone={onBack}
          onSent={(sent) =>
            recordShortsRun({ conversationId: sent.conversationId, parentVideoId: videoId, taskId: sent.taskId, handedAt: sent.handedAt })
          }
          target="new"
          hint={C.shortsHint}
        />
      </div>
    </>
  );
}
