import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagedResourceEnv, packagedResources } from './packaged-resources.ts';

describe('packagedResources', () => {
  it('places every runtime resource under the resources directory', () => {
    const resources = packagedResources('C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources', path.win32);
    expect(resources).toEqual({
      binDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\bin',
      templatesDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\templates',
      skillsDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\skills',
      agentSkillsDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\agent-skills',
      modelAssetsDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\model-assets',
      webDist: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\web',
    });
  });

  it('hands the Runtime one environment variable per location', () => {
    const env = packagedResourceEnv(packagedResources('/r', path.posix));
    expect(env).toEqual({
      BAOCUT_BIN_DIR: '/r/bin',
      BAOCUT_TEMPLATES_DIR: '/r/templates',
      BAOCUT_SKILLS_DIR: '/r/skills',
      BAOCUT_AGENT_SKILLS_DIR: '/r/agent-skills',
      BAOCUT_MODEL_ASSETS_DIR: '/r/model-assets',
      BAOCUT_WEB_DIST: '/r/web',
    });
  });
});
