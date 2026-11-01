import { memo, useEffect, useState } from 'react';
import type { AgentQuestion, MediaHandle, QuestionPreview, TimelineItem } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  Checkbox,
  CheckboxGroup,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Radio,
  RadioGroup,
  Text,
  TextArea,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import { Button as RACButton } from 'react-aria-components';
import HelpCircle from '@react-spectrum/s2/icons/HelpCircle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  OTHER_OPTION,
  questionAnswerText,
  questionDecidedLabel,
  questionDraftAnswers,
  questionIsFillIn,
  type QuestionDraft,
} from '../../model/thread.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { conversationVisible, useShell } from '../../state/shell-store.ts';
import { CompactPlayer } from '../media/compact-player.tsx';
import { QUESTION_COPY } from './question-copy.ts';

type Approval = Extract<TimelineItem, { kind: 'approval' }>;
type Question = Extract<Approval['request'], { kind: 'question' }>;

/** 待回答的卡（原型 ui.css `.aquest`）：蓝底、细边，每题一组单选或多选，末尾是「其他」与输入框。 */
const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  paddingX: 16,
  paddingY: 12,
  marginStart: '[var(--bc-agent-indent, 36px)]',
  borderRadius: '[10px]',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'blue-300',
  backgroundColor: 'blue-100',
});
const head = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui', fontWeight: 'bold', color: 'blue-1000' });
const block = style({ display: 'flex', flexDirection: 'column', gap: 4 });
const chip = style({ font: 'ui-xs', fontWeight: 'bold', color: 'gray-700', textTransform: 'uppercase' });
const prompt = style({ margin: 0, font: 'ui', color: 'gray-900', overflowWrap: 'anywhere', userSelect: 'text' });
const optionText = style({ display: 'flex', flexDirection: 'column' });
const optionDesc = style({ font: 'ui-sm', color: 'gray-700' });
/** 带预览的选项（原型 `.aquest__item`）：预览在单选或勾选框下面、跟标签文字对齐，不进标签。 */
const optionItem = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 4, minWidth: 0, alignSelf: 'stretch' });
const thumb = style({
  display: 'block',
  marginStart: 24,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'default',
  overflow: 'clip',
  backgroundColor: 'gray-75',
  cursor: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const thumbImage = style({ display: 'block', maxWidth: '[240px]', maxHeight: '[160px]' });
const player = style({ alignSelf: 'stretch', marginStart: 24, maxWidth: '[360px]', minWidth: 0 });
const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 });
const hint = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });
/** 回答过的提问收成一行 quiet Disclosure，展开是每题与答案。 */
const decided = style({ marginStart: '[var(--bc-agent-indent, 36px)]', alignSelf: 'stretch' });
const decidedTitle = style({ display: 'flex', alignItems: 'center', gap: 4, font: 'ui-sm', color: 'gray-600' });
const decidedBody = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const answerLine = style({ margin: 0, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere', userSelect: 'text' });

/**
 * 智能体的提问（产品设计 §6.6「提问」，原型 agent-thread.jsx `QuestionMsg`）：一道或几道选择题，Agent 停下来等。
 * 「发送回答」要每题都有答案；「跳过」按拒绝结束，Agent 自己拿主意。直接在输入框发消息也算回答（见 conversation-view）。
 * 回答之后卡片收成一行记录，展开是每题的答案。
 */
export const QuestionCard = memo(function QuestionCard({ item, conversationId }: { item: Approval; conversationId: string }) {
  const runtime = useRuntime();
  const request = item.request as Question;
  const [draft, setDraft] = useState<QuestionDraft>({ picked: {}, other: {} });
  const [pending, setPending] = useState<'answer' | 'skip' | null>(null);
  const n = request.questions.length;
  const title = n > 1 ? QUESTION_COPY.titleMany(n) : QUESTION_COPY.title;

  if (item.status !== 'pending') {
    const label = questionDecidedLabel(item);
    return (
      <Disclosure size="S" isQuiet styles={decided}>
        <DisclosureTitle>
          <span className={decidedTitle}>
            <HelpCircle />
            {label} · {request.questions[0]?.header || QUESTION_COPY.kind}
          </span>
        </DisclosureTitle>
        <DisclosurePanel>
          <div className={decidedBody}>
            {request.questions.map((q) => (
              <div key={q.id} className={block}>
                <p className={prompt}>{q.question}</p>
                {item.status === 'accepted' ? <p className={answerLine}>{questionAnswerText(item.answers, q.id)}</p> : null}
              </div>
            ))}
          </div>
        </DisclosurePanel>
      </Disclosure>
    );
  }

  const answers = questionDraftAnswers(request.questions, draft);
  const pick = (id: string, values: string[]) => setDraft((d) => ({ ...d, picked: { ...d.picked, [id]: values } }));
  const write = (id: string, text: string) => setDraft((d) => ({ ...d, other: { ...d.other, [id]: text } }));
  const submit = async (kind: 'answer' | 'skip') => {
    setPending(kind);
    try {
      if (kind === 'answer' && answers) await runtime.answerQuestion(conversationId, item.approvalId, answers);
      else await runtime.respondToApproval(conversationId, item.approvalId, 'decline');
    } catch (error) {
      ToastQueue.negative(QUESTION_COPY.failed((error as Error).message), { timeout: 5000 });
      setPending(null);
    }
  };

  return (
    <div className={card} role="group" aria-label={title}>
      <div className={head}>
        <HelpCircle />
        <span>{title}</span>
      </div>
      {request.questions.map((q) => (
        <QuestionBlock
          key={q.id}
          conversationId={conversationId}
          question={q}
          picked={draft.picked[q.id] ?? []}
          other={draft.other[q.id] ?? ''}
          disabled={pending !== null}
          onPick={(values) => pick(q.id, values)}
          onWrite={(text) => write(q.id, text)}
        />
      ))}
      <div className={actions}>
        <Button size="S" variant="accent" isPending={pending === 'answer'} isDisabled={!answers || pending !== null} onPress={() => submit('answer')}>
          {QUESTION_COPY.submit}
        </Button>
        <ActionButton size="S" isQuiet isDisabled={pending !== null} onPress={() => submit('skip')}>
          <Text>{QUESTION_COPY.skip}</Text>
        </ActionButton>
      </div>
      <p className={hint}>{QUESTION_COPY.hint}</p>
    </div>
  );
});

function QuestionBlock({
  conversationId,
  question: q,
  picked,
  other,
  disabled,
  onPick,
  onWrite,
}: {
  conversationId: string;
  question: AgentQuestion;
  picked: string[];
  other: string;
  disabled: boolean;
  onPick: (values: string[]) => void;
  onWrite: (text: string) => void;
}) {
  const label = q.header ? <span className={chip}>{q.header}</span> : null;
  // 填空题只有一个多行输入框（Pi 的 input 与 editor 在这一层分不出来，一律多行；发送靠按钮，不靠回车）。
  if (questionIsFillIn(q)) {
    return (
      <div className={block}>
        {label}
        <p className={prompt}>{q.question}</p>
        <TextArea
          aria-label={q.question}
          placeholder={QUESTION_COPY.otherPlaceholder}
          value={other}
          onChange={onWrite}
          isDisabled={disabled}
        />
      </div>
    );
  }
  const select = (value: string) =>
    onPick(!q.multiSelect ? [value] : picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value]);
  const options = q.options.map((o) => {
    const control = <OptionLabel key={o.label} value={o.label} label={o.label} description={o.description} multi={q.multiSelect} />;
    if (!o.preview) return control;
    return (
      <div key={o.label} className={optionItem}>
        {control}
        <OptionPreview
          conversationId={conversationId}
          preview={o.preview}
          label={o.label}
          disabled={disabled}
          onSelect={() => select(o.label)}
        />
      </div>
    );
  });
  const otherOption = q.allowOther ? (
    <OptionLabel key={OTHER_OPTION} value={OTHER_OPTION} label={QUESTION_COPY.other} description={null} multi={q.multiSelect} />
  ) : null;
  return (
    <div className={block}>
      {label}
      <p className={prompt}>{q.question}</p>
      {q.multiSelect ? (
        <CheckboxGroup aria-label={q.question} description={QUESTION_COPY.pickMany} value={picked} onChange={onPick} isDisabled={disabled}>
          {options}
          {otherOption}
        </CheckboxGroup>
      ) : (
        <RadioGroup
          aria-label={q.question}
          description={QUESTION_COPY.pickOne}
          value={picked[0] ?? null}
          onChange={(v) => onPick([v])}
          isDisabled={disabled}>
          {options}
          {otherOption}
        </RadioGroup>
      )}
      {q.allowOther && picked.includes(OTHER_OPTION) ? (
        <TextField
          aria-label={QUESTION_COPY.other}
          placeholder={QUESTION_COPY.otherPlaceholder}
          value={other}
          onChange={onWrite}
          isDisabled={disabled}
          autoFocus
        />
      ) : null}
    </div>
  );
}

function OptionLabel({ value, label, description, multi }: { value: string; label: string; description: string | null; multi: boolean }) {
  const content = (
    <span className={optionText}>
      <span>{label}</span>
      {description ? <span className={optionDesc}>{description}</span> : null}
    </span>
  );
  return multi ? <Checkbox value={value}>{content}</Checkbox> : <Radio value={value}>{content}</Radio>;
}

/**
 * 预览的受限句柄，按「会话:路径」记住，离过期不到一分钟就重新要（同 messages.tsx 的已发送图片）：
 * 草稿每变一次卡片就重画，不能每次都去要。
 */
const previewHandles = new Map<string, MediaHandle>();

function usePreviewHandle(conversationId: string, path: string): MediaHandle | null {
  const runtime = useRuntime();
  const key = `${conversationId}:${path}`;
  const cached = previewHandles.get(key);
  const fresh = cached && Date.parse(cached.expiresAt) - Date.now() > 60_000 ? cached : null;
  const [state, setState] = useState<{ key: string; handle: MediaHandle | null; failed: boolean }>({ key, handle: fresh, failed: false });
  const current = state.key === key ? state : { key, handle: fresh, failed: false };

  useEffect(() => {
    if (current.handle || current.failed) return;
    let cancelled = false;
    runtime.resolveMedia({ conversationId, path }).then(
      (handle) => {
        previewHandles.set(key, handle);
        if (!cancelled) setState({ key, handle, failed: false });
      },
      () => {
        if (!cancelled) setState({ key, handle: null, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [runtime, conversationId, path, key, current.handle, current.failed]);

  return current.handle;
}

/**
 * 选项的预览（产品设计 §6.6「提问」）：会话工作目录里的图、视频或音频，经 `media.resolve` 取地址。图点了等于选这一项
 * （键盘仍走单选或勾选框，图不进 Tab 顺序）；视频、音频是正文播放器（与下载卡同一个 `CompactPlayer`），只播不选，会话不在前台时暂停。
 * 取不到或图坏了就不画，选项照样能答。
 */
function OptionPreview({
  conversationId,
  preview,
  label,
  disabled,
  onSelect,
}: {
  conversationId: string;
  preview: QuestionPreview;
  label: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  const handle = usePreviewHandle(conversationId, preview.path);
  const visible = useShell((s) => conversationVisible(s, conversationId));
  const [broken, setBroken] = useState(false);
  if (!handle || broken) return null;
  if (preview.kind === 'image') {
    return (
      <RACButton className={thumb} excludeFromTabOrder isDisabled={disabled} onPress={onSelect}>
        <img className={thumbImage} src={handle.url} alt={label} decoding="async" onError={() => setBroken(true)} />
      </RACButton>
    );
  }
  return (
    <div className={player}>
      <CompactPlayer
        handle={handle}
        fileName={preview.path.split('/').pop() || label}
        kind={preview.kind}
        memoryKey={`question:${conversationId}:${preview.path}`}
        active={visible}
        path={preview.path}
        expandable={false}
      />
    </div>
  );
}
