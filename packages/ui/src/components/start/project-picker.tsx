import { useId, useRef, useState } from 'react';
import type { Id, Project } from '@baocut/protocol';
import {
  ActionButton,
  Autocomplete,
  Button,
  CustomDialog,
  DialogContainer,
  DialogTrigger,
  Menu,
  MenuItem,
  MenuSection,
  Popover,
  SearchField,
  Text,
  TextField,
  type TextFieldRef,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Close from '@react-spectrum/s2/icons/Close';
import DeviceLaptop from '@react-spectrum/s2/icons/DeviceLaptop';
import Folder from '@react-spectrum/s2/icons/Folder';
import FolderAdd from '@react-spectrum/s2/icons/FolderAdd';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { CREATE_PROJECT_COPY, HOME_COPY } from '../../copy.ts';
import { S } from '../shell-copy.ts';
import { shortenPath } from '../../model/format.ts';
import { afterFolderOpened, createProjectError, folderLabel, matchProjects } from '../../model/project-folder.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useDirectory } from '../../state/directory-store.ts';

// 贴在输入框下沿的托盘：比输入框窄一圈、上边压进输入框底下 12px，看上去和输入框是一个整体（原型 `.home-create__project`）。
// 输入框下面 S2 留的空提示段落已经收掉（app.css `[data-composer-start] p:empty`），这里只压 12px；压多了会被输入框的外框盖住，按钮点不到。
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginX: 16,
  marginTop: -12,
  paddingTop: 16,
  paddingBottom: 4,
  paddingX: 12,
  minWidth: 0,
  backgroundColor: 'gray-75',
  borderBottomStartRadius: 'lg',
  borderBottomEndRadius: 'lg',
});
const device = style({ display: 'inline-flex', alignItems: 'center', gap: 4, font: 'ui-sm', color: 'gray-700', whiteSpace: 'nowrap' });
const path = style({ font: 'ui-sm', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
// 窄的时候先省略路径，项目名尽量完整；名字特别长也只占一半宽。
const picker = style({ flexShrink: 0, maxWidth: '[50%]' });
const panel = style({ display: 'flex', flexDirection: 'column', gap: 4, padding: 8 });
// 项目多了只滚项目这一段，「新建项目…」与「不用项目」一直在底下（原型 `.home-project-menu`）。
const projectList = style({ maxHeight: 240, overflowY: 'auto' });
const noMatch = style({ margin: 0, paddingX: 12, paddingY: 8, font: 'ui-sm', color: 'gray-600' });

/** 菜单里「不用项目」那一项的键（项目的键是项目 id）。 */
const NONE = 'none';

/**
 * 起始页输入框下沿的项目托盘（产品设计 §2.3、§3.2.1；原型 new-agent.jsx `HomeProjectPicker`）：「这台电脑」、项目选择器、项目路径。
 * 选择器的弹层：有项目时顶上是搜索框，下面是项目（按最近活动排，同侧栏，当前那一项打勾），最底下是「新建项目…」与「不用项目」——
 * 会话可以不属于任何项目，不用项目时路径处说明视频放在哪儿。选了哪一项由起始页记在这台电脑上（state/home-memory-store.ts）。
 * `noneDisabled`：编辑器开着某个项目里的视频，新会话只能建在那个项目里（会话要能改这部视频）。
 */
export function ProjectPicker({
  project,
  projects,
  noneDisabled = false,
  onSelect,
}: {
  /** 新会话会建在哪个项目里；null = 不用项目（视频放在会话自己的文件夹里）。 */
  project: Project | null;
  projects: readonly Project[];
  noneDisabled?: boolean;
  onSelect(projectId: Id | null): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const shown = matchProjects(projects, query);
  const selected = [project?.id ?? NONE];
  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery('');
  };
  const choose = (key: string) => {
    openChange(false);
    if (key === 'new') setCreating(true);
    else onSelect(key === NONE ? null : key);
  };
  return (
    <div className={row}>
      <span className={device}>
        <DeviceLaptop />
        {HOME_COPY.thisComputer}
      </span>
      <DialogTrigger isOpen={open} onOpenChange={openChange}>
        <ActionButton isQuiet size="S" styles={picker} aria-label={HOME_COPY.pickProjectLabel(project?.name ?? HOME_COPY.noProjectOption)}>
          <Folder />
          <Text>{project?.name ?? HOME_COPY.noProjectOption}</Text>
        </ActionButton>
        <Popover placement="bottom start" hideArrow padding="none" aria-label={HOME_COPY.pickProject} styles={style({ width: 288 })}>
          <div className={panel}>
            {projects.length ? (
              <Autocomplete inputValue={query} onInputChange={setQuery}>
                <SearchField aria-label={HOME_COPY.searchProjects} placeholder={HOME_COPY.searchProjects} autoFocus />
                {shown.length ? (
                  <div className={projectList}>
                    <Menu aria-label={S.sidebar.projects} selectionMode="single" selectedKeys={selected} onAction={(key) => choose(String(key))}>
                      {shown.map((p) => (
                        <MenuItem key={p.id} id={p.id} textValue={p.name}>
                          <Folder />
                          <Text slot="label">{p.name}</Text>
                        </MenuItem>
                      ))}
                    </Menu>
                  </div>
                ) : (
                  <p className={noMatch}>{HOME_COPY.noMatchingProjects}</p>
                )}
              </Autocomplete>
            ) : null}
            <Menu
              aria-label={HOME_COPY.pickProject}
              selectionMode="single"
              selectedKeys={selected}
              disabledKeys={noneDisabled ? [NONE] : []}
              onAction={(key) => choose(String(key))}>
              <MenuSection>
                <MenuItem id="new" textValue={HOME_COPY.newProject}>
                  <Add />
                  <Text slot="label">{HOME_COPY.newProject}</Text>
                </MenuItem>
                <MenuItem id={NONE} textValue={HOME_COPY.noProjectOption}>
                  <Close />
                  <Text slot="label">{HOME_COPY.noProjectOption}</Text>
                </MenuItem>
              </MenuSection>
            </Menu>
          </div>
        </Popover>
      </DialogTrigger>
      <span className={path} title={project?.path ?? HOME_COPY.noProject}>
        {project ? shortenPath(project.path) : HOME_COPY.noProject}
      </span>
      {creating ? <CreateProjectDialog onClose={() => setCreating(false)} onCreated={(created) => onSelect(created.id)} /> : null}
    </div>
  );
}

const dialogBody = style({ position: 'relative', paddingTop: 32, paddingX: 24, paddingBottom: 24 });
const closeSlot = style({ position: 'absolute', top: 12, insetEnd: 12 });
const dialogHeading = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 24 });
const dialogTitle = style({ font: 'title-lg', margin: 0 });
const mark = style({
  display: 'grid',
  placeItems: 'center',
  size: 48,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
  color: 'gray-800',
});
const form = style({ display: 'flex', flexDirection: 'column', gap: 24 });
const field = style({ width: 'full' });
const location = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
const locationHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, font: 'ui', color: 'gray-800' });
// 选好的文件夹（与浏览器里只读的项目根目录同一个样子）：图标、文件夹名与路径；选好的那一行尾巴上有 ×。
const folderRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 40,
  paddingX: 12,
  paddingY: 4,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  font: 'ui',
  color: 'gray-800',
  boxSizing: 'border-box',
  minWidth: 0,
});
const folderText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const ellipsis = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const folderPath = style({ font: 'ui-sm', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
// 还没选文件夹：一句说明加「添加文件夹」；不选就在项目根目录下新建。
const emptyFolder = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: 16,
  borderRadius: 'default',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui',
  color: 'gray-700',
  textAlign: 'center',
});
const pathNote = style({ margin: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const actions = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 });

