import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagedResourceEnv, packagedResources } from './packaged-resources.ts';

describe('packagedResources', () => {
  it('places every runtime resource under the resources directory', () => {
    const resources = packagedResources('C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources', path.win32);
    expect(resources).toEqual({
      binDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\bin',
      templatesDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\templates',
      stickersDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\stickers',
      skillsDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\skills\\baocut\\built-in-skills',
      agentSkillsDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\skills',
      modelAssetsDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\model-assets',
      webDist: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\web',
      slidesEditorDist: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\slides-editor',
      designEditorDist: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\design-editor',
      designSystemEditorDist: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\design-system-editor',
      docsEditorDist: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\docs-editor',
    });
  });

  it('hands the Runtime one environment variable per location', () => {
    const env = packagedResourceEnv(packagedResources('/r', path.posix), 'win32');
    expect(env).toEqual({
      BAOCUT_BIN_DIR: '/r/bin',
      BAOCUT_TEMPLATES_DIR: '/r/templates',
      BAOCUT_STICKERS_DIR: '/r/stickers',
      BAOCUT_SKILLS_DIR: '/r/skills/baocut/built-in-skills',
      BAOCUT_AGENT_SKILLS_DIR: '/r/skills',
      BAOCUT_MODEL_ASSETS_DIR: '/r/model-assets',
      BAOCUT_WEB_DIST: '/r/web',
      BAOCUT_SLIDES_EDITOR_DIST: '/r/slides-editor',
      BAOCUT_DESIGN_EDITOR_DIST: '/r/design-editor',
      BAOCUT_DESIGN_SYSTEM_EDITOR_DIST: '/r/design-system-editor',
      BAOCUT_DOCS_EDITOR_DIST: '/r/docs-editor',
    });
  });
  it('pins macOS MLX to the shipped Metal library', () => {
    expect(packagedResourceEnv(packagedResources('/r'), 'darwin').PMETAL_METALLIB_PATH).toBe('/r/bin/mlx.metallib');
    expect(packagedResourceEnv(packagedResources('/r'), 'win32')).not.toHaveProperty('PMETAL_METALLIB_PATH');
  });
});
