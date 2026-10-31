import { useCallback, useEffect, useState } from 'react';
import { BOT_LIMITS, RpcError, type Channel } from '@baocut/protocol';
import { ActionButton, AlertDialog, Button, DialogContainer, ProgressCircle, SegmentedControl, SegmentedControlItem, Text, ToastQueue } from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useShell } from '../../state/shell-store.ts';
import { LatestOnly } from '../../model/latest-only.ts';
import { errorText } from './bot-actions.ts';
import { BOT_COPY as C } from './bot-copy.ts';

const page = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, minWidth: 0 });
const inner = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  flexGrow: 1,
  minHeight: 0,
  width: 'full',
  maxWidth: '[860px]',
  marginX: 'auto',
  paddingX: 24,
  paddingY: 16,
  boxSizing: 'border-box',
});
const head = style({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' });
const heading = style({ margin: 0, flexGrow: 1, font: 'title-lg', color: 'gray-900' });
const lead = style({ margin: 0, font: 'body-sm', color: 'gray-700' });
const editor = style({
  flexGrow: 1,
  minHeight: 240,
  padding: 12,
  boxSizing: 'border-box',
  resize: 'none',
  fontFamily: 'code',
  fontSize: 'code-sm',
  lineHeight: 'code',
  color: 'gray-900',
  backgroundColor: 'gray-25',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-300', isInvalid: 'negative' },
  borderRadius: 'lg',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const foot = style({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' });
const usage = style({ flexGrow: 1, font: 'ui-sm', color: { default: 'gray-600', tone: { warn: 'notice-900', over: 'negative-900' } } });
const conflictBox = style({ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: 12, borderRadius: 'lg', backgroundColor: 'notice-subtle', font: 'ui-sm', color: 'gray-900' });
const conflictText = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexBasis: 240 });
const strong = style({ fontWeight: 'bold' });
const centered = style({ display: 'flex', justifyContent: 'center', padding: 48 });

type Scope = 'channel' | 'user';

interface Store {
  read(): Promise<{ content: string; version: number }>;
  write(content: string, ifVersion: number): Promise<{ version: number }>;
  limit: number;
}

function storeFor(runtime: RuntimeSession, scope: Scope, channelId: string): Store {
  if (scope === 'user')
    return {
      read: () => runtime.client.request('bot.readUserMemory', {}),
      write: (content, ifVersion) => runtime.client.request('bot.writeUserMemory', { content, ifVersion }),
      limit: BOT_LIMITS.userMemoryBytes,
    };
  return {
    read: () => runtime.client.request('channels.readMemory', { id: channelId }),
    write: (content, ifVersion) => runtime.client.request('channels.writeMemory', { id: channelId, content, ifVersion }),
    limit: BOT_LIMITS.channelMemoryBytes,
  };
}

const encoder = new TextEncoder();

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function conflictOf(error: unknown): { content: string; version: number } | null {
  if (!(error instanceof RpcError) || error.code !== 'conflict') return null;
  const details = error.details as { content?: unknown; version?: unknown } | null | undefined;
  return typeof details?.content === 'string' && typeof details.version === 'number' ? { content: details.content, version: details.version } : { content: '', version: -1 };
}

/**
 * 记忆页（BOT-MM-01…04、需求 §11.8）：这个频道的 MEMORY.md 与所有频道共用的用户偏好两个标签。保存时带上读到的版本，
 * 期间被智能体或另一个窗口改过就停下，让你选「载入最新」还是「用我的覆盖」。超过上限不让保存，接近上限时提示。
 */
export function ChannelMemoryPage({ channel }: { channel: Channel }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const [scope, setScope] = useState<Scope>('channel');
  const [loaded, setLoaded] = useState<{ content: string; version: number } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ content: string; version: number } | null>(null);
  const [clearing, setClearing] = useState(false);
  const channelId = channel.id;
  const store = storeFor(runtime, scope, channelId);
  // 读写是异步的：切了标签或频道之后才回来的结果属于原来那份记忆，丢掉，免得把它当成新标签的内容再存回去。
  const scopeKey = `${scope}:${channelId}`;
  const [loads] = useState(() => new LatestOnly(scopeKey));
  const [saves] = useState(() => new LatestOnly(scopeKey));
  loads.setKey(scopeKey);
  saves.setKey(scopeKey);

  const load = useCallback(async () => {
    setLoaded(null);
    setConflict(null);
    const outcome = await loads.run(() => storeFor(runtime, scope, channelId).read());
    if (!outcome) return;
    if (outcome.ok) {
      setLoaded(outcome.value);
      setText(outcome.value.content);
    } else {
      ToastQueue.negative(C.common.failed(errorText(outcome.error)), { timeout: 5000 });
    }
  }, [runtime, scope, channelId, loads]);

  useEffect(() => {
    void load();
  }, [load]);

  const bytes = encoder.encode(text).length;
  const over = bytes > store.limit;
  const near = !over && bytes > store.limit * 0.9;
  const dirty = !!loaded && text !== loaded.content;

  /** `replaceDraft`：清空时把输入框也换成存下的内容；保存草稿时不换，存的过程中接着打的字留着，仍算没保存的修改。 */
  const save = async (content: string, ifVersion: number, replaceDraft = false) => {
    setBusy(true);
    try {
      const outcome = await saves.run(() => store.write(content, ifVersion));
      if (!outcome) return;
      if (outcome.ok) {
        setLoaded({ content, version: outcome.value.version });
        if (replaceDraft) setText(content);
        setConflict(null);
        ToastQueue.positive(C.memory.saved, { timeout: 2500 });
      } else {
        const latest = conflictOf(outcome.error);
        if (latest) setConflict(latest);
        else ToastQueue.negative(C.memory.rejected(errorText(outcome.error)), { timeout: 6000 });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={page} aria-label={C.memory.title}>
      <div className={inner}>
        <div className={head}>
          <ActionButton isQuiet size="S" aria-label={C.detail.back} onPress={() => go({ tab: 'bot', channelId: channel.id, workItemId: null, view: 'channel' })}>
            <ChevronLeft />
          </ActionButton>
          <h1 className={heading}>{`${C.memory.title} · ${channel.name}`}</h1>
          <SegmentedControl aria-label={C.memory.title} selectedKey={scope} isDisabled={busy} onSelectionChange={(key) => setScope(key as Scope)}>
            <SegmentedControlItem id="channel">{C.memory.thisChannel}</SegmentedControlItem>
            <SegmentedControlItem id="user">{C.memory.allChannels}</SegmentedControlItem>
          </SegmentedControl>
        </div>
        <p className={lead}>{scope === 'user' ? C.memory.leadUser : C.memory.lead}</p>
        {conflict ? (
          <div className={conflictBox} role="alert">
            <div className={conflictText}>
              <span className={strong}>{C.memory.conflictTitle}</span>
              <span>{C.memory.conflictBody}</span>
            </div>
            <Button size="S" variant="secondary" onPress={() => void load()}>
              {C.memory.loadLatest}
            </Button>
            {conflict.version >= 0 ? (
              <Button size="S" variant="secondary" fillStyle="outline" isDisabled={over || busy} onPress={() => void save(text, conflict.version)}>
                {C.memory.overwrite}
              </Button>
            ) : null}
          </div>
        ) : null}
        {!loaded ? (
          <div className={centered}>
            <ProgressCircle isIndeterminate aria-label={C.common.loading} />
          </div>
        ) : (
          <textarea
            className={editor({ isInvalid: over })}
            aria-label={scope === 'user' ? C.memory.allChannels : C.memory.thisChannel}
            aria-invalid={over || undefined}
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
        <div className={foot}>
          <span className={usage({ tone: over ? 'over' : near ? 'warn' : undefined })} aria-live="polite">
            {[C.memory.usage(kib(bytes), kib(store.limit)), over ? C.memory.overLimit : near ? C.memory.nearLimit : null].filter(Boolean).join(' · ')}
          </span>
          <Button variant="secondary" fillStyle="outline" isDisabled={!loaded || busy || !loaded.content} onPress={() => setClearing(true)}>
            {C.memory.clear}
          </Button>
          <Button variant="secondary" isDisabled={!dirty || busy} onPress={() => loaded && setText(loaded.content)}>
            {C.memory.discard}
          </Button>
          <Button variant="accent" isDisabled={!dirty || over || busy || !!conflict} isPending={busy} onPress={() => loaded && void save(text, loaded.version)}>
            <Text>{C.memory.save}</Text>
          </Button>
        </div>
      </div>
      <DialogContainer onDismiss={() => setClearing(false)}>
        {clearing && loaded ? (
          <AlertDialog
            variant="destructive"
            title={C.memory.clearTitle}
            primaryActionLabel={C.memory.clearConfirm}
            cancelLabel={C.common.cancel}
            onPrimaryAction={() => void save('', loaded.version, true)}>
            {C.memory.clearBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </section>
  );
}
