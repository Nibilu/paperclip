/**
 * Unified run-failure classification (Recovery Ladder R1).
 *
 * One pure function maps a failed run's observable evidence onto a closed
 * taxonomy so every downstream consumer (retry budgeting, stranded cause
 * resolution, doctor delegation, last-attempt digests) keys off the same
 * categories instead of scattered ad-hoc regexes.
 *
 * Adapter-neutral by design: hermes cli/acp/gateway, claude/codex/pi/opencode,
 * custom gateway and local connections all flow through the same rules; each
 * adapter contributes its own signal patterns to the shared catalogs below.
 *
 * Invariants:
 * - Pure: no I/O, no DB, no clock. Deterministic for identical input.
 * - Conservative: only explicit signals classify; anything unmatched is
 *   `unknown` and reaches the L2 doctor ladder rather than being silently
 *   retried.
 * - Precedence is fixed and regression-tested: binding/boot failures before
 *   provider signals (a boot crash that mentions a provider is still a boot
 *   crash).
 */

export type RunFailureCategory =
  | "session_binding.resume_policy_refusal"
  | "session_lifecycle.resume_failed"
  | "runtime.adapter_boot_failure"
  | "runtime.process_lost"
  | "provider.limit"
  | "provider.auth"
  | "provider.connection"
  | "infra.server_shutdown"
  | "workspace.validation_failed"
  | "workspace.configuration_incomplete"
  | "unknown";

export type RunFailureRetryPolicy = "auto" | "bounded" | "wait_system" | "never";

export type RunFailureLadderHint = "L0" | "L2";

export interface ClassifyRunFailureInput {
  adapterType?: string | null;
  runtimeMode?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  exitCode?: number | null;
  /** HTTP/HTTP-like status observed from the provider or gateway endpoint. */
  providerStatus?: number | null;
  /** Structured run result payload (read-only); only closed keys are read. */
  resultJson?: unknown;
}

export interface RunFailureClassification {
  category: RunFailureCategory;
  subcategory?: string;
  retryPolicy: RunFailureRetryPolicy;
  /** Where the failure enters the recovery ladder when retrying will not fix it. */
  ladderHint: RunFailureLadderHint;
  matchedSignals: string[];
}

interface Rule {
  signal: string;
  category: RunFailureCategory;
  subcategory?: string;
  retryPolicy: RunFailureRetryPolicy;
  ladderHint: RunFailureLadderHint;
  test: (input: ClassifyRunFailureInput, message: string) => boolean;
}

