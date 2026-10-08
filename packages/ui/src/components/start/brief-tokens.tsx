import Code from '@react-spectrum/s2/icons/Code';
import FileText from '@react-spectrum/s2/icons/FileText';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import Video from '@react-spectrum/s2/icons/Video';
import { HOME_COPY, SKILL_COPY } from '../../copy.ts';
import type { HomeMaterial } from '../../model/home-brief.ts';
import type { HomeTemplate } from '../../model/home-templates.ts';
import { ComposerToken, composerTokenList } from '../composer-token.tsx';
import { TemplateCover } from './template-cover.tsx';

const KIND_ICON = { media: Video, image: ImageIcon, document: FileText } as const;

/**
 * 输入框正文上方（原型 new-agent.jsx `AgentHero` 的 attachments）：点选的 skill、选中的模板，和要交给 Agent 的本机素材。
 * 素材只列名字，悬停看完整路径；发出去时路径写进那条消息。标记的样子在 composer-token.tsx，会话输入框上的 skill 标记同款。
 */
export function BriefTokens({
  skill,
  template,
  materials,
  onRemoveSkill,
  onRemoveTemplate,
  onRemoveMaterial,
}: {
  /** 点选的 skill 的名字；没选时为 null。 */
  skill: string | null;
  template: HomeTemplate | null;
  materials: readonly HomeMaterial[];
  onRemoveSkill(): void;
  onRemoveTemplate(): void;
  onRemoveMaterial(path: string): void;
}) {
  if (!skill && !template && !materials.length) return null;
  return (
    <div className={composerTokenList}>
      {skill ? (
        <ComposerToken icon={<Code />} label={SKILL_COPY.token(skill)} removeLabel={SKILL_COPY.remove(skill)} onRemove={onRemoveSkill} />
      ) : null}
      {template ? (
        // 输入框上方选中的模板（原型 `.home-template-token`）：小封面、名字、移除。
        <ComposerToken
          icon={<TemplateCover template={template} size="xs" />}
          label={HOME_COPY.templateToken(template.title)}
          removeLabel={HOME_COPY.removeTemplate}
          onRemove={onRemoveTemplate}
        />
      ) : null}
      {materials.map((material) => {
        const Icon = KIND_ICON[material.kind];
        return (
          <ComposerToken
            key={material.path}
            icon={<Icon />}
            label={material.name}
            title={material.path}
            removeLabel={HOME_COPY.removeMaterial(material.name)}
            onRemove={() => onRemoveMaterial(material.path)}
          />
        );
      })}
    </div>
  );
}
