import { useMemo, useState } from 'react';
import type { DriverId } from '@baocut/protocol';
import {
  ActionButton,
  Badge,
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Form,
  Heading,
  SearchField,
  Text,
  TextArea,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ACP_CATALOG, type AcpCatalogEntry } from '../../model/acp-catalog.ts';
import {
  catalogRequest,
  customRequest,
  hasErrors,
  isProviderExists,
  launchLine,
  searchCatalog,
  splitCommand,
  validateCustom,
  type CatalogRow,
  type CustomErrors,
  type CustomForm,
} from '../../model/agent-catalog.ts';
import { addAgentProvider } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { CATALOG_COPY, CUSTOM_DIALOG_COPY } from './agent-copy.ts';
import { SectionHeading } from './agent-panels.tsx';

// 目录卡（settings-agent.css .agcat）：搜索条一行，下面是可滚动的列表，行之间一条分隔线。
const card = style({
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
  overflow: 'hidden',
  minWidth: 0,
});
const searchBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  paddingX: 20,
  paddingY: 16,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
});
const searchField = style({ flexGrow: 1, minWidth: 0 });
const count = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
const list = style({ listStyleType: 'none', margin: 0, padding: 0, maxHeight: 400, overflow: 'auto' });
const row = style({
  display: 'flex',
  alignItems: 'start',
  gap: 12,
  paddingX: 20,
  paddingY: 12,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderTopWidth: { default: 1, ':first-child': 0 },
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 0,
});
const rowText = style({ flexGrow: 1, minWidth: 0 });
const rowHead = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
const rowName = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const rowDesc = style({ marginTop: 4, marginBottom: 0, font: 'ui-sm', color: 'gray-700' });
const rowCmd = style({ display: 'block', marginTop: 4, font: 'code-xs', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const rowAction = style({ flexShrink: 0 });
const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 12,
  padding: 20,
  font: 'ui-sm',
  color: 'gray-700',
});
const webNote = style({ marginTop: 0, marginBottom: 0, font: 'ui-sm', color: 'gray-600' });
// 对话框（.agcat-form）：字段一列、间距 16；说明与底部提示 12px。
const formStack = style({ display: 'flex', flexDirection: 'column', gap: 16 });
const full = style({ width: 'full' });
const lede = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });
const formNote = style({ display: 'flex', alignItems: 'start', gap: 8, marginTop: 16, marginBottom: 0, font: 'ui-sm', color: 'gray-700' });
const noteIcon = style({ display: 'flex', flexShrink: 0, marginTop: 2, '--iconPrimary': { type: 'fill', value: 'gray-700' } });

/**
 * 添加更多 Agent（原型 settings-agent-catalog.jsx，产品设计 §7.6）：内置九家之外，任何说 ACP 的命令行 Agent 都能由用户添加。
 * 一块可搜索的目录，每行一颗「添加」（已添加的换成「已添加」），另有「自定义命令…」对话框。添加之后它是一张普通的 Agent 卡，
 * 由 Runtime 检测；检测到之后与内置的一样进会话选择器。`onAdded(id)` 让列表展开刚加的那张卡。
 * 浏览器里只说明去桌面应用：`agents.addProvider` 不在 Web 白名单里（它决定这台电脑上运行什么命令）。
 */
