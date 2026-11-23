import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagedResourceEnv, packagedResources } from './packaged-resources.ts';

describe('packagedResources', () => {
  it('places every runtime resource under the resources directory', () => {
    const resources = packagedResources('C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources', path.win32);
    expect(resources).toEqual({
      resourcesDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources',
      binDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\bin',
      templatesDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\templates',
      stickersDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\stickers',
      skillsDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\skills\\baocut\\built-in-skills',
      agentSkillsDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\skills',
      agentSkillDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\agent-skill\\baocut',
      modelAssetsDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\model-assets',
      webDist: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\web',
      openArtifactDir: 'C:\\Users\\a\\AppData\\Local\\Programs\\BaoCut\\resources\\open-artifact',
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
      BAOCUT_AGENT_SKILL_DIR: '/r/agent-skill/baocut',
      BAOCUT_CLI_ENTRY: '/baocut.cmd',
      BAOCUT_MODEL_ASSETS_DIR: '/r/model-assets',
      BAOCUT_WEB_DIST: '/r/web',
      BAOCUT_OPEN_ARTIFACT_DIR: '/r/open-artifact',
    });
  });
  it('points the Runtime at the CLI launcher beside the app', () => {
    expect(packagedResourceEnv(packagedResources('/A/BaoCut.app/Contents/Resources'), 'darwin').BAOCUT_CLI_ENTRY).toBe(
      '/A/BaoCut.app/Contents/MacOS/baocut-cli',
    );
    expect(packagedResourceEnv(packagedResources('/r'), 'linux')).not.toHaveProperty('BAOCUT_CLI_ENTRY');
  });
  it('pins macOS MLX to the shipped Metal library', () => {
    expect(packagedResourceEnv(packagedResources('/r'), 'darwin').PMETAL_METALLIB_PATH).toBe('/r/bin/mlx.metallib');
    expect(packagedResourceEnv(packagedResources('/r'), 'win32')).not.toHaveProperty('PMETAL_METALLIB_PATH');
  });
});
