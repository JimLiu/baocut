import type { TimelineItem, TodoItem } from '@baocut/protocol';
import { Disclosure, DisclosurePanel, DisclosureTitle } from '@react-spectrum/s2';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { todoCurrent, todoProgress } from '../../model/agent-todo.ts';
import { TODO_COPY } from './todo-copy.ts';

type TaskItem = Extract<TimelineItem, { kind: 'task' }>;

const box = style({
  marginBottom: 8,
  paddingX: 4,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const summary = style({
  display: 'block',
  minWidth: 0,
  font: 'ui-sm',
  color: 'gray-800',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const list = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 200,
  margin: 0,
  padding: 0,
  overflow: 'auto',
  listStyleType: 'none',
});
const row = style({
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  font: 'ui-sm',
  fontWeight: { default: 'normal', isActive: 'bold' },
  color: { default: 'gray-800', isDone: 'gray-600' },
});
const text = style({ minWidth: 0, overflowWrap: 'anywhere', textDecoration: { default: 'none', isDone: 'line-through' } });
const mark = style({
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  size: 16,
  marginTop: 2,
  boxSizing: 'border-box',
  borderRadius: 'full',
  borderStyle: 'solid',
  borderWidth: { default: 1, isActive: 4, isDone: 0 },
  borderColor: { default: 'gray-400', isActive: 'blue-900' },
  color: 'green-900',
});

/**
 * 智能体的待办（产品设计 §3.2.3「智能体的待办」，原型 agent-todo.jsx `AgentTodoDock`）：会话的任务在跑、智能体列了清单时，
 * 输入框上方一行「已完成 / 总数 · 正在做的」，点开是整份清单。默认收起；换会话时由调用方换 key 收起。任务结束就不显示。
 */
export function TodoDock({ task }: { task: TaskItem | undefined }) {
  const items = task?.status === 'running' ? (task.todo?.items ?? []) : [];
  if (!items.length) return null;
  const C = TODO_COPY;
  const { done, total } = todoProgress(items);
  return (
    <section className={box} aria-label={C.label}>
      <Disclosure isQuiet size="S">
        <DisclosureTitle>
          <span className={summary}>{C.summary(done, total, todoCurrent(items))}</span>
        </DisclosureTitle>
        <DisclosurePanel>
          <ol className={list}>
            {items.map((item, index) => (
              <TodoRow key={index} item={item} />
            ))}
          </ol>
        </DisclosurePanel>
      </Disclosure>
    </section>
  );
}

function TodoRow({ item }: { item: TodoItem }) {
  const state = { isDone: item.status === 'completed', isActive: item.status === 'inProgress' };
  return (
    <li className={row(state)}>
      <span className={mark(state)} role="img" aria-label={TODO_COPY.status[item.status]}>
        {state.isDone ? <Checkmark /> : null}
      </span>
      <span className={text(state)}>{item.text}</span>
    </li>
  );
}
