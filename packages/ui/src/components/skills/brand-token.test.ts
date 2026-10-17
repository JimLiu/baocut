import { afterEach, expect, it } from 'vitest';
import { emptyBrands, useBrands } from '../../state/brands-store.ts';
import { useDraftBrand } from '../../state/draft-brand-store.ts';
import { brandSkipFor } from './brand-token.tsx';

afterEach(() => {
  useDraftBrand.setState({ skipped: {} });
  useBrands.setState(emptyBrands());
});

it('skips BRAND.md for the next message only when the draft dismissed it and the project has one', () => {
  expect(brandSkipFor('d', 'p1')).toBe(false);
  useDraftBrand.getState().set('d', true);
  expect(brandSkipFor('d', 'p1')).toBe(false);
  useBrands.getState().succeed([
    { projectId: 'p1', projectName: 'A', projectPath: '/p1', path: '/p1/BRAND.md', summary: '', updatedAt: '', fileCount: 1, bytes: 1 },
  ]);
  expect(brandSkipFor('d', 'p1')).toBe(true);
  expect(brandSkipFor('other', 'p1')).toBe(false);
  expect(brandSkipFor('d', null)).toBe(false);
  useDraftBrand.getState().set('d', false);
  expect(brandSkipFor('d', 'p1')).toBe(false);
});
