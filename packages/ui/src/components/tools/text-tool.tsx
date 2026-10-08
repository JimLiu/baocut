import { useMemo, useRef, useState } from 'react';
import type { Id, JobRecord } from '@baocut/protocol';
import { ActionButton, Button, Text, ToastQueue } from '@react-spectrum/s2';
import TextIcon from '@react-spectrum/s2/icons/Text';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { textModelLine, textParameters } from '../../model/models-text.ts';
import { listedRecords } from '../../model/tools-records.ts';
import { entryReason } from '../../model/tool-space-input.ts';
import { modelReason, saveTarget, withSaveDir } from '../../model/tool-frame.ts';
import { findOption, initialModelKey, modelOptions } from '../../model/tools-models.ts';
import {
  againTextDraft,
  textSample,
  textCounter,
  textEffortLine,
  textHeaderChip,
  textProblems,
  textRequest,
  textStatus,
} from '../../model/tools-text.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { EmptyCard, PageStatus } from '../models/model-parts.tsx';
import { useNow } from '../use-now.ts';
import { TextRecord } from './text-record.tsx';
import { ModelRow, SaveDirRow } from './tool-frame.tsx';
import {
  BarStatus,
  detailGrow,
  detailOver,
  HeaderChip,
  hintText,
  Section,
  SectionLink,
  SideFoot,
  SideHead,
  submitOnModEnter,
  ToolPage,
  ToolTextArea,
  Workbench,
} from './tool-parts.tsx';
import { SpacePicker } from './tool-video-picker.tsx';
import { FORM_COPY, FRAME_COPY, GALLERY_COPY, RECORD_COPY, TEXT_COPY } from './tools-copy.ts';
import { useSubmitFailed, useToolRecords } from './use-tool-records.ts';
import { useToolStatus } from './use-tool-status.ts';
import { usePreset, useRerun } from './video-tool-parts.tsx';

/*
 * 设计稿 tool-llm.jsx `LlmToolPage kind='text'`（44-104）：一次文本模型调用，不建 Agent 会话、不调工具。
 * 左边按统一骨架（产品设计 §2.7）：说明、生成要求（「填入示例」、字数 / 16,000）、模型（「管理文本模型」去模型页）；右边「生成记录」与「在 Space 中查看」。
 * 提交走 `models.generateText`，记录是 `jobs` 主题里这类任务；结果由 Runtime 列成 Space 的一份文档（架构设计 §5.7）。
 * 可以附上 Space 里的一份文档或字幕（`material`，架构设计 §7.9）；从 Space 查看器带来的条目预先附上。
 */

const lede = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });
const textFoot = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

