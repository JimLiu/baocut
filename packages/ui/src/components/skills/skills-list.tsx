import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { ProjectBrandSummary, SkillSummary } from '@baocut/protocol';
import { intlLocale } from '@baocut/protocol';
import {
  Badge,
  Button,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Menu,
  MenuItem,
  MenuTrigger,
  ProgressCircle,
  SearchField,
  Switch,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import Add from '@react-spectrum/s2/icons/Add';
import Edit from '@react-spectrum/s2/icons/Edit';
import Folder from '@react-spectrum/s2/icons/Folder';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import Link from '@react-spectrum/s2/icons/Link';
import Upload from '@react-spectrum/s2/icons/Upload';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { skillDisplayName, skillDisplaySummary, skillFullName } from '../../model/agent-skills.ts';
import { dateLabel, skillSections } from '../../model/skills-page.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { createSkill, importSkillFromGithub } from '../../runtime/skill-commands.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { SKILLS_COPY } from '../settings/agent-copy.ts';
import { openHome } from '../start/open-home.ts';
import { useBrandsLoader, useSkillsLoader } from '../use-skills.ts';
import { BrandAddMenu, BrandMoreMenu } from './project-brand-page.tsx';
import { SkillMoreMenu, useSkillActions } from './skill-actions.tsx';
import { GithubImportDialog, SkillBlankDialog } from './skill-dialogs.tsx';
import { SkillUploadDialog } from './skill-upload-dialog.tsx';
import { ADD_COPY, BADGE_COPY, BRAND_COPY, LIST_COPY, TOAST_COPY } from './skills-copy.ts';

const root = style({ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 });
const head = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 16 });
const heading = style({ font: 'heading', margin: 0, flexGrow: 1, minWidth: 0 });
const search = style({ width: 200, maxWidth: 'full' });
const lede = style({ marginTop: 0, marginBottom: 24, maxWidth: '[720px]', font: 'body-sm', color: 'gray-700' });
const webNote = style({ marginTop: -12, marginBottom: 24, maxWidth: '[720px]', font: 'ui-sm', color: 'gray-600' });
const section = style({ marginBottom: 32 });
const sectionBar = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 });
const sectionHead = style({ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 0, marginBottom: 8, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const sectionCount = style({ font: 'ui-xs', fontWeight: 'normal', color: 'gray-600' });
const sectionHint = style({ marginTop: 0, marginBottom: 8, maxWidth: '[720px]', font: 'ui-xs', color: 'gray-700' });
const list = style({
  display: 'flex',
  flexDirection: 'column',
  margin: 0,
  padding: 0,
  listStyleType: 'none',
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderXWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
// 一行：整块是「查看」的按钮，开关与更多菜单在右端，不嵌在按钮里（原型 `.skp-row`）。
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minWidth: 0,
  backgroundColor: { default: 'transparent', ':hover': 'gray-50' },
  borderBottomWidth: 1,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const rowMain = style({
  display: 'flex',
  flexGrow: 1,
  alignItems: 'center',
  gap: 12,
  minWidth: 0,
  paddingY: 12,
  paddingStart: 8,
  paddingEnd: 0,
  borderStyle: 'none',
  borderRadius: 'default',
  backgroundColor: 'transparent',
  color: 'inherit',
  font: 'ui',
  textAlign: 'start',
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineOffset: -2,
  outlineColor: 'focus-ring',
});
const icon = style({
  display: 'inline-flex',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  size: 32,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  color: { default: 'gray-800', isOff: 'gray-600' },
});
const rowText = style({ display: 'flex', flexGrow: 1, flexDirection: 'column', gap: 4, minWidth: 0 });
const rowTitle = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const rowName = style({ minWidth: 0, truncate: true, font: 'ui', fontWeight: 'bold', color: { default: 'gray-900', isOff: 'gray-700' } });
const rowSub = style({ truncate: true, font: 'ui-xs', color: 'gray-700' });
const badges = style({ display: { default: 'inline-flex', '@container (max-width: 720px)': 'none' }, flexShrink: 0, alignItems: 'center', gap: 4 });
const rowDate = style({ display: { default: 'block', '@container (max-width: 720px)': 'none' }, flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
const auto = style({ paddingEnd: 4, font: 'ui-xs', color: 'gray-600', whiteSpace: 'nowrap' });
const rowEnd = style({ display: 'flex', flexShrink: 0, alignItems: 'center', gap: 4, paddingEnd: 8 });
const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 8,
  padding: 24,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const emptyTitle = style({ margin: 0, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const emptyBody = style({ margin: 0, maxWidth: '[560px]', font: 'ui-sm', color: 'gray-700' });
const emptyActions = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 });
const none = style({
  margin: 0,
  paddingY: 12,
  paddingX: 8,
  font: 'ui-xs',
  color: 'gray-600',
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderXWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const status = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingY: 48 });
const statusText = style({ margin: 0, font: 'ui-sm', color: 'gray-700' });
const diagList = style({ margin: 0, paddingStart: 16, font: 'ui-sm', color: 'gray-700' });
const diagItem = style({ marginBottom: 8, overflowWrap: 'anywhere' });
const diagPath = style({ font: 'code-xs', color: 'gray-600', userSelect: 'text' });
const diagHint = style({ marginTop: 0, marginBottom: 8, font: 'ui-sm', color: 'gray-600' });
const externalBox = style({ marginTop: 8, scrollMarginTop: 16 });
const externalHint = style({ marginStart: 8, font: 'ui-xs', fontWeight: 'normal', color: 'gray-600' });
const externalBody = style({ marginTop: 0, marginBottom: 0, font: 'ui-sm', color: 'gray-700', overflowWrap: 'anywhere', whiteSpace: 'pre-line' });
// 拖进来时盖在整页上（原型 `.skp-dropzone`）。
const dropzone = style({
  position: 'absolute',
  inset: -16,
  zIndex: 5,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  borderRadius: 'xl',
  backgroundColor: 'gray-25',
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: 'blue-900',
  color: 'gray-800',
  pointerEvents: 'none',
});
const dropTitle = style({ font: 'title-sm', color: 'gray-900' });
const dropHint = style({ font: 'ui-xs', color: 'gray-600' });

/** 刚装或刚改（24 小时内）的个人与第三方 skill 标一个「新」。 */
const FRESH_MS = 24 * 60 * 60 * 1000;

type Adding = 'upload' | 'github' | 'blank' | null;

/**
 * Skills 列表（原型 page-skills.jsx `SkillsList`）：标题行（搜索、添加）→ 一句导语 →「我的」→「项目品牌」→「BaoCut 内置」
 * → 跳过的文件夹（有才出现）→ 页底折叠的「在终端或其他应用里用 BaoCut」（`?tab=external` 时展开并滚到）。
 * 把 zip 或文件夹拖到页面上任何地方都打开上传。浏览器里只能看与开关：没有添加、拖放与 BRAND.md 的新建。
 */
export function SkillsList({ external }: { external: boolean }) {
  const runtime = useRuntime();
  const actions = useSkillActions();
  const { web } = actions;
  const go = useShell((s) => s.go);
  const connected = useConnection((s) => s.state.status === 'connected');
  const skills = useSkillsLoader();
  const brands = useBrandsLoader();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<Adding>(null);
  const [dropped, setDropped] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [externalOpen, setExternalOpen] = useState(external);
  const depth = useRef(0);
  const externalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!external) return;
    setExternalOpen(true);
    const id = window.setTimeout(() => externalRef.current?.scrollIntoView({ block: 'start' }), 60);
    return () => window.clearTimeout(id);
  }, [external]);

  const groups = skillSections(skills.skills, brands.brands, query);
  const q = query.trim();
  const canAdd = !web && connected;

  const pick = (key: string) => {
    if (key === 'agent') {
      openHome(null, { prompt: ADD_COPY.agentPrompt });
      return;
    }
    setDropped(null);
    setAdding(key as Adding);
  };

  // 拖进来：只看拖的是不是文件；松手就开上传，把第一个的本机路径交给它去认包。
  const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const drag = canAdd
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!isFiles(e)) return;
          depth.current++;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (isFiles(e)) e.preventDefault();
        },
        onDragLeave: () => {
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!isFiles(e)) return;
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          const file = e.dataTransfer.files[0];
          const path = file ? runtime.host.pathForFile(file) : '';
          if (!path) return;
          setDropped(path);
          setAdding('upload');
        },
      }
    : {};

  const date = (iso: string) => dateLabel(iso, intlLocale());

  const skillRow = (skill: SkillSummary) => {
    const name = skillFullName(skill);
    const fresh = skill.origin !== 'builtin' && Date.now() - Date.parse(skill.updatedAt) < FRESH_MS;
    return (
      <li key={skill.id} className={row}>
        <button type="button" className={rowMain} aria-label={LIST_COPY.view(name)} onClick={() => actions.open(skill)}>
          <span className={icon({ isOff: !skill.enabled })} aria-hidden="true">
            <Lightbulb />
          </span>
          <span className={rowText}>
            <span className={rowTitle}>
              <span className={rowName({ isOff: !skill.enabled })} title={name}>
                {name}
              </span>
              <span className={badges}>
                {fresh ? (
                  <Badge variant="accent" size="S">
                    {BADGE_COPY.fresh}
                  </Badge>
                ) : null}
                {skill.origin === 'third-party' ? (
                  <Badge variant="neutral" fillStyle="outline" size="S">
                    {BADGE_COPY.github}
                  </Badge>
                ) : null}
              </span>
            </span>
            <span className={rowSub}>{skillDisplaySummary(skill)}</span>
          </span>
          <span className={rowDate}>{date(skill.updatedAt)}</span>
        </button>
        <span className={rowEnd}>
          <Switch aria-label={LIST_COPY.enable(name)} isSelected={skill.enabled} onChange={(on) => actions.toggle(skill, on)} />
          <SkillMoreMenu skill={skill} actions={actions} label={LIST_COPY.more(name)} />
        </span>
      </li>
    );
  };

  const brandRow = (brand: ProjectBrandSummary) => (
    <li key={brand.projectId} className={row}>
      <button
        type="button"
        className={rowMain}
        aria-label={LIST_COPY.view(BRAND_COPY.detailTitle(brand.projectName))}
        onClick={() => go({ tab: 'skills', brand: brand.projectId })}>
        <span className={icon({ isOff: false })} aria-hidden="true">
          <Folder />
        </span>
        <span className={rowText}>
          <span className={rowTitle}>
            <span className={rowName({ isOff: false })} title={brand.projectName}>
              {BRAND_COPY.row(brand.projectName)}
            </span>
            <span className={badges}>
              <Badge variant="neutral" fillStyle="subtle" size="S">
                {BADGE_COPY.brand}
              </Badge>
            </span>
          </span>
          <span className={rowSub}>{brand.summary}</span>
        </span>
        <span className={rowDate}>{date(brand.updatedAt)}</span>
      </button>
      <span className={rowEnd}>
        <span className={auto}>{BRAND_COPY.auto}</span>
        <BrandMoreMenu brand={brand} label={LIST_COPY.more(BRAND_COPY.detailTitle(brand.projectName))} />
      </span>
    </li>
  );

  const sectionHeading = (label: string, count: number) => (
    <h2 className={sectionHead}>
      {label}
      <span className={sectionCount}>{LIST_COPY.count(count)}</span>
    </h2>
  );

  let body;
  if (!skills.loaded) {
    body = (
      <div className={status} role="status">
        {!connected ? (
          <p className={statusText}>{SKILLS_COPY.disconnected}</p>
        ) : skills.status === 'failed' ? (
          <>
            <p className={statusText}>{SKILLS_COPY.loadFailed(skills.error ?? '')}</p>
            <Button variant="secondary" size="S" onPress={skills.retry}>
              {SKILLS_COPY.retry}
            </Button>
          </>
        ) : (
          <ProgressCircle isIndeterminate size="S" aria-label={SKILLS_COPY.loading} />
        )}
      </div>
    );
  } else {
    body = (
      <>
        <section className={section} aria-label={LIST_COPY.mine}>
          {sectionHeading(LIST_COPY.mine, groups.mine.length)}
          {groups.mine.length ? (
            <ul className={list}>{groups.mine.map(skillRow)}</ul>
          ) : !q ? (
            <div className={empty}>
              <h3 className={emptyTitle}>{LIST_COPY.emptyMineTitle}</h3>
              <p className={emptyBody}>{LIST_COPY.emptyMineBody}</p>
              {canAdd ? (
                <span className={emptyActions}>
                  <Button variant="accent" size="S" onPress={() => pick('upload')}>
                    <Upload />
                    <Text>{ADD_COPY.upload}</Text>
                  </Button>
                  <Button variant="secondary" size="S" onPress={() => pick('blank')}>
                    {ADD_COPY.blank}
                  </Button>
                </span>
              ) : null}
            </div>
          ) : (
            <p className={none}>{LIST_COPY.noMatch(q)}</p>
          )}
        </section>

        <section className={section} aria-label={LIST_COPY.brands}>
          <div className={sectionBar}>
            {sectionHeading(LIST_COPY.brands, groups.brands.length)}
            {canAdd ? <BrandAddMenu brands={brands.brands} /> : null}
          </div>
          <p className={sectionHint}>{BRAND_COPY.sectionHint}</p>
          {groups.brands.length ? (
            <ul className={list}>{groups.brands.map(brandRow)}</ul>
          ) : (
            <p className={none}>{q ? LIST_COPY.noMatch(q) : brands.status === 'failed' ? (brands.error ?? BRAND_COPY.empty) : BRAND_COPY.empty}</p>
          )}
        </section>

        <section className={section} aria-label={LIST_COPY.builtin}>
          {sectionHeading(LIST_COPY.builtin, groups.builtin.length)}
          {groups.builtin.length ? (
            <ul className={list}>{groups.builtin.map(skillRow)}</ul>
          ) : (
            <p className={none}>{q ? LIST_COPY.noMatch(q) : LIST_COPY.none}</p>
          )}
        </section>

        {skills.diagnostics.length ? (
          <div className={section}>
            <Disclosure size="S" isQuiet>
              <DisclosureTitle>{SKILLS_COPY.diagnosticsTitle(skills.diagnostics.length)}</DisclosureTitle>
              <DisclosurePanel>
                <p className={diagHint}>{SKILLS_COPY.diagnosticsHint}</p>
                <ul className={diagList}>
                  {skills.diagnostics.map((d) => (
                    <li key={`${d.scope}:${d.path}`} className={diagItem}>
                      {SKILLS_COPY.diagnosticLine(d.dir, SKILLS_COPY.diagnosticCode[d.code] ?? d.code, d.issues[0] ?? d.message)}
                      <div className={diagPath}>{d.path}</div>
                    </li>
                  ))}
                </ul>
              </DisclosurePanel>
            </Disclosure>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className={root} {...drag}>
      <header className={head}>
        <h1 className={heading}>{LIST_COPY.title}</h1>
        <SearchField aria-label={LIST_COPY.search} placeholder={LIST_COPY.search} styles={search} value={query} onChange={setQuery} />
        {web ? null : (
          <MenuTrigger align="end">
            <Button variant="accent" isDisabled={!connected}>
              <Add />
              <Text>{ADD_COPY.label}</Text>
            </Button>
            <Menu aria-label={ADD_COPY.label} onAction={(key) => pick(String(key))}>
              <MenuItem id="upload" textValue={ADD_COPY.upload}>
                <Upload />
                <Text slot="label">{ADD_COPY.upload}</Text>
                <Text slot="description">{ADD_COPY.uploadHint}</Text>
              </MenuItem>
              <MenuItem id="github" textValue={ADD_COPY.github}>
                <Link />
                <Text slot="label">{ADD_COPY.github}</Text>
              </MenuItem>
              <MenuItem id="blank" textValue={ADD_COPY.blank}>
                <Edit />
                <Text slot="label">{ADD_COPY.blank}</Text>
                <Text slot="description">{ADD_COPY.blankHint}</Text>
              </MenuItem>
              <MenuItem id="agent" textValue={ADD_COPY.agent}>
                <AIMark />
                <Text slot="label">{ADD_COPY.agent}</Text>
                <Text slot="description">{ADD_COPY.agentHint}</Text>
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </header>
      <p className={lede}>{LIST_COPY.lede}</p>
      {web ? <p className={webNote}>{LIST_COPY.webNote}</p> : null}
      {body}

      <div ref={externalRef} className={externalBox}>
        <Disclosure isQuiet isExpanded={externalOpen} onExpandedChange={setExternalOpen}>
          <DisclosureTitle>
            {LIST_COPY.external}
            <span className={externalHint}>{LIST_COPY.externalHint}</span>
          </DisclosureTitle>
          <DisclosurePanel>
            <p className={externalBody}>{SKILLS_COPY.externalBody}</p>
          </DisclosurePanel>
        </Disclosure>
      </div>

      {dragging ? (
        <div className={dropzone} aria-hidden="true">
          <Upload />
          <span className={dropTitle}>{LIST_COPY.dropTitle}</span>
          <span className={dropHint}>{LIST_COPY.dropHint}</span>
        </div>
      ) : null}

      {actions.dialog}
      <SkillUploadDialog
        open={adding === 'upload'}
        path={dropped}
        onClose={() => {
          setAdding(null);
          setDropped(null);
        }}
      />
      <GithubImportDialog
        open={adding === 'github'}
        onImport={async (url) => {
          const { skill } = await importSkillFromGithub(runtime, url);
          setAdding(null);
          ToastQueue.positive(TOAST_COPY.imported(skillDisplayName(skill), skill.path), { timeout: 5000 });
          actions.open(skill);
        }}
        onClose={() => setAdding(null)}
      />
      <SkillBlankDialog
        open={adding === 'blank'}
        onCreate={async (params) => {
          const { skill } = await createSkill(runtime, params);
          setAdding(null);
          ToastQueue.positive(TOAST_COPY.created(skillDisplayName(skill), skill.path), { timeout: 5000 });
          actions.open(skill, 'files');
        }}
        onClose={() => setAdding(null)}
      />
    </div>
  );
}