export function AgentCatalogSection({ onAdded }: { onAdded(id: DriverId): void }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const connected = useConnection((s) => s.state.status === 'connected');
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(false);
  const [adding, setAdding] = useState<DriverId | null>(null);

  // 已添加 = Runtime 列出的用户添加的，加上刚添加、还在首次探测的（还没有探测结果，不在 drivers 里）。
  const known = useMemo(() => [...(drivers ?? []).map((d) => d.id), ...checking], [drivers, checking]);
  const addedIds = useMemo(
    () => new Set([...(drivers ?? []).filter((d) => d.source === 'custom').map((d) => d.id), ...checking]),
    [drivers, checking],
  );
  const rows = useMemo(() => searchCatalog(ACP_CATALOG, query, addedIds), [query, addedIds]);
  const takenIds = useMemo(() => [...known, ...ACP_CATALOG.map((e) => e.id)], [known]);
  const names = useMemo(
    () => Object.fromEntries([...ACP_CATALOG.map((e) => [e.id, e.name]), ...(drivers ?? []).map((d) => [d.id, d.name])]),
    [drivers],
  );

  if (web) {
    return (
      <>
        <SectionHeading title={CATALOG_COPY.heading} />
        <p className={webNote}>{CATALOG_COPY.webNote}</p>
      </>
    );
  }

  const land = (id: DriverId, name: string, isCustom: boolean) => {
    onAdded(id);
    ToastQueue.positive(CATALOG_COPY.landed(name, isCustom), { timeout: 4000 });
  };
  const addEntry = async (entry: AcpCatalogEntry) => {
    setAdding(entry.id);
    try {
      await addAgentProvider(runtime, catalogRequest(entry));
      land(entry.id, entry.name, false);
    } catch (error) {
      ToastQueue.negative(CATALOG_COPY.addFailed((error as Error).message), { timeout: 5000 });
    } finally {
      setAdding(null);
    }
  };

  return (
    <section aria-labelledby="agent-catalog-title">
      <SectionHeading
        title={CATALOG_COPY.heading}
        hint={CATALOG_COPY.hint}
        action={
          <ActionButton isQuiet size="S" isDisabled={!connected} onPress={() => setCustom(true)}>
            <Add />
            <Text>{CATALOG_COPY.custom}</Text>
          </ActionButton>
        }
      />
      <div className={card}>
        <div className={searchBar}>
          <SearchField
            aria-label={CATALOG_COPY.search}
            placeholder={CATALOG_COPY.searchPlaceholder}
            value={query}
            onChange={setQuery}
            styles={searchField}
          />
          <span className={count}>{query.trim() ? CATALOG_COPY.found(rows.length) : CATALOG_COPY.count(ACP_CATALOG.length)}</span>
        </div>
        {rows.length ? (
          <ul className={list} aria-label={CATALOG_COPY.list}>
            {rows.map((entry) => (
              <CatalogItem
                key={entry.id}
                entry={entry}
                pending={adding === entry.id}
                isDisabled={!connected || adding !== null}
                onAdd={() => void addEntry(entry)}
              />
            ))}
          </ul>
        ) : (
          <div className={empty}>
            <span>{CATALOG_COPY.empty(query.trim())}</span>
            <Button variant="secondary" size="S" isDisabled={!connected} onPress={() => setCustom(true)}>
              <Add />
              <Text>{CATALOG_COPY.custom}</Text>
            </Button>
          </div>
        )}
      </div>
      <CustomAgentDialog
        open={custom}
        takenIds={takenIds}
        names={names}
        onClose={() => setCustom(false)}
        onAdd={async (form) => {
          const request = customRequest(form);
          await addAgentProvider(runtime, request);
          setCustom(false);
          land(request.id, request.name, true);
        }}
      />
    </section>
  );
}

function CatalogItem({ entry, pending, isDisabled, onAdd }: { entry: CatalogRow; pending: boolean; isDisabled: boolean; onAdd(): void }) {
  return (
    <li className={row}>
      <div className={rowText}>
        <div className={rowHead}>
          <span className={rowName}>{entry.name}</span>
          {entry.added ? (
            <Badge variant="positive" size="S" fillStyle="subtle">
              {CATALOG_COPY.added}
            </Badge>
          ) : null}
        </div>
        <p className={rowDesc}>{entry.description}</p>
        <code className={rowCmd}>{launchLine(entry.command, entry.env)}</code>
      </div>
      {entry.added ? null : (
        <Button
          variant="secondary"
          size="S"
          styles={rowAction}
          isPending={pending}
          isDisabled={isDisabled}
          aria-label={CATALOG_COPY.addTo(entry.name)}
          onPress={onAdd}>
          <Add />
          <Text>{CATALOG_COPY.add}</Text>
        </Button>
      )}
    </li>
  );
}

const EMPTY_FORM: CustomForm = { id: '', name: '', command: '', env: '' };

/**
 * 自定义命令（原型 `AgentCustomDialog`）：名字、id、整行命令、可选的环境变量。第一次点「添加」之后错误就地显示，改到对为止；
 * Runtime 以 id 重名拒绝时写回 id 一栏，其余失败写在命令一栏下面，不吞掉已填的内容。状态放在对话框外层（S2 的 Dialog 会把
 * children 在几个 slot 里各渲染一遍）。
 */
