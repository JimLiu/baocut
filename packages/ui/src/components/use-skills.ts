import { useCallback, useEffect } from 'react';
import { useRuntime } from '../runtime/context.tsx';
import { loadBrands, loadSkills } from '../runtime/skill-commands.ts';
import { useBrands, type BrandsStore } from '../state/brands-store.ts';
import { useConnection } from '../state/connection-store.ts';
import { useSkills, type SkillsStore } from '../state/skills-store.ts';

/**
 * skill 列表：挂上时、重新连上时各取一次（Skills 页与输入框共用；同时要几次只发一次）。没连上时不发，等连上再取。
 * 返回列表的镜像与一个「重试」。
 */
export function useSkillsLoader(): SkillsStore & { retry(): void } {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const skills = useSkills();
  useEffect(() => {
    if (connected) void loadSkills(runtime);
  }, [runtime, connected]);
  const retry = useCallback(() => void loadSkills(runtime), [runtime]);
  return { ...skills, retry };
}

/** 有 `BRAND.md` 的项目：同 `useSkillsLoader`，挂上、重新连上时各取一次。 */
export function useBrandsLoader(): BrandsStore & { retry(): void } {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const brands = useBrands();
  useEffect(() => {
    if (connected) void loadBrands(runtime);
  }, [runtime, connected]);
  const retry = useCallback(() => void loadBrands(runtime), [runtime]);
  return { ...brands, retry };
}