/** 文本生成（本机或云端的文本模型）。 */
export function TextTool() {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const view = useModels((s) => s.capabilities);
  const draft = useTools((s) => s.text);
  const patch = useTools((s) => s.patchText);
  const records = useToolRecords('generateText');
  const now = useNow(30_000);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [tried, setTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitFailed = useSubmitFailed('generateText', TEXT_COPY.submitFailed);
  const { saveDirectory } = useToolStatus();
  // 「更改…」选的目录只活在这一页（不写回设置）。
  const [saveOverride, setSaveOverride] = useState<string | null>(null);
  // 附带的 Space 条目：`attach` 打开选择器，`entryId` 是选中的那条。只活在这一页。
  const [attach, setAttach] = useState(false);
  const [entryId, setEntryId] = useState<Id | null>(null);
  usePreset('generate-text', (id) => {
    setAttach(true);
    setEntryId(id);
  });
  const entry = useSpace((s) => (attach && entryId ? (s.entries.find((e) => e.id === entryId) ?? null) : null));
  const material = entry && !entryReason(entry) ? { entryId: entry.id, name: entry.name } : null;
  const needEntry = attach && !material;

  const options = useMemo(() => (view ? modelOptions(view, 'generateText') : []), [view]);
  const option = findOption(options, initialModelKey(options, draft.model, view?.generateText.effective ?? null));
  const reason = view ? modelReason(options, option, FRAME_COPY.textNoun) : null;
  const base = reason ? { text: reason, bad: true } : textStatus(draft, option, tried);
  const status = !base.bad && needEntry ? { text: FORM_COPY.needEntry, bad: tried } : base;
  const toSettings = () => go({ tab: 'models', category: 'llm', page: option?.local ? 'local' : 'cloud' });
  // 取消了的不列（可能已经计费的照实留一张），与生成图片一致；空态按列出来的算。
  const shown = listedRecords(records.list);

  const generate = () => {
    setTried(true);
    if (!option || !option.usable || submitting) return;
    const problems = [...textProblems(draft), ...(needEntry ? [FORM_COPY.needEntry] : [])];
    if (problems.length) {
      ToastQueue.neutral(problems[0]!, { timeout: 4000 });
      return;
    }
    setSubmitting(true);
    runtime
      .generateText(withSaveDir(textRequest(draft, option, material), saveTarget(saveDirectory, saveOverride)))
      .then(() => ToastQueue.positive(TEXT_COPY.submitted, { timeout: 3000 }), submitFailed)
      .finally(() => setSubmitting(false));
  };

  const again = (job: JobRecord) => {
    const next = againTextDraft(job);
    if (!next) return;
    patch(next);
    inputRef.current?.focus();
    ToastQueue.neutral(TEXT_COPY.againDone, { timeout: 3000 });
  };
  useRerun('generate-text', again);

  const bar = (
    <>
      <BarStatus text={status.text} bad={status.bad} />
      <Button variant="accent" isDisabled={!option?.usable} isPending={submitting} onPress={generate}>
        <TextIcon />
        <Text>{TEXT_COPY.submit}</Text>
      </Button>
    </>
  );
  const chip = textHeaderChip(option);

  if (!view) {
    return (
      <ToolPage title={TEXT_COPY.title}>
        <PageStatus>{GALLERY_COPY.loading}</PageStatus>
      </ToolPage>
    );
  }

  const counter = textCounter(draft);

  const main = (
    <>
      <p className={lede}>{TEXT_COPY.lede}</p>

      <Section title={TEXT_COPY.inputLabel}>
        <ToolTextArea
          label={TEXT_COPY.inputLabel}
          inputRef={inputRef}
          value={draft.input}
          onChange={(input) => patch({ input })}
          placeholder={TEXT_COPY.inputPlaceholder}
        />
        <div className={textFoot}>
          <span className={counter.over ? detailOver : detailGrow}>{counter.text}</span>
          {draft.input ? (
            <SectionLink onPress={() => patch({ input: '' })}>{TEXT_COPY.clear}</SectionLink>
          ) : (
            <SectionLink onPress={() => patch({ input: textSample() })}>{TEXT_COPY.sample}</SectionLink>
          )}
        </div>
      </Section>

      <Section
        title={TEXT_COPY.material}
        aside={
          attach ? (
            <SectionLink onPress={() => setAttach(false)}>{TEXT_COPY.materialRemove}</SectionLink>
          ) : (
            <SectionLink onPress={() => setAttach(true)}>{TEXT_COPY.materialAdd}</SectionLink>
          )
        }>
        {attach ? (
          <SpacePicker tool="generate-text" data={null} value={entryId} onChange={setEntryId} />
        ) : (
          <span className={detailGrow}>{TEXT_COPY.materialNote}</span>
        )}
        {material ? <span className={detailGrow}>{TEXT_COPY.materialPicked(material.name)}</span> : null}
      </Section>

      <ModelRow
        noun={FRAME_COPY.textNoun}
        manage={TEXT_COPY.manage}
        local={false}
        onSettings={toSettings}
        options={options}
        selected={option}
        disableUnusable
        onSelect={(o) => patch({ model: o.key })}
        factsOf={(o) => textModelLine(o.info)}>
        {option?.usable ? <p className={hintText}>{textEffortLine(textParameters(view), option.info)}</p> : null}
      </ModelRow>
      <SaveDirRow saveDirectory={saveDirectory} override={saveOverride} onChange={setSaveOverride} />
    </>
  );

  const side = (
    <>
      <SideHead
        title={TEXT_COPY.side}
        live={records.live ? RECORD_COPY.live(records.live) : null}
        count={RECORD_COPY.count(shown.length)}
        extra={
          <ActionButton isQuiet size="S" onPress={() => go({ tab: 'space', category: 'document', projectId: null })}>
            <Text>{TEXT_COPY.viewInSpace}</Text>
          </ActionButton>
        }
      />
      {!records.ready ? (
        <PageStatus>{GALLERY_COPY.loading}</PageStatus>
      ) : shown.length ? (
        shown.map((job) => <TextRecord key={job.jobId} job={job} all={records.all} view={view} now={now} onAgain={again} />)
      ) : (
        <EmptyCard icon={<TextIcon />} title={TEXT_COPY.empty} body={TEXT_COPY.emptyBody} />
      )}
      <SideFoot>{TEXT_COPY.sideFoot}</SideFoot>
    </>
  );

  return (
    <ToolPage title={TEXT_COPY.title} bar={bar} chip={chip ? <HeaderChip text={chip} /> : null}>
      <Workbench main={main} side={side} sideLabel={TEXT_COPY.side} onKeyDown={submitOnModEnter(generate)} />
    </ToolPage>
  );
}
