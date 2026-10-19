import { useState } from 'react';
import type { Id, ProjectBrandSummary, SkillOrigin } from '@baocut/protocol';
import { GLOBAL_BRAND_ID, PROJECT_BRAND_FILE } from '@baocut/protocol';
import {
  Button,
  ButtonGroup,
  Content,
  Dialog,
  DialogContainer,
  Header,
  Heading,
  Picker,
  PickerItem,
  PickerSection,
  Radio,
  RadioGroup,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Folder from '@react-spectrum/s2/icons/Folder';
import GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { skillDisplayName, skillErrorMessage } from '../../model/agent-skills.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { createBrandFromSkill, getBrand, writeBrand } from '../../runtime/skill-commands.ts';
import { useBrands } from '../../state/brands-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { openHome } from '../start/open-home.ts';
import { useSkillsLoader } from '../use-skills.ts';
import { BRAND_COPY, DETAIL_COPY } from './skills-copy.ts';

/** 一份品牌管哪里：全局（BaoCut 的数据文件夹）或一个项目（项目根目录）。`path` 是 BRAND.md 所在的文件夹。 */
export interface BrandTarget {
  id: Id;
  name: string;
  path: string;
  global: boolean;
}

export type BrandMethod = 'agent' | 'template' | 'skill';

const isGlobalId = (id: Id) => id === GLOBAL_BRAND_ID;

/** 列表与页头上的名字：全局的叫「全局品牌」，项目的用项目名。 */
export function brandName(brand: Pick<ProjectBrandSummary, 'scope' | 'projectName'>): string {
  return brand.scope === 'global' ? BRAND_COPY.globalName : brand.projectName;
}

/** 摘要对应的范围。 */
export function brandTarget(brand: ProjectBrandSummary): BrandTarget {
  return { id: brand.projectId, name: brandName(brand), path: brand.projectPath, global: brand.scope === 'global' };
}

/** 文件夹里的 BRAND.md：跟着那个路径用的分隔符。 */
export function brandFilePath(root: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${PROJECT_BRAND_FILE}`;
}

/** 请 Agent 一问一答建品牌的第一条消息（原型 model-project-brand.js `interviewPrompt`）。 */
export function interviewPrompt(target: BrandTarget, file: string): string {
  const ask = target.global ? BRAND_COPY.interviewGlobal(file) : BRAND_COPY.interviewProject(target.name, file);
  return `${ask}\n${BRAND_COPY.interviewSteps}`;
}

/**
 * 建一份：和 Agent 一起建是到起始页（项目的落在那个项目里）、输入框填好第一条消息，由用户发出；
 * 空白模板与从 skill 生成直接写盘，然后进那份的文件页签。
 */
function useCreateBrand() {
  const runtime = useRuntime();
  const replace = useShell((s) => s.replace);
  return async (target: BrandTarget, how: BrandMethod, skillId: string | null): Promise<void> => {
    try {
      if (how === 'agent') {
        const root = target.path || (await getBrand(runtime, target.id)).root;
        openHome(target.global ? null : target.id, { prompt: interviewPrompt(target, brandFilePath(root)) });
        return;
      }
      if (how === 'skill' && skillId) await createBrandFromSkill(runtime, target.id, skillId);
      else {
        const name = target.global ? BRAND_COPY.globalTemplateName : target.name;
        await writeBrand(runtime, target.id, [{ path: PROJECT_BRAND_FILE, text: BRAND_COPY.template(name) }]);
      }
      ToastQueue.positive(BRAND_COPY.created(target.name), { timeout: 4000 });
      replace({ tab: 'skills', brand: target.id, view: 'files' });
    } catch (error) {
      ToastQueue.negative(skillErrorMessage(error, 'brand'), { timeout: 8000 });
    }
  };
}

const ORIGIN_ORDER: readonly SkillOrigin[] = ['personal', 'third-party', 'builtin'];
const picker = style({ width: 320, maxWidth: 'full' });
const hint = style({ margin: 0, font: 'ui-xs', color: 'gray-700' });
const stack = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 16 });

/** 怎么建：和 Agent 一起建排第一（默认），其次空白模板、从一个 skill 生成。 */
export function MethodPicker({
  how,
  onHow,
  skillId,
  onSkill,
}: {
  how: BrandMethod;
  onHow(how: BrandMethod): void;
  skillId: string | null;
  onSkill(id: string | null): void;
}) {
  const skills = useSkillsLoader();
  // 自己的品牌 skill 在前，内置的放最后。
  const pickable = [...skills.skills].sort((a, b) => ORIGIN_ORDER.indexOf(a.origin) - ORIGIN_ORDER.indexOf(b.origin));
  return (
    <>
      <RadioGroup label={BRAND_COPY.from} value={how} onChange={(value) => onHow(value as BrandMethod)}>
        <Radio value="agent">{BRAND_COPY.fromAgent}</Radio>
        <Radio value="template">{BRAND_COPY.fromTemplate}</Radio>
        <Radio value="skill" isDisabled={!skills.skills.length}>
          {BRAND_COPY.fromSkill}
        </Radio>
      </RadioGroup>
      {how === 'skill' ? (
        <Picker
          label={BRAND_COPY.skill}
          placeholder={BRAND_COPY.skillPlaceholder}
          styles={picker}
          selectedKey={skillId}
          onSelectionChange={(key) => onSkill(key === null ? null : String(key))}>
          {pickable.map((s) => (
            <PickerItem key={s.id} id={s.id} textValue={skillDisplayName(s)}>
              <Text slot="label">{skillDisplayName(s)}</Text>
              <Text slot="description">{DETAIL_COPY.sourceLabel[s.origin] ?? s.origin}</Text>
            </PickerItem>
          ))}
        </Picker>
      ) : null}
      <p className={hint}>{how === 'agent' ? BRAND_COPY.fromAgentHint : how === 'skill' ? BRAND_COPY.fromSkillHint : BRAND_COPY.templateHint}</p>
    </>
  );
}

/** 方法的状态与提交，对话框与新建页共用。 */
export function useBrandMethod() {
  const create = useCreateBrand();
  const [how, setHow] = useState<BrandMethod>('agent');
  const [skillId, setSkillId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return {
    picker: <MethodPicker how={how} onHow={setHow} skillId={skillId} onSkill={setSkillId} />,
    ready: how !== 'skill' || !!skillId,
    pending,
    cta: how === 'agent' ? BRAND_COPY.startChat : BRAND_COPY.create,
    submit: async (target: BrandTarget) => {
      setPending(true);
      try {
        await create(target, how, skillId);
      } finally {
        setPending(false);
      }
    },
  };
}

/**
 * 「新建品牌」（原型 page-project-brand.jsx `BrandCreateDialog`）：先选用在哪里——全局或一个还没有 BRAND.md 的项目，
 * 已有的列着但不能选——再选怎么建。`preset` 是预先选中的范围。
 */
export function BrandCreateDialog({ open, preset, onClose }: { open: boolean; preset?: Id | null; onClose(): void }) {
  return <DialogContainer onDismiss={onClose}>{open ? <BrandCreateBody preset={preset ?? null} onClose={onClose} /> : null}</DialogContainer>;
}

function BrandCreateBody({ preset, onClose }: { preset: Id | null; onClose(): void }) {
  const brands = useBrands((s) => s.brands);
  const projects = useDirectory((s) => s.projects).filter((p) => !p.archived);
  const method = useBrandMethod();
  const has = (id: Id) => brands.some((b) => b.projectId === id);
  const taken = [GLOBAL_BRAND_ID, ...projects.map((p) => p.id)].filter(has);
  const first = preset ?? [GLOBAL_BRAND_ID, ...projects.map((p) => p.id)].find((id) => !has(id)) ?? null;
  const [targetId, setTargetId] = useState<Id | null>(first);
  const project = targetId && !isGlobalId(targetId) ? (projects.find((p) => p.id === targetId) ?? null) : null;
  const target: BrandTarget | null =
    targetId === null || has(targetId)
      ? null
      : isGlobalId(targetId)
        ? { id: GLOBAL_BRAND_ID, name: BRAND_COPY.globalName, path: '', global: true }
        : project
          ? { id: project.id, name: project.name, path: project.path, global: false }
          : null;

  return (
    <Dialog size="M">
      {({ close }) => (
        <>
          <Heading slot="title">{BRAND_COPY.add}</Heading>
          <Content>
            <div className={stack}>
              <Picker
                label={BRAND_COPY.where}
                styles={picker}
                selectedKey={targetId}
                disabledKeys={taken}
                onSelectionChange={(key) => setTargetId(key === null ? null : String(key))}>
                <PickerSection id="global">
                  <Header>
                    <Heading>{BRAND_COPY.scopeGlobal}</Heading>
                  </Header>
                  <PickerItem id={GLOBAL_BRAND_ID} textValue={BRAND_COPY.globalName}>
                    <GlobeGrid />
                    <Text slot="label">{BRAND_COPY.globalName}</Text>
                    <Text slot="description">{has(GLOBAL_BRAND_ID) ? BRAND_COPY.exists : BRAND_COPY.whereGlobalDesc}</Text>
                  </PickerItem>
                </PickerSection>
                {projects.length ? (
                  <PickerSection id="projects">
                    <Header>
                      <Heading>{BRAND_COPY.scopeProject}</Heading>
                    </Header>
                    {projects.map((p) => (
                      <PickerItem key={p.id} id={p.id} textValue={p.name}>
                        <Folder />
                        <Text slot="label">{p.name}</Text>
                        <Text slot="description">{has(p.id) ? BRAND_COPY.exists : brandFilePath(p.path)}</Text>
                      </PickerItem>
                    ))}
                  </PickerSection>
                ) : null}
              </Picker>
              {target ? <p className={hint}>{target.global ? BRAND_COPY.whereGlobalHint : BRAND_COPY.whereProjectHint(target.name)}</p> : null}
              {method.picker}
            </div>
          </Content>
          <ButtonGroup>
            <Button variant="secondary" onPress={close}>
              {BRAND_COPY.cancel}
            </Button>
            <Button
              variant="accent"
              isDisabled={!target || !method.ready}
              isPending={method.pending}
              onPress={() => {
                if (!target) return;
                void method.submit(target).then(onClose);
              }}>
              {method.cta}
            </Button>
          </ButtonGroup>
        </>
      )}
    </Dialog>
  );
}
