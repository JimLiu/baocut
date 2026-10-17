import type { Id } from '@baocut/protocol';
import { ActionButton, Text } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Brand from '@react-spectrum/s2/icons/Brand';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useBrands, useProjectBrand } from '../../state/brands-store.ts';
import { useBrandSkipped, useDraftBrand } from '../../state/draft-brand-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { ComposerToken, composerTokenList } from '../composer-token.tsx';
import { useBrandsLoader } from '../use-skills.ts';
import { BRAND_TOKEN_COPY, BRAND_COPY } from './skills-copy.ts';

const skippedChip = style({ display: 'inline-flex', alignSelf: 'start' });

/**
 * 输入框上的「品牌：BRAND.md」（原型 page-project-brand.jsx `ComposerBrandToken`）：会话所在项目有 `BRAND.md` 时出现；
 * 点名字打开它，点 × 只是下一条不带（`conversations.send` 的 `skipProjectBrand`），再点一次恢复。
 */
export function BrandToken({ projectId, draftKey }: { projectId: Id | null; draftKey: string }) {
  useBrandsLoader();
  const brand = useProjectBrand(projectId);
  const skipped = useBrandSkipped(draftKey);
  const go = useShell((s) => s.go);
  if (!projectId || !brand) return null;
  return (
    <div className={composerTokenList}>
      {skipped ? (
        <span className={skippedChip}>
          <ActionButton size="S" isQuiet aria-label={BRAND_TOKEN_COPY.restore} onPress={() => useDraftBrand.getState().set(draftKey, false)}>
            <Add />
            <Text>{BRAND_TOKEN_COPY.tokenSkipped}</Text>
          </ActionButton>
        </span>
      ) : (
        <ComposerToken
          icon={<Brand />}
          label={BRAND_TOKEN_COPY.token}
          title={brand.path}
          note={BRAND_COPY.auto}
          onOpen={() => go({ tab: 'skills', brand: projectId })}
          removeLabel={BRAND_TOKEN_COPY.skip}
          onRemove={() => useDraftBrand.getState().set(draftKey, true)}
        />
      )}
    </div>
  );
}

/** 发送时这个草稿的「下一条不带」；项目有 `BRAND.md` 时才算数。发出去后由输入框清掉。 */
export function brandSkipFor(draftKey: string, projectId: Id | null): boolean {
  const skip = !!useDraftBrand.getState().skipped[draftKey];
  const has = !!projectId && useBrands.getState().brands.some((b) => b.projectId === projectId);
  return skip && has;
}
