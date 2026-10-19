import { useState } from 'react';
import Markdown from 'react-markdown';
import type { Id, ProjectBrandDetail, ProjectBrandSummary } from '@baocut/protocol';
import { GLOBAL_BRAND_ID, intlLocale, PROJECT_BRAND_FILE } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Badge,
  Button,
  DialogContainer,
  Menu,
  MenuItem,
  MenuTrigger,
  ProgressCircle,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import Folder from '@react-spectrum/s2/icons/Folder';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
import More from '@react-spectrum/s2/icons/More';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { fileSizeLabel, skillErrorMessage } from '../../model/agent-skills.ts';
import { dateLabel, draftFiles, skillAssets, splitFrontMatter } from '../../model/skills-page.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { getBrand, openBrandFile, readBrandFile, writeBrand } from '../../runtime/skill-commands.ts';
import { useBrands } from '../../state/brands-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { openHome } from '../start/open-home.ts';
import { useBrandsLoader } from '../use-skills.ts';
import { remarkPlugins } from '../thread/remark-plugins.ts';
import { brandFilePath, brandTarget, useBrandMethod, type BrandTarget } from './brand-create.tsx';
import { AssetGallery, FileBrowser, Note, useLoad, type FileSource } from './skill-files.tsx';
import {
  AddFilesButton,
  BackToSkills,
  Block,
  DiscardDialog,
  fileBar,
  fileBarLabel,
  filesTab,
  grow,
  InfoList,
  lead,
  overview,
  overviewMain,
  overviewSide,
  PageHead,
  quiet,
  saveBar,
  stateLine,
  useFileDraft,
} from './skill-parts.tsx';
import { BRAND_COPY, DETAIL_COPY, FILES_COPY, MENU_COPY } from './skills-copy.ts';

type View = 'overview' | 'files';

const rules = style({ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, paddingStart: 20, font: 'ui-sm', color: 'gray-800' });
const ruleTitle = style({ display: 'block', fontWeight: 'bold', color: 'gray-900' });
const ruleBody = style({ display: 'block', font: 'ui-xs', color: 'gray-700' });
const brandDoc = style({ padding: 16, borderRadius: 'lg', backgroundColor: 'gray-50', minWidth: 0, overflowWrap: 'anywhere' });
const create = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 20, maxWidth: '[720px]' });
const createActs = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });

/** 范围的图标：全局是地球，项目是文件夹。 */
const TargetIcon = ({ target }: { target: BrandTarget }) => (target.global ? <GlobeGrid /> : <Folder />);

function brandSource(runtime: ReturnType<typeof useRuntime>, projectId: Id, stamp: string): FileSource {
  return {
    key: `brand:${projectId}@${stamp}`,
    readText: (path) => readBrandFile(runtime, projectId, path).then((f) => f.content),
    openHandle: (path) => openBrandFile(runtime, projectId, path),
  };
}

/** 优先级：你在这条消息里说的 > 项目的 BRAND.md > 全局的 BRAND.md > 开着的品牌 skill（概览与新建共用）。 */
function Precedence() {
  return (
    <Block title={BRAND_COPY.precedenceTitle}>
      <ol className={rules}>
        {BRAND_COPY.precedence.map((r) => (
          <li key={r.title}>
            <span className={ruleTitle}>{r.title}</span>
            <span className={ruleBody}>{r.body}</span>
          </li>
        ))}
      </ol>
    </Block>
  );
}