/**
 * 创建项目（产品设计 §3.2.1；原型 new-agent.jsx `CreateProjectDialog`），托盘与侧栏的「新建项目…」共用。
 * 「项目文件夹」可以选这台电脑上一个已有的文件夹（只选一个）：选了就把它原样作为项目（`projects.open`，文件不移动、不复制），
 * 名称是显示名，缺省是文件夹名；它本来就是项目时只选中它。不选时在项目根目录（`RuntimeInfo.projectsDir`）下新建一个同名文件夹
 * （`projects.create`，重名时 Runtime 自动加编号）。浏览器里选不了本机文件夹，只能新建。
 */
export function CreateProjectDialog({ onClose, onCreated }: { onClose(): void; onCreated(project: Project): void }) {
  const runtime = useRuntime();
  const projectsDir = useConnection((s) => (s.state.status === 'connected' ? s.state.runtime.projectsDir : null));
  const web = runtime.host.platform === 'web';
  const titleId = useId();
  const [name, setName] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameField = useRef<TextFieldRef>(null);
  const error = createProjectError(name, folder);
  const parent = projectsDir ? shortenPath(projectsDir).replace(/[\\/]+$/, '') : null;
  // Windows 的目录只用 `\`，预览里的新目录照样用它接。
  const sep = parent?.includes('\\') && !parent.includes('/') ? '\\' : '/';

  const pickFolder = async () => {
    try {
      const dir = await runtime.host.pickDirectory();
      if (!dir) return;
      // 按钮换成文件夹行，按钮上的焦点跟着丢了，回车不会创建；先挪回名称框，回车即创建。
      nameField.current?.focus();
      setFolder(dir);
      // 名称还空着就先填上文件夹名，用户可以改成别的显示名。
      if (!name.trim()) setName(folderLabel(dir));
    } catch (failure) {
      ToastQueue.negative(S.sidebar.openFolderFailed((failure as Error).message), { timeout: 5000 });
    }
  };
  const removeFolder = () => {
    if (folder && name === folderLabel(folder)) setName('');
    nameField.current?.focus();
    setFolder(null);
  };

  const create = async (close: () => void) => {
    if (error) {
      setTouched(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      let project: Project;
      if (folder) {
        const known = useDirectory.getState().projects;
        const opened = await runtime.openProject(folder);
        const { existing, rename } = afterFolderOpened(known, opened, name);
        project = rename ? await runtime.updateProject(opened.id, { name: rename }) : opened;
        ToastQueue.positive(existing ? CREATE_PROJECT_COPY.alreadyProject(project.name) : CREATE_PROJECT_COPY.added(project.name), { timeout: 4000 });
      } else {
        project = await runtime.createProject(name.trim());
        ToastQueue.positive(CREATE_PROJECT_COPY.created(project.name), { timeout: 4000 });
      }
      close();
      onCreated(project);
    } catch (failure) {
      ToastQueue.negative(CREATE_PROJECT_COPY.failed((failure as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const note = folder
    ? CREATE_PROJECT_COPY.keepsFiles
    : parent && !error
      ? CREATE_PROJECT_COPY.preview(`${parent}${sep}${name.trim()}${sep}`)
      : null;

  return (
    <DialogContainer onDismiss={onClose}>
      <CustomDialog size="S" padding="none" aria-labelledby={titleId}>
        {({ close }) => (
          <div className={dialogBody}>
            <div className={closeSlot}>
              <ActionButton isQuiet size="S" aria-label={CREATE_PROJECT_COPY.close} onPress={close}>
                <Close />
              </ActionButton>
            </div>
            <div className={dialogHeading}>
              <span className={mark} aria-hidden>
                <Folder />
              </span>
              <h2 id={titleId} className={dialogTitle}>
                {CREATE_PROJECT_COPY.title}
              </h2>
            </div>
            <form
              className={form}
              onSubmit={(event) => {
                event.preventDefault();
                void create(close);
              }}>
              <TextField
                ref={nameField}
                label={CREATE_PROJECT_COPY.name}
                placeholder={folder ? folderLabel(folder) : CREATE_PROJECT_COPY.placeholder}
                value={name}
                // 输入过才显示错误，不在失焦时显示：按「添加文件夹」「取消」会先让名称框失焦，错误提示一出来按钮就往下挪，这一下点空。
                onChange={(next) => {
                  setName(next);
                  setTouched(true);
                }}
                isInvalid={touched && !!error}
                errorMessage={error ?? undefined}
                autoFocus
                maxLength={120}
                styles={field}
              />
              <section className={location} aria-label={CREATE_PROJECT_COPY.folder}>
                <div className={locationHead}>
                  <span>{CREATE_PROJECT_COPY.folder}</span>
                  <span className={device}>
                    <DeviceLaptop />
                    {HOME_COPY.thisComputer}
                  </span>
                </div>
                {folder ? (
                  <div className={folderRow} title={folder}>
                    <Folder />
                    <span className={folderText}>
                      <span className={ellipsis}>{folderLabel(folder)}</span>
                      <span className={folderPath}>{shortenPath(folder)}</span>
                    </span>
                    <ActionButton isQuiet size="S" aria-label={CREATE_PROJECT_COPY.removeFolder} onPress={removeFolder}>
                      <Close />
                    </ActionButton>
                  </div>
                ) : web ? (
                  <div className={folderRow} title={projectsDir ?? undefined}>
                    <FolderOpen />
                    <span className={ellipsis}>{parent ?? '—'}</span>
                  </div>
                ) : (
                  <div className={emptyFolder}>
                    <span>{CREATE_PROJECT_COPY.addFolderHint}</span>
                    <ActionButton size="S" onPress={() => void pickFolder()}>
                      <FolderAdd />
                      <Text>{CREATE_PROJECT_COPY.addFolder}</Text>
                    </ActionButton>
                  </div>
                )}
                {note ? <p className={pathNote}>{note}</p> : null}
              </section>
              <div className={actions}>
                <Button variant="secondary" onPress={close} styles={field}>
                  {CREATE_PROJECT_COPY.cancel}
                </Button>
                <Button variant="accent" type="submit" isDisabled={!!error || (!folder && !projectsDir)} isPending={busy} styles={field}>
                  {CREATE_PROJECT_COPY.create}
                </Button>
              </div>
            </form>
          </div>
        )}
      </CustomDialog>
    </DialogContainer>
  );
}
