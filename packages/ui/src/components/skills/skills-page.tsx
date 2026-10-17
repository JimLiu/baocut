import { useRef, type ReactNode } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { Route } from '../../state/shell-store.ts';
import { useNarrow } from '../use-narrow.ts';
import { ProjectBrandPage } from './project-brand-page.tsx';
import { SkillDetailPage } from './skill-detail-page.tsx';
import { SkillsList } from './skills-list.tsx';

const content = style({ position: 'relative', flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: 'auto' });
const inner = style({ display: 'flex', flexDirection: 'column', maxWidth: '[1040px]', marginX: 'auto' });

type SkillsRoute = Extract<Route, { tab: 'skills' }>;

/**
 * Skills 页（rail 上 Space 下面一格，产品设计 §6.9；原型 page-skills.jsx `SkillsPage`）：没有侧栏，内容最宽 1040、内边距 40，
 * 内容区窄于 600 时收到 24。`#/skills?dir=<项目>` 是那个项目的 BRAND.md，`#/skills/<id>` 是一个 skill 的详情，其余是列表。
 */
export function SkillsPage({ route }: { route: SkillsRoute }) {
  return (
    <SkillsFrame>
      {route.brand ? (
        <ProjectBrandPage key={route.brand} projectId={route.brand} view={route.view === 'files' ? 'files' : 'overview'} file={route.file ?? null} />
      ) : route.id ? (
        <SkillDetailPage key={route.id} id={route.id} view={route.view === 'files' ? 'files' : 'overview'} file={route.file ?? null} />
      ) : (
        <SkillsList external={route.view === 'external'} />
      )}
    </SkillsFrame>
  );
}

function SkillsFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(ref, 600);
  return (
    <div ref={ref} className={`${content} bc-scroll`}>
      <div className={inner} style={{ padding: narrow ? 24 : 40 }}>
        {children}
      </div>
    </div>
  );
}
