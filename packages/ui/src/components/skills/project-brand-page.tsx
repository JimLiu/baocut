import { useState } from 'react';
import Markdown from 'react-markdown';
import type { Id, Project, ProjectBrandDetail, ProjectBrandSummary, SkillOrigin } from '@baocut/protocol';
import { intlLocale, PROJECT_BRAND_FILE } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Badge,
  Button,
  DialogContainer,
  Menu,
  MenuItem,
  MenuTrigger,
  Picker,
  PickerItem,
  ProgressCircle,
  Radio,
  RadioGroup,
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
import More from '@react-spectrum/s2/icons/More';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { fileSizeLabel, skillDisplayName, skillErrorMessage } from '../../model/agent-skills.ts';
import { dateLabel, draftFiles, skillAssets, splitFrontMatter } from '../../model/skills-page.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { createBrandFromSkill, getBrand, openBrandFile, readBrandFile, writeBrand } from '../../runtime/skill-commands.ts';
import { useBrands } from '../../state/brands-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { openHome } from '../start/open-home.ts';
import { useBrandsLoader, useSkillsLoader } from '../use-skills.ts';
import { remarkPlugins } from '../thread/remark-plugins.ts';
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
import { BADGE_COPY, BRAND_COPY, DETAIL_COPY, FILES_COPY, MENU_COPY } from './skills-copy.ts';

type View = 'overview' | 'files';

const rules = style({ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, paddingStart: 20, font: 'ui-sm', color: 'gray-800' });
const ruleTitle = style({ display: 'block', fontWeight: 'bold', color: 'gray-900' });
const ruleBody = style({ display: 'block', font: 'ui-xs', color: 'gray-700' });
const brandDoc = style({ padding: 16, borderRadius: 'lg', backgroundColor: 'gray-50', minWidth: 0, overflowWrap: 'anywhere' });
const create = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 20, maxWidth: '[720px]' });
const createActs = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });
const picker = style({ width: 320, maxWidth: 'full' });
const hint = style({ margin: 0, font: 'ui-xs', color: 'gray-700' });

function brandSource(runtime: ReturnType<typeof useRuntime>, projectId: Id, stamp: string): FileSource {
  return {
    key: `brand:${projectId}@${stamp}`,
    readText: (path) => readBrandFile(runtime, projectId, path).then((f) => f.content),
    openHandle: (path) => openBrandFile(runtime, projectId, path),
  };
}

/** 优先级：你在这条消息里说的 > BRAND.md > 开着的品牌 skill（概览与新建共用）。 */
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
      ToastQueue.neutral(BRAND_COPY.removed(brand.projectName), { timeout: 4000 });
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
            title={BRAND_COPY.removeTitle(removing.brand.projectName)}
            primaryActionLabel={BRAND_COPY.remove}
            cancelLabel={BRAND_COPY.cancel}
            onPrimaryAction={() => void confirm(removing.brand, removing.after)}>
            {BRAND_COPY.removeBody(removing.brand.projectPath)}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    ),
  };
}

/**
 * 品牌行与详情的「更多」：编辑 / 在这个项目里新建会话 / 在文件夹中显示 / 删除 BRAND.md。浏览器里只有新建会话：
 * 其余要写盘或打开本机文件夹。
 */
