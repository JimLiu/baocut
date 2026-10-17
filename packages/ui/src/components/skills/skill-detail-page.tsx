import { useEffect, useState } from 'react';
import type { SkillDetail, SkillSummary } from '@baocut/protocol';
import { intlLocale, SKILL_FILE } from '@baocut/protocol';
import {
  ActionButton,
  Badge,
  Button,
  Picker,
  PickerItem,
  ProgressCircle,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextField,
  ToastQueue,
} from '@react-spectrum/s2';
import Delete from '@react-spectrum/s2/icons/Delete';
import Download from '@react-spectrum/s2/icons/Download';
import Edit from '@react-spectrum/s2/icons/Edit';
import FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import Play from '@react-spectrum/s2/icons/Play';
import { fileSizeLabel, skillErrorMessage, skillFullName, skillSourceLine } from '../../model/agent-skills.ts';
import { assetCounts, dateLabel, draftFiles, scriptPaths, skillAssets } from '../../model/skills-page.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { getSkill, openSkillFile, readSkillFile, restoreSkill, skillVersions, writeSkill } from '../../runtime/skill-commands.ts';
import { useShell } from '../../state/shell-store.ts';
import { useSkillsLoader } from '../use-skills.ts';
import { SkillMoreMenu, useSkillActions, type SkillActions } from './skill-actions.tsx';
import { AssetGallery, Code, FileBrowser, Note, useLoad, type FileSource } from './skill-files.tsx';
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
  saveNote,
  stateLine,
  useFileDraft,
} from './skill-parts.tsx';
import { BADGE_COPY, DETAIL_COPY, FILES_COPY, LIST_COPY, MENU_COPY, TOAST_COPY } from './skills-copy.ts';

type View = 'overview' | 'files';

function skillSource(runtime: ReturnType<typeof useRuntime>, id: string, revision: number | null, current: boolean): FileSource {
  const at = current ? undefined : (revision ?? undefined);
  return {
    key: `${id}@${revision ?? 'builtin'}`,
    readText: (path) => readSkillFile(runtime, id, path, at).then((f) => f.content),
    openHandle: (path) => openSkillFile(runtime, id, path, at),
  };
}

/**
 * 一个 skill 的详情（`#/skills/<id>`，原型 page-skill-detail.jsx）：页顶返回、名字与标记、开关、更多菜单、「试一下」；
 * 两个页签——概览（描述、开关的意思、素材、Agent 怎么判断用不用、信息栏）与文件（版本、文件树与预览、编辑存成新版本、恢复旧版本）。
 * `?tab=files&file=<路径>` 落在文件页签并选中那个文件。浏览器里只看：没有编辑、恢复与下载。
 */