/** 删除：把 `BRAND.md` 与 `brand/` 移到废纸篓（宿主的 `trashProjectBrand`；浏览器里没有）。 */
function useBrandRemove() {
  const runtime = useRuntime();
  const [removing, setRemoving] = useState<{ brand: ProjectBrandSummary; after?: () => void } | null>(null);
  const trash = runtime.host.trashProjectBrand;
  const confirm = async (brand: ProjectBrandSummary, after?: () => void) => {
    try {
      await trash?.(brand.projectPath);
      useBrands.getState().drop(brand.projectId);
      after?.();
      ToastQueue.neutral(BRAND_COPY.removed(brandTarget(brand).name), { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(skillErrorMessage(error, 'brand'), { timeout: 6000 });
    }
  };
  return {
    available: !!trash,
    ask: (brand: ProjectBrandSummary, after?: () => void) => setRemoving({ brand, ...(after ? { after } : {}) }),
    dialog: (
      <DialogContainer onDismiss={() => setRemoving(null)}>
        {removing ? (
          <AlertDialog
            variant="destructive"
            title={BRAND_COPY.removeTitle(brandTarget(removing.brand).name)}
            primaryActionLabel={BRAND_COPY.remove}
            cancelLabel={BRAND_COPY.cancel}
            onPrimaryAction={() => void confirm(removing.brand, removing.after)}>
            {removing.brand.scope === 'global'
              ? BRAND_COPY.removeBodyGlobal(removing.brand.projectPath)
              : BRAND_COPY.removeBody(removing.brand.projectPath)}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    ),
  };
}

/**
 * 品牌行与详情的「更多」：编辑 / 新建会话（项目的开在那个项目里）/ 在文件夹中显示 / 删除 BRAND.md。浏览器里只有新建会话：
 * 其余要写盘或打开本机文件夹。
 */
export function BrandMoreMenu({ brand, label, onRemoved }: { brand: ProjectBrandSummary; label: string; onRemoved?: () => void }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const go = useShell((s) => s.go);
  const remover = useBrandRemove();
  const global = brand.scope === 'global';
  const newSession = global ? BRAND_COPY.newSessionGlobal : BRAND_COPY.newSession;
  const run = (key: string) => {
    if (key === 'edit') go({ tab: 'skills', brand: brand.projectId, view: 'files' });
    else if (key === 'new') openHome(global ? null : brand.projectId);
    else if (key === 'reveal') void runtime.host.revealPath(brand.path);
    else if (key === 'remove') remover.ask(brand, onRemoved);
  };
  return (
    <>
      <MenuTrigger align="end">
        <ActionButton isQuiet aria-label={label}>
          <More />
        </ActionButton>
        <Menu aria-label={BRAND_COPY.more} onAction={(key) => run(String(key))} disabledKeys={remover.available ? [] : ['remove']}>
          {web ? null : (
            <MenuItem id="edit" textValue={BRAND_COPY.edit}>
              <Edit />
              <Text slot="label">{BRAND_COPY.edit}</Text>
            </MenuItem>
          )}
          <MenuItem id="new" textValue={newSession}>
            <Add />
            <Text slot="label">{newSession}</Text>
          </MenuItem>
          {web ? null : (
            <MenuItem id="reveal" textValue={MENU_COPY.reveal}>
              <FolderOpen />
              <Text slot="label">{MENU_COPY.reveal}</Text>
            </MenuItem>
          )}
          {web ? null : (
            <MenuItem id="remove" textValue={BRAND_COPY.removeLabel}>
              <Delete />
              <Text slot="label">{BRAND_COPY.removeLabel}</Text>
              <Text slot="description">{BRAND_COPY.removeHint}</Text>
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
      {remover.dialog}
    </>
  );
}

/**
 * 一份 BRAND.md（`#/skills?dir=<项目 id 或 global>`，原型 page-project-brand.jsx）：有就是详情——概览（一句话、自动用的说明、
 * 优先级、brand/ 里的素材、BRAND.md 预览、信息栏）与文件（改了直接存回，不分版本）；没有就是新建（默认和 Agent 一起建，
 * 也可以空白模板或从一个 skill 生成）。全局的放在 BaoCut 的数据文件夹，项目的放在项目根目录。浏览器里只看：没有编辑、新建与删除。
 */
export function ProjectBrandPage({ projectId, view, file }: { projectId: Id; view: View; file: string | null }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const replace = useShell((s) => s.replace);
  const go = useShell((s) => s.go);
  const global = projectId === GLOBAL_BRAND_ID;
  const project = useDirectory((s) => (global ? null : (s.projects.find((p) => p.id === projectId) ?? null)));
  const directoryReady = useDirectory((s) => s.ready);
  const brands = useBrandsLoader();
  const summary = brands.brands.find((b) => b.projectId === projectId) ?? null;
  const detail = useLoad(brands.loaded ? `${projectId}@${summary?.updatedAt ?? 'none'}` : null, () => getBrand(runtime, projectId));

  if (!directoryReady || !brands.loaded || !detail || detail.state === 'loading') {
    return (
      <>
        <BackToSkills />
        <ProgressCircle isIndeterminate size="S" aria-label={FILES_COPY.loading} />
      </>
    );
  }
  if (!global && !project) {
    return (
      <>
        <BackToSkills />
        <PageHead icon={<Folder />} title={BRAND_COPY.notFoundTitle} />
        <p className={quiet}>{BRAND_COPY.projectGone}</p>
      </>
    );
  }
  const target: BrandTarget = project
    ? { id: project.id, name: project.name, path: project.path, global: false }
    : { id: GLOBAL_BRAND_ID, name: BRAND_COPY.globalName, path: detail.state === 'ready' ? detail.value.root : '', global: true };
  const title = global ? BRAND_COPY.globalName : BRAND_COPY.detailTitle(target.name);
  if (detail.state === 'failed') {
    return (
      <>
        <BackToSkills />
        <PageHead icon={<TargetIcon target={target} />} title={title} />
        <p className={quiet}>{FILES_COPY.loadFailed(detail.message)}</p>
      </>
    );
  }
  const brand = detail.value.brand ?? summary;
  if (!brand) {
    return web ? (
      <>
        <BackToSkills />
        <PageHead icon={<TargetIcon target={target} />} title={global ? BRAND_COPY.globalName : BRAND_COPY.notFoundTitle} />
        <p className={quiet}>{BRAND_COPY.readOnlyWeb}</p>
      </>
    ) : (
      <BrandCreate target={target} />
    );
  }

  const setView = (next: View) => replace({ tab: 'skills', brand: projectId, ...(next === 'files' ? { view: 'files' } : {}) });
  const openFile = (path: string) => replace({ tab: 'skills', brand: projectId, view: 'files', file: path });
  const source = brandSource(runtime, projectId, brand.updatedAt);
  const scopeLine = global ? BRAND_COPY.scopeLineGlobal : BRAND_COPY.scopeLineProject(target.name);

  return (
    <>
      <BackToSkills />
      <PageHead
        icon={<TargetIcon target={target} />}
        title={title}
        meta={
          <>
            <Badge variant="neutral" fillStyle="subtle" size="S">
              {global ? BRAND_COPY.scopeGlobal : BRAND_COPY.scopeProject}
            </Badge>
            <span>{[scopeLine, brand.path, dateLabel(brand.updatedAt, intlLocale())].join(' · ')}</span>
          </>
        }
        actions={
          <>
            <BrandMoreMenu brand={brand} label={BRAND_COPY.more} onRemoved={() => go({ tab: 'skills' })} />
            <Button variant="accent" onPress={() => openHome(global ? null : projectId)}>
              <Add />
              <Text>{global ? BRAND_COPY.newSessionGlobal : BRAND_COPY.newSession}</Text>
            </Button>
          </>
        }
      />
      <Tabs aria-label={title} selectedKey={view} onSelectionChange={(key) => setView(key as View)}>
        <TabList>
          <Tab id="overview">{DETAIL_COPY.overview}</Tab>
          <Tab id="files">{DETAIL_COPY.files(detail.value.files.length)}</Tab>
        </TabList>
        <TabPanel id="overview">
          <BrandOverview target={target} brand={brand} detail={detail.value} source={source} onFile={openFile} />
        </TabPanel>
        <TabPanel id="files">
          <BrandFiles target={target} brand={brand} detail={detail.value} source={source} web={web} selected={file} onSelect={openFile} />
        </TabPanel>
      </Tabs>
    </>
  );
}

function BrandOverview({
  target,
  brand,
  detail,
  source,
  onFile,
}: {
  target: BrandTarget;
  brand: ProjectBrandSummary;
  detail: ProjectBrandDetail;
  source: FileSource;
  onFile(path: string): void;
}) {
  const assets = skillAssets(detail.files);
  const body = detail.content === null ? '' : splitFrontMatter(detail.content).body;
  return (
    <div className={overview}>
      <div className={overviewMain}>
        {brand.summary ? <p className={lead}>{brand.summary}</p> : null}
        <p className={stateLine}>{target.global ? BRAND_COPY.alwaysOnGlobal : BRAND_COPY.alwaysOn}</p>
        <Precedence />
        {assets.length ? (
          <Block title={DETAIL_COPY.assets} hint={BRAND_COPY.assetsHint}>
            <AssetGallery assets={assets} source={source} onOpen={onFile} />
          </Block>
        ) : null}
        <Block title={PROJECT_BRAND_FILE}>
          <div className={`${brandDoc} bc-md`}>
            <Markdown remarkPlugins={remarkPlugins}>{body}</Markdown>
          </div>
        </Block>
      </div>
      <aside className={overviewSide} aria-label={DETAIL_COPY.info}>
        <InfoList
          rows={[
            target.global ? [BRAND_COPY.where, BRAND_COPY.whereGlobalDesc] : [BRAND_COPY.project, target.name],
            [DETAIL_COPY.location, brand.path],
            [DETAIL_COPY.updated, dateLabel(brand.updatedAt, intlLocale())],
            [FILES_COPY.tree, DETAIL_COPY.filesInfo(brand.fileCount, fileSizeLabel(brand.bytes))],
          ]}
        />
        <Note>{target.global ? BRAND_COPY.fileNoteGlobal : BRAND_COPY.fileNote}</Note>
        <ActionButton size="S" onPress={() => onFile(PROJECT_BRAND_FILE)}>
          <FolderOpen />
          <Text>{BRAND_COPY.viewFiles(brand.fileCount)}</Text>
        </ActionButton>
      </aside>
    </div>
  );
}

/** 文件：没有版本，保存直接写回项目目录；BRAND.md 本身不能在这里删（要删用「更多 › 删除 BRAND.md」）。 */
function BrandFiles({
  target,
  brand,
  detail,
  source,
  web,
  selected,
  onSelect,
}: {
  target: BrandTarget;
  brand: ProjectBrandSummary;
  detail: ProjectBrandDetail;
  source: FileSource;
  web: boolean;
  selected: string | null;
  onSelect(path: string): void;
}) {
  const runtime = useRuntime();
  const edit = useFileDraft();
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const shown = edit.draft ? draftFiles(detail.files, edit.draft) : detail.files;
  const chosen = shown.find((f) => f.path === selected)?.path ?? PROJECT_BRAND_FILE;

  const save = async () => {
    if (!edit.dirty) return;
    setSaving(true);
    try {
      await writeBrand(runtime, target.id, edit.changes);
      edit.stop();
      ToastQueue.positive(target.global ? BRAND_COPY.savedGlobal : BRAND_COPY.saved, { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(skillErrorMessage(error, 'brand'), { timeout: 8000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={filesTab}>
      <div className={fileBar}>
        <span className={fileBarLabel}>{target.global ? BRAND_COPY.fileBarGlobal(target.path) : BRAND_COPY.fileBar(target.path)}</span>
        <span className={grow} />
        {web ? null : edit.draft ? (
          <>
            <AddFilesButton
              brand
              onAdd={(list) => {
                edit.add(list);
                if (list[0]) onSelect(list[0].path);
              }}
            />
            <ActionButton
              size="S"
              isDisabled={chosen === PROJECT_BRAND_FILE}
              onPress={() => {
                edit.remove(chosen);
                onSelect(PROJECT_BRAND_FILE);
              }}>
              <Delete />
              <Text>{FILES_COPY.removeFile}</Text>
            </ActionButton>
          </>
        ) : (
          <>
            <ActionButton size="S" onPress={() => void runtime.host.revealPath(brand.path)}>
              <FolderOpen />
              <Text>{MENU_COPY.reveal}</Text>
            </ActionButton>
            <Button variant="secondary" size="S" onPress={edit.start}>
              <Edit />
              <Text>{BRAND_COPY.edit}</Text>
            </Button>
          </>
        )}
      </div>
      {web ? <Note>{BRAND_COPY.readOnlyWeb}</Note> : null}
      <FileBrowser files={shown} first={PROJECT_BRAND_FILE} selected={chosen} onSelect={onSelect} source={source} editing={edit.editing} />
      {edit.draft ? (
        <div className={saveBar}>
          <span className={grow} />
          <Button variant="secondary" onPress={() => (edit.dirty ? setAsking(true) : edit.stop())}>
            {FILES_COPY.cancel}
          </Button>
          <Button variant="accent" isDisabled={!edit.dirty} isPending={saving} onPress={() => void save()}>
            {FILES_COPY.saveBrand}
          </Button>
        </div>
      ) : null}
      <DiscardDialog
        open={asking}
        body={FILES_COPY.discardBrandBody}
        onDiscard={() => {
          setAsking(false);
          edit.stop();
        }}
        onClose={() => setAsking(false)}
      />
    </div>
  );
}

/** 还没有 BRAND.md（项目菜单、会话页头菜单、列表里的空态来的）：同样先推荐和 Agent 一起建。 */
function BrandCreate({ target }: { target: BrandTarget }) {
  const go = useShell((s) => s.go);
  const method = useBrandMethod();
  const file = brandFilePath(target.path);
  return (
    <>
      <BackToSkills />
      <PageHead icon={<TargetIcon target={target} />} title={target.global ? BRAND_COPY.globalName : BRAND_COPY.detailTitle(target.name)} />
      <div className={create}>
        <p className={quiet}>{target.global ? BRAND_COPY.createIntroGlobal(file) : BRAND_COPY.createIntro(file)}</p>
        {method.picker}
        <Precedence />
        <span className={createActs}>
          <Button variant="accent" isPending={method.pending} isDisabled={!method.ready} onPress={() => void method.submit(target)}>
            {method.cta}
          </Button>
          <Button variant="secondary" onPress={() => go({ tab: 'skills' })}>
            {BRAND_COPY.cancel}
          </Button>
        </span>
      </div>
    </>
  );
}