export function BrandMoreMenu({ brand, label, onRemoved }: { brand: ProjectBrandSummary; label: string; onRemoved?: () => void }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const go = useShell((s) => s.go);
  const remover = useBrandRemove();
  const run = (key: string) => {
    if (key === 'edit') go({ tab: 'skills', brand: brand.projectId, view: 'files' });
    else if (key === 'new') openHome(brand.projectId);
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
          <MenuItem id="new" textValue={BRAND_COPY.newSession}>
            <Add />
            <Text slot="label">{BRAND_COPY.newSession}</Text>
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

/** Skills 页「项目品牌」段头的「给项目加 BRAND.md」：列出还没有的项目，选一个到它的新建页。 */
export function BrandAddMenu({ brands }: { brands: readonly ProjectBrandSummary[] }) {
  const go = useShell((s) => s.go);
  const projects = useDirectory((s) => s.projects);
  const without = projects.filter((p) => !p.archived && !brands.some((b) => b.projectId === p.id));
  if (!without.length) return null;
  return (
    <MenuTrigger align="end">
      <ActionButton isQuiet size="S">
        <Add />
        <Text>{BRAND_COPY.add}</Text>
      </ActionButton>
      <Menu aria-label={BRAND_COPY.pickProject} onAction={(key) => go({ tab: 'skills', brand: String(key) })}>
        {without.map((p) => (
          <MenuItem key={p.id} id={p.id} textValue={p.name}>
            <Folder />
            <Text slot="label">{p.name}</Text>
            <Text slot="description">{p.path}</Text>
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

/**
 * 一个项目的 BRAND.md（`#/skills?dir=<项目>`，原型 page-project-brand.jsx）：有就是详情——概览（一句话、自动用的说明、优先级、
 * brand/ 里的素材、BRAND.md 预览、信息栏）与文件（改了直接存回项目，不分版本）；没有就是新建（空白模板，或从一个 skill 生成）。
 * 浏览器里只看：没有编辑、新建与删除。
 */
export function ProjectBrandPage({ projectId, view, file }: { projectId: Id; view: View; file: string | null }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const replace = useShell((s) => s.replace);
  const go = useShell((s) => s.go);
  const project = useDirectory((s) => s.projects.find((p) => p.id === projectId) ?? null);
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
  if (!project) {
    return (
      <>
        <BackToSkills />
        <PageHead icon={<Folder />} title={BRAND_COPY.notFoundTitle} />
        <p className={quiet}>{BRAND_COPY.projectGone}</p>
      </>
    );
  }
  if (detail.state === 'failed') {
    return (
      <>
        <BackToSkills />
        <PageHead icon={<Folder />} title={BRAND_COPY.detailTitle(project.name)} />
        <p className={quiet}>{FILES_COPY.loadFailed(detail.message)}</p>
      </>
    );
  }
  const brand = detail.value.brand ?? summary;
  if (!brand) {
    return web ? (
      <>
        <BackToSkills />
        <PageHead icon={<Folder />} title={BRAND_COPY.notFoundTitle} />
        <p className={quiet}>{BRAND_COPY.readOnlyWeb}</p>
      </>
    ) : (
      <BrandCreate project={project} />
    );
  }

  const setView = (next: View) => replace({ tab: 'skills', brand: projectId, ...(next === 'files' ? { view: 'files' } : {}) });
  const openFile = (path: string) => replace({ tab: 'skills', brand: projectId, view: 'files', file: path });
  const source = brandSource(runtime, projectId, brand.updatedAt);

  return (
    <>
      <BackToSkills />
      <PageHead
        icon={<Folder />}
        title={BRAND_COPY.detailTitle(project.name)}
        meta={
          <>
            <Badge variant="neutral" fillStyle="subtle" size="S">
              {BADGE_COPY.brand}
            </Badge>
            <span>{[brand.path, BRAND_COPY.auto, dateLabel(brand.updatedAt, intlLocale())].join(' · ')}</span>
          </>
        }
        actions={
          <>
            <BrandMoreMenu brand={brand} label={BRAND_COPY.more} onRemoved={() => go({ tab: 'skills' })} />
            <Button variant="accent" onPress={() => openHome(projectId)}>
              <Add />
              <Text>{BRAND_COPY.newSession}</Text>
            </Button>
          </>
        }
      />
      <Tabs aria-label={BRAND_COPY.detailTitle(project.name)} selectedKey={view} onSelectionChange={(key) => setView(key as View)}>
        <TabList>
          <Tab id="overview">{DETAIL_COPY.overview}</Tab>
          <Tab id="files">{DETAIL_COPY.files(detail.value.files.length)}</Tab>
        </TabList>
        <TabPanel id="overview">
          <BrandOverview project={project} brand={brand} detail={detail.value} source={source} onFile={openFile} />
        </TabPanel>
        <TabPanel id="files">
          <BrandFiles project={project} brand={brand} detail={detail.value} source={source} web={web} selected={file} onSelect={openFile} />
        </TabPanel>
      </Tabs>
    </>
  );
}

function BrandOverview({
  project,
  brand,
  detail,
  source,
  onFile,
}: {
  project: Project;
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
        <p className={stateLine}>{BRAND_COPY.alwaysOn}</p>
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
            [BRAND_COPY.project, project.name],
            [DETAIL_COPY.location, brand.path],
            [DETAIL_COPY.updated, dateLabel(brand.updatedAt, intlLocale())],
            [FILES_COPY.tree, DETAIL_COPY.filesInfo(brand.fileCount, fileSizeLabel(brand.bytes))],
          ]}
        />
        <Note>{BRAND_COPY.fileNote}</Note>
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
  project,
  brand,
  detail,
  source,
  web,
  selected,
  onSelect,
}: {
  project: Project;
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
      await writeBrand(runtime, project.id, edit.changes);
      edit.stop();
      ToastQueue.positive(BRAND_COPY.saved, { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(skillErrorMessage(error, 'brand'), { timeout: 8000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={filesTab}>
      <div className={fileBar}>
        <span className={fileBarLabel}>{BRAND_COPY.fileBar(project.path)}</span>
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

const ORIGIN_ORDER: readonly SkillOrigin[] = ['personal', 'third-party', 'builtin'];

/** 还没有 BRAND.md：空白模板，或从一个 skill 生成（SKILL.md 正文成为 BRAND.md，素材进 brand/，脚本不带）。 */
function BrandCreate({ project }: { project: Project }) {
  const runtime = useRuntime();
  const replace = useShell((s) => s.replace);
  const go = useShell((s) => s.go);
  const skills = useSkillsLoader();
  const [from, setFrom] = useState<'template' | 'skill'>('template');
  const [skillId, setSkillId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // 自己的品牌 skill 在前，内置的放最后。
  const pickable = [...skills.skills].sort((a, b) => ORIGIN_ORDER.indexOf(a.origin) - ORIGIN_ORDER.indexOf(b.origin));
  const target = `${project.path.replace(/[\\/]+$/, '')}${project.path.includes('\\') && !project.path.includes('/') ? '\\' : '/'}${PROJECT_BRAND_FILE}`;

  const submit = async () => {
    setPending(true);
    try {
      if (from === 'skill' && skillId) await createBrandFromSkill(runtime, project.id, skillId);
      else await writeBrand(runtime, project.id, [{ path: PROJECT_BRAND_FILE, text: BRAND_COPY.template(project.name) }]);
      ToastQueue.positive(BRAND_COPY.created(project.name), { timeout: 4000 });
      replace({ tab: 'skills', brand: project.id, view: 'files' });
    } catch (error) {
      ToastQueue.negative(skillErrorMessage(error, 'brand'), { timeout: 8000 });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <BackToSkills />
      <PageHead icon={<Folder />} title={BRAND_COPY.detailTitle(project.name)} />
      <div className={create}>
        <p className={quiet}>{BRAND_COPY.createIntro(target)}</p>
        <RadioGroup label={BRAND_COPY.from} value={from} onChange={(value) => setFrom(value as 'template' | 'skill')}>
          <Radio value="template">{BRAND_COPY.fromTemplate}</Radio>
          <Radio value="skill" isDisabled={!skills.skills.length}>
            {BRAND_COPY.fromSkill}
          </Radio>
        </RadioGroup>
        {from === 'skill' ? (
          <Picker
            label={BRAND_COPY.skill}
            placeholder={BRAND_COPY.skillPlaceholder}
            styles={picker}
            selectedKey={skillId}
            onSelectionChange={(key) => setSkillId(key === null ? null : String(key))}>
            {pickable.map((s) => (
              <PickerItem key={s.id} id={s.id} textValue={skillDisplayName(s)}>
                <Text slot="label">{skillDisplayName(s)}</Text>
                <Text slot="description">{DETAIL_COPY.sourceLabel[s.origin] ?? s.origin}</Text>
              </PickerItem>
            ))}
          </Picker>
        ) : null}
        <p className={hint}>{from === 'skill' ? BRAND_COPY.fromSkillHint : BRAND_COPY.templateHint}</p>
        <Precedence />
        <span className={createActs}>
          <Button variant="accent" isPending={pending} isDisabled={from === 'skill' && !skillId} onPress={() => void submit()}>
            {BRAND_COPY.create}
          </Button>
          <Button variant="secondary" onPress={() => go({ tab: 'skills' })}>
            {BRAND_COPY.cancel}
          </Button>
        </span>
      </div>
    </>
  );
}
