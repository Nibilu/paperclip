/**
 * Development shim for the package-local runner runtime.
 *
 * Source-mode server entry points do not build workspace dependencies first,
 * so this shim loads the package source through the TypeScript runtime. The
 * server build replaces the emitted shim with the package's compiled `dist`
 * tree so published server packages have no workspace runtime dependency.
 * Keep server imports pointed at this relative boundary.
 */
type RunnerModule = typeof import("@pilibalaai/pilibala-runner");

export type {
  DotHarnessDriver,
  DotAssignment,
  PilibalaJsonValue,
  PilibalaQuestionResponse,
  PilibalaSemanticActionBinding,
  PilibalaSemanticActionId,
  PilibalaSemanticAuthorizationRecord,
  PilibalaSemanticRunContext,
  PilibalaSemanticToolCall,
  PilibalaSemanticToolDefinition,
  PilibalaSemanticToolResult,
  PilibalaRunnerAuthorizedToolSet,
  PilibalaQuestionSet,
  PilibalaRuntimeInputRequest,
  CompleteControlPlaneRunInput,
  ControlPlanePort,
  HarnessRuntimeRequestKind,
  HarnessRuntimeRequestResolution,
  LinuxProcessStartOptions,
  NativeAcpxAgent,
  NativeAcpxPermissionMode,
  NativeCodexApprovalPolicy,
  NativeExecutionInput,
  NativeExecutionInputV4,
  NativeExecutionInputV5,
  NativeExecutionInputV6,
  NativeExecutionInputV8,
  MuseBindingSnapshot,
  DotBindingSnapshot,
  ExternalProviderPort,
  ExternalProviderOperation,
  NativeExecutionInputV7,
  NativeCompletionSource,
  NativeCompletionSources,
  NativeInteractionResponseEnvelope,
  NativeOpenCodePermissionMode,
  NativePlanningContext,
  NativeRunEvent,
  NativeRunResult,
  NativeRuntimeAssetReference,
  NativeRuntimeContextSnapshot,
  NativeSession,
  NativeSessionBackend,
  NativeSessionGoalControl,
  OpenControlPlaneRunInput,
  PersistedNativeSession,
  PrpEvent,
  PrpIgnoredAttentionRequest,
  PrpNormalizedAttentionRequest,
  PrpStructuredRunResult,
  PrpTerminalState,
  PrpVerificationReasonCode,
  PrpWireConnection,
  ReplayControlPlaneEventsInput,
  RunnerExecutionDriver,
  RunnerProcessHandle,
  RunnerProcessLaunchSpec,
  StrictCompletionContractInput,
  TransportCloseReason,
} from "@pilibalaai/pilibala-runner";
export type DurablePrpControlPlane =
  import("@pilibalaai/pilibala-runner").DurablePrpControlPlane;
export type PilibalaSemanticDispatcher =
  import("@pilibalaai/pilibala-runner").PilibalaSemanticDispatcher;

const sourceUrl = new URL(
  "../../../../packages/pilibala-runner/src/index.ts",
  import.meta.url,
);
const runner = (await import(sourceUrl.href)) as RunnerModule;

export const DurablePrpControlPlane = runner.DurablePrpControlPlane;
export const runnerCodexDynamicToolsFit = runner.runnerCodexDynamicToolsFit;
export const inspectWarmRunTransition = runner.inspectWarmRunTransition;
export const readRunnerdArtifactBinding = runner.readRunnerdArtifactBinding;
export const readLinuxProcessStartedAt = runner.readLinuxProcessStartedAt;
export const NativeSessionCleanupQuarantinedError =
  runner.NativeSessionCleanupQuarantinedError;
export const NativeSessionProtocolIntegrityError =
  runner.NativeSessionProtocolIntegrityError;
export const SemanticToolOutcomeUnknownError = runner.SemanticToolOutcomeUnknownError;
export const PilibalaSemanticDispatcher = runner.PilibalaSemanticDispatcher;
export const CAPABILITY_SEMANTIC_TOOL_CATALOG =
  runner.CAPABILITY_SEMANTIC_TOOL_CATALOG;
export const HarnessRuntimeRequestResolutionError =
  runner.HarnessRuntimeRequestResolutionError;
export const NATIVE_RUNTIME_ASSET_SCHEMA = runner.NATIVE_RUNTIME_ASSET_SCHEMA;
export const PILIBALA_EXECUTION_PROMPT = runner.PILIBALA_EXECUTION_PROMPT;
export const PILIBALA_EXECUTION_PROMPT_REVISION =
  runner.PILIBALA_EXECUTION_PROMPT_REVISION;
