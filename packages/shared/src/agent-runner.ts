export type AgentRunnerChoice = "auto" | "pilibala" | "legacy";
export type AgentRunner = Exclude<AgentRunnerChoice, "auto">;

export interface AgentRunnerAvailability {
  supportedRunners: AgentRunner[];
  defaultRunner: AgentRunner;
}

export function pilibalaRunnerProfileForHarness(harness: string): { provider: "codex" } | undefined {
  return harness === "codex_local" ? { provider: "codex" } : undefined;
}

export const PILIBALA_RUNNER_MINIMUM_GLIBC_VERSION = "2.39";

function supportsLinuxLibc(libc?: "glibc" | "musl" | "unknown", version?: string): boolean {
  if (libc !== undefined && libc !== "glibc") return false;
  if (version === undefined) return true;
  const match = typeof version === "string" ? version.trim().match(/^(?:glibc\s+)?(\d+)\.(\d+)(?:\.\d+)?$/) : null;
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) return false;
  const [requiredMajor, requiredMinor] = PILIBALA_RUNNER_MINIMUM_GLIBC_VERSION.split(".").map(Number);
  return major > requiredMajor! || (major === requiredMajor && minor >= requiredMinor!);
}

export function pilibalaRunnerSupportsPlatform(harness: string, platform: string, architecture: string, libc?: "glibc" | "musl" | "unknown", glibcVersion?: string): boolean {
  return !!pilibalaRunnerProfileForHarness(harness)
    && ((platform === "linux" && supportsLinuxLibc(libc, glibcVersion) && (architecture === "x64" || architecture === "arm64"))
      || (platform === "darwin" && (architecture === "arm64" || architecture === "x64")));
}

export function agentHarnessType(adapterType: string, config: Record<string, unknown> = {}): string {
  if (adapterType !== "pilibala_runner") return adapterType;
  if (config.provider === undefined || config.provider === "codex") return "codex_local";
  if (config.provider === "opencode") return "opencode_local";
  if (config.provider === "acpx") {
    const agent = config.acpxAgent ?? "claude";
    return ({ codex: "codex_local", claude: "claude_local", grok: "grok_local", cursor: "cursor", pi: "pi_local" } as Record<string, string>)[String(agent)] ?? `acpx:${String(agent)}`;
  }
  return String(config.provider);
}

export function agentRunner(adapterType: string): AgentRunner {
  return adapterType === "pilibala_runner" ? "pilibala" : "legacy";
}
