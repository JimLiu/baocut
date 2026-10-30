import { useEffect, useMemo, useState } from 'react';
import type { DriverId, ImportableSession, Project } from '@baocut/protocol';
import {
  Button,
  ButtonGroup,
  Checkbox,
  Content,
  Dialog,
  Heading,
  ListView,
  ListViewItem,
  ProgressCircle,
  SearchField,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { untitled } from '../../copy.ts';
import { filterImportable, importMeta, sourceName, sourceWhere } from '../../model/agent-import.ts';
import { shortenPath } from '../../model/format.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { IMPORT_COPY as I } from './import-copy.ts';

const stack = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const bar = style({ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' });
const single = style({ font: 'ui', fontWeight: 'bold', color: 'gray-800' });
const search = style({ flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 160 });
const where = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const list = style({ height: 280 });
const status = style({ display: 'flex', alignItems: 'center', gap: 8, paddingY: 24, font: 'ui-sm', color: 'gray-700' });
const empty = style({ marginY: 8, font: 'ui-sm', color: 'gray-600' });
const failure = style({ marginY: 8, font: 'ui-sm', color: 'negative-900', overflowWrap: 'anywhere' });
const land = style({ display: 'flex', flexDirection: 'column', gap: 4, font: 'ui-sm', color: 'gray-800' });
const para = style({ margin: 0 });
const warn = style({ display: 'flex', alignItems: 'start', gap: 'text-to-visual', margin: 0, color: 'notice-900' });
const hint = style({ margin: 0, font: 'ui-xs', color: 'gray-600' });
const notes = style({
  marginTop: 4,
  marginBottom: 0,
  paddingStart: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  font: 'ui-xs',
  color: 'gray-600',
});

type Load =
  { status: 'loading' } | { status: 'ready'; sources: DriverId[]; sessions: ImportableSession[] } | { status: 'error'; message: string };
const keyOf = (s: ImportableSession) => `${s.driverId}:${s.nativeId}`;

/**
 * 导入 Claude Code / Codex 的本机会话（产品设计 §3.1「导入外部会话」，原型 agent-import.jsx）。入口在侧栏：项目段头「⋯」列全部，
 * 项目行菜单只列那个项目目录的（`project`）。列表按 Agent 分段（只列本机列得出来的几家），搜第一句与目录；选中一条后写明落在哪：
 * 已是项目就落进去，不是就默认把目录接成项目，目录不在了不能导入。导入过的改成「打开」。浏览器里没有入口（Runtime 不对浏览器开放）。
 */
export function ImportSessionsDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const drivers = useConnection((s) => s.drivers);
  const conversations = useDirectory((s) => s.conversations);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [driverId, setDriverId] = useState<DriverId | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [adopt, setAdopt] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    runtime
      .listImportable(project?.id)
      .then(({ sources, sessions }) => {
        if (!live) return;
        setLoad({ status: 'ready', sources, sessions });
        setDriverId(sources[0] ?? null);
      })
      .catch((error: Error) => live && setLoad({ status: 'error', message: error.message }));
    return () => {
      live = false;
    };
  }, [runtime, project?.id]);

  const sessions = load.status === 'ready' ? load.sessions : [];
  const sources = load.status === 'ready' ? load.sources : [];
  const shown = useMemo(() => filterImportable(sessions, { driverId, query }), [sessions, driverId, query]);
  const item = shown.find((s) => keyOf(s) === picked) ?? null;
  const done = item?.importedAs ? (conversations.find((c) => c.id === item.importedAs) ?? null) : null;
  const nameOf = (id: DriverId) => sourceName(id, drivers?.find((d) => d.id === id)?.name);
  const now = Date.now();

  const run = async () => {
    if (!item || busy) return;
    if (done) {
      onClose();
      go({ tab: 'home', conversationId: done.id, projectId: done.projectId });
      return;
    }
    if (item.landing.kind === 'missing') return;
    setBusy(true);
    try {
      const adopted = item.landing.kind === 'adopt' && adopt;
      const conversation = await runtime.importSession(item.driverId, item.nativeId, adopted);
      onClose();
      go({ tab: 'home', conversationId: conversation.id, projectId: conversation.projectId });
      const into =
        item.landing.kind === 'project' ? item.landing.projectName : adopted && item.landing.kind === 'adopt' ? item.landing.name : null;
      ToastQueue.positive(into ? I.doneProject(into) : I.doneLoose, { timeout: 5000 });
    } catch (error) {
      ToastQueue.negative(I.failed((error as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog size="L">
      {({ close }) => (
        <>
          <Heading slot="title">{project ? I.titleProject(project.name) : I.titleAll}</Heading>
          <Content>
            {load.status === 'loading' ? (
              <div className={status}>
                <ProgressCircle size="S" isIndeterminate aria-label={I.loading} />
                {I.loading}
              </div>
            ) : load.status === 'error' ? (
              <p className={failure}>{I.loadFailed(load.message)}</p>
            ) : !sources.length ? (
              <p className={empty}>{I.noSources}</p>
            ) : (
              <div className={stack}>
                <div className={bar}>
                  {sources.length > 1 ? (
                    <SegmentedControl
                      aria-label={I.sourceLabel}
                      selectedKey={driverId ?? undefined}
                      onSelectionChange={(key) => {
                        setDriverId(String(key));
                        setPicked(null);
                      }}
                    >
                      {sources.map((id) => (
                        <SegmentedControlItem key={id} id={id}>
                          {nameOf(id)}
                        </SegmentedControlItem>
                      ))}
                    </SegmentedControl>
                  ) : (
                    <span className={single}>{nameOf(sources[0]!)}</span>
                  )}
                  <SearchField
                    aria-label={I.search}
                    placeholder={I.searchPlaceholder}
                    size="S"
                    value={query}
                    onChange={setQuery}
                    styles={search}
                  />
                </div>
                <p className={where}>{I.readFrom(driverId ? sourceWhere(driverId) : '', project ? shortenPath(project.path) : null)}</p>
                {shown.length ? (
                  <ListView
                    aria-label={I.listLabel}
                    selectionMode="single"
                    selectionStyle="highlight"
                    selectedKeys={picked ? [picked] : []}
                    onSelectionChange={(keys) => {
                      const key = keys === 'all' ? null : [...keys][0];
                      setPicked(key == null ? null : String(key));
                      setAdopt(true);
                    }}
                    styles={list}
                  >
                    {shown.map((s) => (
                      <ListViewItem key={keyOf(s)} id={keyOf(s)} textValue={s.title || untitled()}>
                        <Text>{s.title || untitled()}</Text>
                        <Text slot="description">{importMeta(s, now)}</Text>
                      </ListViewItem>
                    ))}
                  </ListView>
                ) : (
                  <p className={empty}>{query ? I.noMatch : project ? I.noneInFolder : I.none}</p>
                )}
                {item ? (
                  <div className={land} aria-live="polite">
                    {done ? (
                      <p className={para}>{I.alreadyImported(done.title || untitled())}</p>
                    ) : item.landing.kind === 'project' ? (
                      <p className={para}>{I.intoProject(item.landing.projectName)}</p>
                    ) : item.landing.kind === 'missing' ? (
                      <p className={warn}>
                        <AlertTriangle />
                        {I.missing}
                      </p>
                    ) : (
                      <>
                        <Checkbox isSelected={adopt} onChange={setAdopt}>
                          {I.adopt(shortenPath(item.cwd ?? ''), item.landing.name)}
                        </Checkbox>
                        {adopt ? null : <p className={hint}>{I.noAdopt}</p>}
                      </>
                    )}
                  </div>
                ) : null}
                <ul className={notes}>
                  <li>{I.noteDiverge}</li>
                  <li>{I.noteSettings}</li>
                </ul>
              </div>
            )}
          </Content>
          <ButtonGroup>
            <Button variant="secondary" onPress={close}>
              {I.cancel}
            </Button>
            <Button
              variant="accent"
              isPending={busy}
              isDisabled={!item || (!done && item.landing.kind === 'missing')}
              onPress={() => void run()}
            >
              {done ? I.open : I.import}
            </Button>
          </ButtonGroup>
        </>
      )}
    </Dialog>
  );
}