export function SkillDetailPage({ id, view, file }: { id: string; view: View; file: string | null }) {
  const runtime = useRuntime();
  const actions = useSkillActions();
  const replace = useShell((s) => s.replace);
  const go = useShell((s) => s.go);
  const skills = useSkillsLoader();
  const skill = skills.skills.find((s) => s.id === id) ?? null;
  const detail = useLoad(skill ? `${id}@${skill.revision ?? 'builtin'}:${skill.updatedAt}` : null, () => getSkill(runtime, id));

  if (!skills.loaded) {
    return (
      <>
        <BackToSkills />
        <ProgressCircle isIndeterminate size="S" aria-label={FILES_COPY.loading} />
      </>
    );
  }
  if (!skill) {
    return (
      <>
        <BackToSkills />
        <PageHead icon={<Lightbulb />} title={DETAIL_COPY.notFoundTitle} />
        <p className={quiet}>{DETAIL_COPY.notFoundBody}</p>
      </>
    );
  }

  const name = skillFullName(skill);
  const ready = detail?.state === 'ready' ? detail.value : null;
  const setView = (next: View) => replace({ tab: 'skills', id, ...(next === 'files' ? { view: 'files' } : {}) });
  const openFile = (path: string) => replace({ tab: 'skills', id, view: 'files', file: path });

  return (
    <>
      <BackToSkills />
      <PageHead
        icon={<Lightbulb />}
        title={name}
        meta={
          <>
            {skill.origin === 'third-party' ? (
              <Badge variant="neutral" fillStyle="outline" size="S">
                {BADGE_COPY.github}
              </Badge>
            ) : null}
            <span>
              {[DETAIL_COPY.sourceLabel[skill.origin], skill.revision ? DETAIL_COPY.version(skill.revision) : null, dateLabel(skill.updatedAt, intlLocale())]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </>
        }
        actions={
          <>
            <Switch aria-label={LIST_COPY.enable(name)} isSelected={skill.enabled} onChange={(on) => actions.toggle(skill, on)} />
            <SkillMoreMenu skill={skill} actions={actions} label={MENU_COPY.label} onRemoved={() => go({ tab: 'skills' })} />
            <Button variant="accent" onPress={() => actions.tryIt(skill)}>
              <Play />
              <Text>{DETAIL_COPY.tryIt}</Text>
            </Button>
          </>
        }
      />
      <Tabs aria-label={DETAIL_COPY.tabsLabel} selectedKey={view} onSelectionChange={(key) => setView(key as View)}>
        <TabList>
          <Tab id="overview">{DETAIL_COPY.overview}</Tab>
          <Tab id="files">{DETAIL_COPY.files(skill.fileCount)}</Tab>
        </TabList>
        <TabPanel id="overview">
          {ready ? (
            <Overview skill={skill} detail={ready} onFile={openFile} />
          ) : detail?.state === 'failed' ? (
            <p className={quiet}>{FILES_COPY.loadFailed(detail.message)}</p>
          ) : (
            <ProgressCircle isIndeterminate size="S" aria-label={FILES_COPY.loading} />
          )}
        </TabPanel>
        <TabPanel id="files">
          {ready ? (
            <FilesTab skill={skill} detail={ready} actions={actions} selected={file} onSelect={openFile} />
          ) : detail?.state === 'failed' ? (
            <p className={quiet}>{FILES_COPY.loadFailed(detail.message)}</p>
          ) : (
            <ProgressCircle isIndeterminate size="S" aria-label={FILES_COPY.loading} />
          )}
        </TabPanel>
      </Tabs>
      {actions.dialog}
    </>
  );
}

function Overview({ skill, detail, onFile }: { skill: SkillSummary; detail: SkillDetail; onFile(path: string): void }) {
  const runtime = useRuntime();
  const assets = skillAssets(detail.files);
  const scripts = scriptPaths(detail.files);
  const source = skillSource(runtime, skill.id, skill.revision, true);
  const counts = assetCounts(assets)
    .map((c) => DETAIL_COPY.assetCount(c.count, DETAIL_COPY.assetKind[c.kind]))
    .join(' · ');
  const from = skillSourceLine(skill.source);
  return (
    <div className={overview}>
      <div className={overviewMain}>
        <p className={lead}>{skill.description}</p>
        <p className={stateLine}>{skill.enabled ? DETAIL_COPY.stateOn : DETAIL_COPY.stateOff}</p>
        {skill.origin === 'third-party' ? <Note>{DETAIL_COPY.thirdPartyNote}</Note> : null}
        {assets.length ? (
          <Block title={DETAIL_COPY.assets} aside={counts} hint={DETAIL_COPY.assetsHint}>
            <AssetGallery assets={assets} source={source} onOpen={onFile} />
          </Block>
        ) : null}
        <Block title={DETAIL_COPY.howTitle} hint={DETAIL_COPY.howHint}>
          <Code>{skill.description}</Code>
        </Block>
      </div>
      <aside className={overviewSide} aria-label={DETAIL_COPY.info}>
        <InfoList
          rows={[
            [DETAIL_COPY.source, DETAIL_COPY.sourceLabel[skill.origin] ?? skill.origin],
            skill.revision ? [FILES_COPY.versionPicker, DETAIL_COPY.version(skill.revision)] : null,
            [DETAIL_COPY.updated, dateLabel(skill.updatedAt, intlLocale())],
            [FILES_COPY.tree, DETAIL_COPY.filesInfo(skill.fileCount, fileSizeLabel(skill.bytes))],
            [DETAIL_COPY.location, skill.path],
            from ? [DETAIL_COPY.from, from] : null,
          ]}
        />
        {scripts.length ? <Note>{DETAIL_COPY.scripts(scripts.length)}</Note> : null}
        <ActionButton size="S" onPress={() => onFile(SKILL_FILE)}>
          <FolderOpen />
          <Text>{DETAIL_COPY.viewFiles(skill.fileCount)}</Text>
        </ActionButton>
      </aside>
    </div>
  );
}

function FilesTab({
  skill,
  detail,
  actions,
  selected,
  onSelect,
}: {
  skill: SkillSummary;
  detail: SkillDetail;
  actions: SkillActions;
  selected: string | null;
  onSelect(path: string): void;
}) {
  const runtime = useRuntime();
  const personal = skill.origin === 'personal';
  const current = skill.revision;
  const [revision, setRevision] = useState<number | null>(current);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const edit = useFileDraft();
  useEffect(() => setRevision(current), [current]);

  const versions = useLoad(personal && current ? `${skill.id}@${current}:v` : null, () => skillVersions(runtime, skill.id));
  const isCurrent = revision === current;
  const old = useLoad(!isCurrent && revision ? `${skill.id}@${revision}:old` : null, () => getSkill(runtime, skill.id, revision ?? undefined));
  const files = isCurrent ? detail.files : old?.state === 'ready' ? old.value.files : [];
  const shown = edit.draft ? draftFiles(files, edit.draft) : files;
  const source = skillSource(runtime, skill.id, revision, isCurrent);
  const chosen = shown.find((f) => f.path === selected)?.path ?? SKILL_FILE;

  const save = async () => {
    if (!current || !edit.dirty) return;
    setSaving(true);
    try {
      const { skill: saved } = await writeSkill(runtime, {
        id: skill.id,
        baseRevision: current,
        changes: edit.changes,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      edit.stop();
      setNote('');
      ToastQueue.positive(TOAST_COPY.saved(saved.revision ?? current + 1), { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(skillErrorMessage(error, 'save'), { timeout: 8000 });
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    if (!revision) return;
    try {
      const { skill: saved } = await restoreSkill(runtime, skill.id, revision);
      ToastQueue.positive(TOAST_COPY.restored(revision, saved.revision ?? revision), { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(skillErrorMessage(error, 'restore'), { timeout: 8000 });
    }
  };

  let bar;
  if (edit.draft) {
    bar = (
      <>
        <span className={grow} />
        <AddFilesButton
          onAdd={(list) => {
            edit.add(list);
            if (list[0]) onSelect(list[0].path);
          }}
        />
        <ActionButton
          size="S"
          isDisabled={chosen === SKILL_FILE}
          onPress={() => {
            edit.remove(chosen);
            onSelect(SKILL_FILE);
          }}>
          <Delete />
          <Text>{FILES_COPY.removeFile}</Text>
        </ActionButton>
      </>
    );
  } else {
    const list = versions?.state === 'ready' ? versions.value.versions : [];
    bar = (
      <>
        {skill.origin === 'builtin' ? (
          <span className={fileBarLabel}>{FILES_COPY.builtinBar}</span>
        ) : skill.origin === 'third-party' ? (
          <span className={fileBarLabel}>{FILES_COPY.thirdPartyBar}</span>
        ) : list.length ? (
          <Picker
            aria-label={FILES_COPY.versionPicker}
            size="S"
            selectedKey={String(revision)}
            onSelectionChange={(key) => setRevision(Number(key))}>
            {list.map((v) => (
              <PickerItem key={v.revision} id={String(v.revision)} textValue={FILES_COPY.versionItem(v.revision, v.current)}>
                <Text slot="label">{FILES_COPY.versionItem(v.revision, v.current)}</Text>
                <Text slot="description">
                  {[dateLabel(v.savedAt, intlLocale()), FILES_COPY.versionKind[v.kind], v.note].filter(Boolean).join(' · ')}
                </Text>
              </PickerItem>
            ))}
          </Picker>
        ) : current ? (
          <span className={fileBarLabel}>{DETAIL_COPY.version(current)}</span>
        ) : null}
        <span className={grow} />
        {actions.web ? null : (
          <>
            <ActionButton size="S" onPress={() => actions.download(skill)}>
              <Download />
              <Text>{FILES_COPY.download}</Text>
            </ActionButton>
            {!personal ? (
              <Button variant="secondary" size="S" onPress={() => actions.duplicate(skill)}>
                {FILES_COPY.duplicateToEdit}
              </Button>
            ) : isCurrent ? (
              <Button variant="secondary" size="S" onPress={edit.start}>
                <Edit />
                <Text>{FILES_COPY.edit}</Text>
              </Button>
            ) : (
              <Button variant="accent" size="S" onPress={() => void restore()}>
                {FILES_COPY.restore}
              </Button>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <div className={filesTab}>
      <div className={fileBar}>{bar}</div>
      {!isCurrent && revision && current && !edit.draft ? <Note>{FILES_COPY.oldVersion(revision, current + 1)}</Note> : null}
      {!isCurrent && old?.state !== 'ready' ? (
        old?.state === 'failed' ? (
          <p className={quiet}>{FILES_COPY.loadFailed(old.message)}</p>
        ) : (
          <ProgressCircle isIndeterminate size="S" aria-label={FILES_COPY.loading} />
        )
      ) : (
        <FileBrowser files={shown} first={SKILL_FILE} selected={chosen} onSelect={onSelect} source={source} editing={edit.editing} />
      )}
      {edit.draft && current ? (
        <div className={saveBar}>
          <TextField aria-label={FILES_COPY.noteLabel} placeholder={FILES_COPY.notePlaceholder} value={note} onChange={setNote} styles={saveNote} />
          <Button variant="secondary" onPress={() => (edit.dirty ? setAsking(true) : edit.stop())}>
            {FILES_COPY.cancel}
          </Button>
          <Button variant="accent" isDisabled={!edit.dirty} isPending={saving} onPress={() => void save()}>
            {FILES_COPY.save(current + 1)}
          </Button>
        </div>
      ) : null}
      <DiscardDialog
        open={asking}
        body={FILES_COPY.discardBody(current ?? 1)}
        onDiscard={() => {
          setAsking(false);
          edit.stop();
          setNote('');
        }}
        onClose={() => setAsking(false)}
      />
    </div>
  );
}
