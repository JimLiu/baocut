import { afterEach, expect, it } from 'vitest';
import { brandLayers, emptyBrands, useBrands } from '../../state/brands-store.ts';
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
    { scope: 'project', projectId: 'p1', projectName: 'A', projectPath: '/p1', path: '/p1/BRAND.md', summary: '', updatedAt: '', fileCount: 1, bytes: 1 },
  ]);
  expect(brandSkipFor('d', 'p1')).toBe(true);
  expect(brandSkipFor('other', 'p1')).toBe(false);
  expect(brandSkipFor('d', null)).toBe(false);
  useDraftBrand.getState().set('d', false);
  expect(brandSkipFor('d', 'p1')).toBe(false);
});

it('counts the global BRAND.md too, also for sessions outside a project', () => {
  useDraftBrand.getState().set('d', true);
  expect(brandSkipFor('d', null)).toBe(false);
  useBrands.getState().succeed([
    { scope: 'project', projectId: 'p1', projectName: 'A', projectPath: '/p1', path: '/p1/BRAND.md', summary: '', updatedAt: '', fileCount: 1, bytes: 1 },
    { scope: 'global', projectId: 'global', projectName: '', projectPath: '/h', path: '/h/BRAND.md', summary: '', updatedAt: '', fileCount: 1, bytes: 1 },
  ]);
  expect(brandSkipFor('d', null)).toBe(true);
  expect(brandLayers(useBrands.getState().brands, 'p1').map((b) => b.scope)).toEqual(['project', 'global']);
  expect(brandLayers(useBrands.getState().brands, 'p2').map((b) => b.scope)).toEqual(['global']);
  expect(useBrands.getState().brands[0]?.scope).toBe('global');
});
