import { expect, it } from 'vitest';
import { brandFilePath, brandName, interviewPrompt } from './brand-create.tsx';
import { BRAND_COPY } from './skills-copy.ts';

it('puts BRAND.md in the folder with the separator that folder uses', () => {
  expect(brandFilePath('/Users/me/.baocut/')).toBe('/Users/me/.baocut/BRAND.md');
  expect(brandFilePath('C:\\Users\\me\\Video')).toBe('C:\\Users\\me\\Video\\BRAND.md');
});

it('names the global brand from the copy and a project brand after its project', () => {
  expect(brandName({ scope: 'global', projectName: '' })).toBe(BRAND_COPY.globalName);
  expect(brandName({ scope: 'project', projectName: 'Vlog' })).toBe('Vlog');
});

it('asks the Agent to interview one question at a time and write to the exact file', () => {
  const global = interviewPrompt({ id: 'global', name: BRAND_COPY.globalName, path: '/h', global: true }, '/h/BRAND.md');
  expect(global).toBe(`${BRAND_COPY.interviewGlobal('/h/BRAND.md')}\n${BRAND_COPY.interviewSteps}`);
  const project = interviewPrompt({ id: 'p1', name: 'Vlog', path: '/p', global: false }, '/p/BRAND.md');
  expect(project).toContain('/p/BRAND.md');
  expect(project).toContain('Vlog');
});
