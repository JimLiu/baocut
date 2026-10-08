import { useId, useState } from 'react';
import type { Id, Project } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  CustomDialog,
  DialogContainer,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Text,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Close from '@react-spectrum/s2/icons/Close';
import DeviceLaptop from '@react-spectrum/s2/icons/DeviceLaptop';
import Folder from '@react-spectrum/s2/icons/Folder';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { CREATE_PROJECT_COPY, HOME_COPY } from '../../copy.ts';
import { shortenPath } from '../../model/format.ts';
import { projectNameError } from '../../model/home-brief.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';

// 贴在输入框下沿的托盘：比输入框窄一圈、上边压进输入框底下 12px，看上去和输入框是一个整体。
// PromptField 在卡片下面还留着一行 24px 的空提示位，一并收掉（原型 `.home-create__project` 的 -36px），两者之间不露白缝。
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginX: 16,
  marginTop: -36,
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

/**
 * 起始页输入框下沿的项目托盘（原型 new-agent.jsx `HomeProjectPicker`）：「这台 Mac」、项目菜单、项目路径。
 * 选一个项目就切到那个项目的起始页；「新建项目」在 Runtime 的项目根目录下建一个同名目录。
 */
export function ProjectPicker({
  project,
  projects,
  onSelect,
}: {
  /** 新会话会建在哪个项目里；null = 临时目录。 */
  project: Project | null;
  projects: readonly Project[];
  onSelect(projectId: Id): void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className={row}>
      <span className={device}>
        <DeviceLaptop />
        {HOME_COPY.thisComputer}
      </span>
      <MenuTrigger>
        <ActionButton isQuiet size="S" aria-label={HOME_COPY.pickProjectLabel(project?.name ?? null)}>
          <Folder />
          <Text>{project?.name ?? HOME_COPY.pickProject}</Text>
        </ActionButton>
        <Menu aria-label={HOME_COPY.pickProject} onAction={(key) => (key === 'new' ? setCreating(true) : onSelect(String(key)))}>
          {projects.length ? (
            <MenuSection>
              {projects.map((p) => (
                <MenuItem key={p.id} id={p.id} textValue={p.name}>
                  <Folder />
                  <Text slot="label">{p.name}</Text>
                  {p.id === project?.id ? <Text slot="description">{HOME_COPY.currentProject}</Text> : null}
                </MenuItem>
              ))}
            </MenuSection>
          ) : null}
          <MenuSection>
            <MenuItem id="new" textValue={HOME_COPY.newProject}>
              <Add />
              <Text slot="label">{HOME_COPY.newProject}</Text>
            </MenuItem>
          </MenuSection>
        </Menu>
      </MenuTrigger>
      {/* 设计稿只在选了项目时写路径；没选时如实说新会话在临时目录里。 */}
      <span className={path} title={project?.path}>
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
const folder = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 40,
  paddingX: 12,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  font: 'ui',
  color: 'gray-800',
  boxSizing: 'border-box',
  minWidth: 0,
});
const folderText = style({ flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
const pathNote = style({ margin: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const actions = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 });

/**
 * 创建项目（原型 new-agent.jsx `CreateProjectDialog`）。Runtime 的 `projects.create` 只收名称，
 * 目录建在项目根目录（`RuntimeInfo.projectsDir`）下、重名时自动加编号；所以保存文件夹只读显示，
 * 设计稿里选父目录的菜单与自定义路径要等合同支持（缺口 §2.10）。
 */
function CreateProjectDialog({ onClose, onCreated }: { onClose(): void; onCreated(project: Project): void }) {
  const runtime = useRuntime();
  const projectsDir = useConnection((s) => (s.state.status === 'connected' ? s.state.runtime.projectsDir : null));
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const error = projectNameError(name);
  const parent = projectsDir ? shortenPath(projectsDir).replace(/[\\/]+$/, '') : null;
  // Windows 的目录只用 `\`，预览里的新目录照样用它接。
  const sep = parent?.includes('\\') && !parent.includes('/') ? '\\' : '/';

  const create = async (close: () => void) => {
    if (error) {
      setTouched(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const project = await runtime.createProject(name.trim());
      ToastQueue.positive(CREATE_PROJECT_COPY.created(project.name), { timeout: 4000 });
      close();
      onCreated(project);
    } catch (failure) {
      ToastQueue.negative(CREATE_PROJECT_COPY.failed((failure as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

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
                label={CREATE_PROJECT_COPY.name}
                placeholder={CREATE_PROJECT_COPY.placeholder}
                value={name}
                onChange={setName}
                onBlur={() => setTouched(true)}
                isInvalid={touched && !!error}
                errorMessage={error ?? undefined}
                autoFocus
                maxLength={120}
                styles={field}
              />
              <section className={location} aria-label={CREATE_PROJECT_COPY.location}>
                <div className={locationHead}>
                  <span>{CREATE_PROJECT_COPY.location}</span>
                  <span className={device}>
                    <DeviceLaptop />
                    {HOME_COPY.thisComputer}
                  </span>
                </div>
                <div className={folder} title={projectsDir ?? undefined}>
                  <FolderOpen />
                  <span className={folderText}>{parent ?? '—'}</span>
                </div>
                {parent && !error ? <p className={pathNote}>{CREATE_PROJECT_COPY.preview(`${parent}${sep}${name.trim()}${sep}`)}</p> : null}
              </section>
              <div className={actions}>
                <Button variant="secondary" onPress={close} styles={field}>
                  {CREATE_PROJECT_COPY.cancel}
                </Button>
                <Button variant="accent" type="submit" isDisabled={!!error || !projectsDir} isPending={busy} styles={field}>
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
