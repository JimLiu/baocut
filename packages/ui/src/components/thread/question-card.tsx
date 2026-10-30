import { memo, useState } from 'react';
import type { AgentQuestion, TimelineItem } from '@baocut/protocol';
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
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import HelpCircle from '@react-spectrum/s2/icons/HelpCircle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { OTHER_OPTION, questionAnswerText, questionDecidedLabel, questionDraftAnswers, type QuestionDraft } from '../../model/thread.ts';
import { useRuntime } from '../../runtime/context.tsx';
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
  marginStart: 36,
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
const actions = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 });
const hint = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });
/** 回答过的提问收成一行 quiet Disclosure，展开是每题与答案。 */
const decided = style({ marginStart: 36, alignSelf: 'stretch' });
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
  question: q,
  picked,
  other,
  disabled,
  onPick,
  onWrite,
}: {
  question: AgentQuestion;
  picked: string[];
  other: string;
  disabled: boolean;
  onPick: (values: string[]) => void;
  onWrite: (text: string) => void;
}) {
  const options = q.options.map((o) => (
    <OptionLabel key={o.label} value={o.label} label={o.label} description={o.description} multi={q.multiSelect} />
  ));
  const otherOption = q.allowOther ? (
    <OptionLabel key={OTHER_OPTION} value={OTHER_OPTION} label={QUESTION_COPY.other} description={null} multi={q.multiSelect} />
  ) : null;
  const label = q.header ? <span className={chip}>{q.header}</span> : null;
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