function CustomAgentDialog({
  open,
  takenIds,
  names,
  onClose,
  onAdd,
}: {
  open: boolean;
  takenIds: readonly DriverId[];
  names: Readonly<Record<string, string>>;
  onClose(): void;
  onAdd(form: CustomForm): Promise<void>;
}) {
  const [form, setForm] = useState<CustomForm>(EMPTY_FORM);
  const [tried, setTried] = useState(false);
  const [server, setServer] = useState<CustomErrors>({});
  const [pending, setPending] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(EMPTY_FORM);
      setTried(false);
      setServer({});
    }
  }
  const err: CustomErrors = { ...(tried ? validateCustom(form, takenIds, names) : {}), ...server };
  const set = (key: keyof CustomForm) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServer({});
  };
  const parts = splitCommand(form.command);

  const submit = async () => {
    if (pending) return;
    setTried(true);
    if (hasErrors(validateCustom(form, takenIds, names))) return;
    setPending(true);
    try {
      await onAdd(form);
    } catch (error) {
      setServer(
        isProviderExists(error)
          ? { id: CUSTOM_DIALOG_COPY.exists(form.id.trim()) }
          : { command: CATALOG_COPY.addFailed((error as Error).message) },
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <DialogContainer onDismiss={onClose}>
      {open ? (
        <Dialog size="M">
          {({ close }) => (
            <>
              <Heading slot="title">{CUSTOM_DIALOG_COPY.title}</Heading>
              <Content>
                <Form
                  validationBehavior="aria"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}>
                  <div className={formStack}>
                    <p className={lede}>{CUSTOM_DIALOG_COPY.lede}</p>
                    <TextField
                      label={CUSTOM_DIALOG_COPY.name}
                      placeholder={CUSTOM_DIALOG_COPY.namePlaceholder}
                      value={form.name}
                      onChange={set('name')}
                      isInvalid={!!err.name}
                      errorMessage={err.name}
                      isReadOnly={pending}
                      styles={full}
                      autoFocus
                    />
                    <TextField
                      label={CUSTOM_DIALOG_COPY.id}
                      placeholder={CUSTOM_DIALOG_COPY.idPlaceholder}
                      description={CUSTOM_DIALOG_COPY.idHint}
                      value={form.id}
                      onChange={set('id')}
                      isInvalid={!!err.id}
                      errorMessage={err.id}
                      isReadOnly={pending}
                      styles={full}
                    />
                    <TextField
                      label={CUSTOM_DIALOG_COPY.command}
                      placeholder={CUSTOM_DIALOG_COPY.commandPlaceholder}
                      description={
                        parts.length > 1 && !err.command
                          ? CUSTOM_DIALOG_COPY.commandParts(parts[0]!, parts.slice(1))
                          : CUSTOM_DIALOG_COPY.commandHint
                      }
                      value={form.command}
                      onChange={set('command')}
                      isInvalid={!!err.command}
                      errorMessage={err.command}
                      isReadOnly={pending}
                      styles={full}
                      UNSAFE_style={{ fontFamily: 'var(--bc-mono, ui-monospace, monospace)' }}
                    />
                    <TextArea
                      label={CUSTOM_DIALOG_COPY.env}
                      placeholder={CUSTOM_DIALOG_COPY.envPlaceholder}
                      description={CUSTOM_DIALOG_COPY.envHint}
                      value={form.env}
                      onChange={set('env')}
                      isInvalid={!!err.env}
                      errorMessage={err.env}
                      isReadOnly={pending}
                      styles={full}
                    />
                  </div>
                </Form>
                <p className={formNote} role="note">
                  <span className={noteIcon} aria-hidden>
                    <InfoCircle />
                  </span>
                  <span>{CUSTOM_DIALOG_COPY.note}</span>
                </p>
              </Content>
              <ButtonGroup>
                <Button variant="secondary" onPress={close}>
                  {CUSTOM_DIALOG_COPY.cancel}
                </Button>
                <Button variant="accent" isPending={pending} onPress={() => void submit()}>
                  {CUSTOM_DIALOG_COPY.submit}
                </Button>
              </ButtonGroup>
            </>
          )}
        </Dialog>
      ) : null}
    </DialogContainer>
  );
}
