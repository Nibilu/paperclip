import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@pilibalaai/adapter-utils";
import {
  buildRuntimeMountedSkillSnapshot,
  readPilibalaRuntimeSkillEntries,
  resolveLegacyPilibalaDesiredSkillNames,
  resolvePilibalaDesiredSkillNames,
} from "@pilibalaai/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

async function buildCodexSkillSnapshot(
  config: Record<string, unknown>,
  adapterType: string,
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPilibalaRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = adapterType === "pilibala_runner"
    ? resolvePilibalaDesiredSkillNames(config, availableEntries)
    : resolveLegacyPilibalaDesiredSkillNames(config, availableEntries);
  return buildRuntimeMountedSkillSnapshot({
    adapterType,
    availableEntries,
    desiredSkills,
    configuredDetail: "Will be linked into the effective CODEX_HOME/skills/ directory on the next run.",
  });
}

export async function listCodexSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildCodexSkillSnapshot(ctx.config, ctx.adapterType);
}

export async function syncCodexSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  return buildCodexSkillSnapshot(ctx.config, ctx.adapterType);
}

export function resolveCodexDesiredSkillNames(
  config: Record<string, unknown>,
  availableEntries: Array<{ key: string; required?: boolean }>,
) {
  return resolveLegacyPilibalaDesiredSkillNames(config, availableEntries);
}