export const acpxRuntimeSessionDirectoryName =
  runner.acpxRuntimeSessionDirectoryName;
export const canonicalNativeRuntimeContextDigest =
  runner.canonicalNativeRuntimeContextDigest;
export const createNativeSessionBackend = runner.createNativeSessionBackend;
export const describeRunnerdNativeSessionBackend = runner.describeRunnerdNativeSessionBackend;
export const createPilibalaRunnerAuthorizedToolSet =
  runner.createPilibalaRunnerAuthorizedToolSet;
export const createRunnerdCodexTransport: (
  options?: import("@pilibalaai/pilibala-runner").RunnerdCodexTransportOptions,
) => import("@pilibalaai/pilibala-runner").RunnerdCodexTransport =
  runner.createRunnerdCodexTransport;
export const defaultCapabilityRunnerdBinary =
  runner.defaultCapabilityRunnerdBinary;
export const runnerBinaryTarget = runner.runnerBinaryTarget;
export const executeNativeSession = runner.executeNativeSession;
export const applyNativeSessionGoalControl =
  runner.applyNativeSessionGoalControl;
export const completeRetainedNativeSessionCleanup = runner.completeRetainedNativeSessionCleanup;
export const settleRetainedRunnerdSession = runner.settleRetainedRunnerdSession;
export const retainedRunnerdMaintenanceIsIdle =
  runner.retainedRunnerdMaintenanceIsIdle;
export const drainRetainedRunnerdMaintenanceOperations =
  runner.drainRetainedRunnerdMaintenanceOperations;
export const nativeRuntimePromptDigest = runner.nativeRuntimePromptDigest;
export const normalizePrpResultSignals = runner.normalizePrpResultSignals;
export const parseCodexTurnDiff = runner.parseCodexTurnDiff;
export const parseHarnessRuntimeRequestResolution =
  runner.parseHarnessRuntimeRequestResolution;
export const parseNativeExecutionInput = runner.parseNativeExecutionInput;
export const buildNativeModelEnvelope = runner.buildNativeModelEnvelope;
export const isProviderMode = runner.isProviderMode;
export const parseNativeRuntimeContext = runner.parseNativeRuntimeContext;
export const parsePilibalaQuestionSet = runner.parsePilibalaQuestionSet;
export const parsePilibalaQuestionResponse =
  runner.parsePilibalaQuestionResponse;
export const resolveQualifiedAcpxProfile = runner.resolveQualifiedAcpxProfile;
export const QUALIFIED_ACPX_PROFILES = runner.QUALIFIED_ACPX_PROFILES;
export const QUALIFIED_ACPX_VERSION = runner.QUALIFIED_ACPX_VERSION;
export const CURSOR_DISTRIBUTION_PINS = runner.CURSOR_DISTRIBUTION_PINS;
export const resolveSourceCodexHome = runner.resolveSourceCodexHome;
export const resolveCodexCommand = runner.resolveCodexCommand;
export const resolvePinnedCodexCommand = runner.resolvePinnedCodexCommand;
export const validatePrpEvent = runner.validatePrpEvent;
export const validatePrpStructuredRunResult =
  runner.validatePrpStructuredRunResult;

export const NativeProviderTerminalFailure = runner.NativeProviderTerminalFailure;
export const nativeRestartInterruptedTurnId = runner.nativeRestartInterruptedTurnId;

export const completeTerminatedRemoteNativeSessionCleanup = runner.completeTerminatedRemoteNativeSessionCleanup;
export const completeTerminatedLocalNativeSessionCleanup = runner.completeTerminatedLocalNativeSessionCleanup;

export const probeAcpxClaudeInstallation = runner.probeAcpxClaudeInstallation;
export const probeAcpxGrokInstallation = runner.probeAcpxGrokInstallation;
export const probeAcpxPiInstallation = runner.probeAcpxPiInstallation;
export const bundledRemoteProviderPackManifestPath = runner.bundledRemoteProviderPackManifestPath;
export const bundledRemoteRunnerBinary = runner.bundledRemoteRunnerBinary;

export const externalOperationDigest = runner.externalOperationDigest;
export const digestPilibalaSemanticContent = runner.digestPilibalaSemanticContent;
export const CONFIGURED_ENVIRONMENT_KEYS = runner.CONFIGURED_ENVIRONMENT_KEYS;
export const GENERATED_RUNTIME_ENVIRONMENT_KEYS = runner.GENERATED_RUNTIME_ENVIRONMENT_KEYS;
export const configuredEnvironmentProjection = runner.configuredEnvironmentProjection;
export const configuredEnvironment = runner.configuredEnvironment;

export const probeNativeRunnerEnvironment = runner.probeNativeRunnerEnvironment;