/** Adapter boot/crash signatures, keyed by shared pattern catalogs. */
const BOOT_RULES: Rule[] = [
  {
    signal: "python_module_not_found",
    category: "runtime.adapter_boot_failure",
    subcategory: "python_missing_module",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (_i, m) => /ModuleNotFoundError: No module named ['"][\w.]+['"]/.test(m),
  },
  {
    signal: "acpx_session_init_failed_code",
    category: "runtime.adapter_boot_failure",
    subcategory: "acpx_session_init",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (i) => i.errorCode === "acpx_session_init_failed",
  },
  {
    // A persisted ACP session could not be resumed after a mid-turn death
    // (observed AMB-99 2026-10-23: provider 502 killed the turn, acpx
    // reconnected with a fresh hermes-acp child, load_session raised on the
    // mid-teardown shared-DB state). TRANSIENT session-lifecycle failure —
    // bounded retry, NOT the capability-mismatch L2 ladder. Precedes the
    // config-mismatch rule: legacy engines emit both under the same
    // acpx_session_config_failed errorCode, so the message signal decides.
    signal: "acpx_session_resume_failed_code",
    category: "session_lifecycle.resume_failed",
    subcategory: "acp_session_resume",
    retryPolicy: "bounded",
    ladderHint: "L0",
    test: (i, m) =>
      i.errorCode === "acpx_session_resume_failed" ||
      /Persistent ACP session \S+ could not be resumed/.test(m),
  },
  {
    // Real case (AMB-99): the acpx engine sends a `model` config option the
    // hermes-acp session does not advertise — an agent-config capability
    // mismatch, not a transient fault. Retrying the same run can never fix it.
    signal: "acpx_session_config_failed_code",
    category: "runtime.adapter_boot_failure",
    subcategory: "acp_session_config_mismatch",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (i, m) =>
      i.errorCode === "acpx_session_config_failed" ||
      /does not advertise config option '[\w.-]+'/.test(m),
  },
  {
    signal: "executable_not_found",
    category: "runtime.adapter_boot_failure",
    subcategory: "spawn_enoent",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (_i, m) => /spawn \S+ ENOENT/.test(m),
  },
  {
    signal: "node_module_not_found",
    category: "runtime.adapter_boot_failure",
    subcategory: "node_missing_module",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (_i, m) => /Cannot find module ['"][\w.@/-]+['"]/.test(m),
  },
  {
    // Pilibala-managed skill link could not be established because the shared
    // Hermes skills home path is occupied by a foreign install (observed
    // AMB-91 2026-10-21: a manual dev-checkout symlink at
    // ~/.hermes/skills/pilibala). Environmental: retrying the same run can
    // never fix it — the occupant must be quarantined/removed first (the
    // adapter now auto-quarantines symlinks/files; directories still fail
    // with guidance). L2 so the doctor ladder proposes the fix.
    signal: "hermes_skills_home_occupied",
    category: "runtime.adapter_boot_failure",
    subcategory: "skills_home_occupied",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (_i, m) => /is occupied by another installation/.test(m),
  },
];

/** Hermes CLI resume-policy refusal (AMB-90): frozen launch params vs resume flags. */
const SESSION_BINDING_RULES: Rule[] = [
  {
    signal: "hermes_resume_policy_provider_differs",
    category: "session_binding.resume_policy_refusal",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (_i, m) =>
      /Resume retains \w+ session policy/.test(m) && /--provider differs/.test(m),
  },
  {
    signal: "hermes_resume_policy_generic",
    category: "session_binding.resume_policy_refusal",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (_i, m) =>
      /overrides are unsupported on resume/.test(m) ||
      (/Resume retains/.test(m) && /differs from this session's launch/.test(m)),
  },
];

/** Provider endpoint failures shared by every adapter with an LLM endpoint. */
const PROVIDER_RULES: Rule[] = [
  {
    signal: "provider_auth_401",
    category: "provider.auth",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (i, m) => i.providerStatus === 401 || i.providerStatus === 403 || /\b(401|403)\b/.test(m) && /unauthorized|forbidden|invalid[_ ]api[_ ]key|authentication/i.test(m),
  },
  {
    signal: "provider_access_category",
    category: "provider.auth",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (i) => readTerminalSessionCategory(i.resultJson) === "access",
  },
  {
    signal: "provider_rate_limit_status",
    category: "provider.limit",
    retryPolicy: "wait_system",
    ladderHint: "L0",
    test: (i, m) => i.providerStatus === 429 || /\b429\b/.test(m) && /rate|limit|quota/i.test(m),
  },
  {
    signal: "provider_quota_message",
    category: "provider.limit",
    retryPolicy: "wait_system",
    ladderHint: "L0",
    test: (_i, m) =>
      /(?:usage|rate|quota) limit|you(?:'|’)ve hit your (?:\w+ )?limit|quota (?:exceeded|reset)|try again after/i.test(m),
  },
  {
    signal: "provider_limit_category",
    category: "provider.limit",
    retryPolicy: "wait_system",
    ladderHint: "L0",
    test: (i) => readTerminalSessionCategory(i.resultJson) === "limit",
  },
  {
    signal: "provider_connection_failure",
    category: "provider.connection",
    retryPolicy: "bounded",
    ladderHint: "L0",
    test: (_i, m) =>
      /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed|network error|EAI_AGAIN/.test(m),
  },
  {
    signal: "provider_service_category",
    category: "provider.connection",
    retryPolicy: "bounded",
    ladderHint: "L0",
    test: (i) => readTerminalSessionCategory(i.resultJson) === "service" || readTerminalSessionCategory(i.resultJson) === "connection",
  },
];

/** Closed errorCode passthroughs that already carry unambiguous semantics. */
const ERROR_CODE_RULES: Rule[] = [
  {
    signal: "error_code_server_shutdown",
    category: "infra.server_shutdown",
    retryPolicy: "bounded",
    ladderHint: "L0",
    test: (i) => i.errorCode === "server_shutdown_interrupted",
  },
  {
    signal: "error_code_process_lost",
    category: "runtime.process_lost",
    retryPolicy: "bounded",
    ladderHint: "L0",
    test: (i) => i.errorCode === "process_lost",
  },
  {
    signal: "error_code_workspace_validation",
    category: "workspace.validation_failed",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (i) => i.errorCode === "workspace_validation_failed",
  },
  {
    signal: "error_code_configuration_incomplete",
    category: "workspace.configuration_incomplete",
    retryPolicy: "never",
    ladderHint: "L2",
    test: (i) => i.errorCode === "configuration_incomplete",
  },
];

// Precedence: binding refusals and boot crashes outrank provider noise, and
// closed errorCodes outrank message heuristics (a run marked process_lost is
// not re-litigated by its stderr).
const RULES: Rule[] = [
  ...SESSION_BINDING_RULES,
  ...BOOT_RULES,
  ...PROVIDER_RULES,
  ...ERROR_CODE_RULES,
];

function readTerminalSessionCategory(resultJson: unknown): string | null {
  if (!resultJson || typeof resultJson !== "object") return null;
  const terminal = (resultJson as Record<string, unknown>).terminalSessionFailure;
  if (!terminal || typeof terminal !== "object") return null;
  const category = (terminal as Record<string, unknown>).category;
  return typeof category === "string" && /^[a-z_]{1,40}$/.test(category) ? category : null;
}

function readReasonCode(resultJson: unknown, key: string): string | undefined {
  if (!resultJson || typeof resultJson !== "object") return undefined;
  const payload = (resultJson as Record<string, unknown>)[key];
  if (!payload || typeof payload !== "object") return undefined;
  const reason = (payload as Record<string, unknown>).reason;
  return typeof reason === "string" && /^[a-z0-9_.]{1,80}$/.test(reason) ? reason : undefined;
}

/**
 * Classify one failed run. Unknown results always surface `ladderHint: "L2"`:
 * an unclassified failure must reach the doctor ladder (or the board), never
 * an automatic retry loop.
 */
export function classifyRunFailure(input: ClassifyRunFailureInput): RunFailureClassification {
  const message = typeof input.errorMessage === "string" ? input.errorMessage : "";
  for (const rule of RULES) {
    if (rule.test(input, message)) {
      const subcategory =
        rule.subcategory ??
        (rule.category === "workspace.validation_failed"
          ? readReasonCode(input.resultJson, "workspaceValidation")
          : rule.category === "workspace.configuration_incomplete"
            ? readReasonCode(input.resultJson, "configurationIncomplete")
            : undefined);
      return {
        category: rule.category,
        ...(subcategory ? { subcategory } : {}),
        retryPolicy: rule.retryPolicy,
        ladderHint: rule.ladderHint,
        matchedSignals: [rule.signal],
      };
    }
  }
  return {
    category: "unknown",
    retryPolicy: "never",
    ladderHint: "L2",
    matchedSignals: [],
  };
}
