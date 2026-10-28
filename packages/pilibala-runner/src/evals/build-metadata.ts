import { createHash } from "node:crypto";

import { PILIBALA_RUNNER_COMPATIBILITY } from "../compatibility.js";
import {
  PRP_PROTOCOL_MIN_VERSION,
  PRP_PROTOCOL_NAME,
  PRP_PROTOCOL_VERSION,
} from "../protocol/replay-contract.js";
import { canonicalCapabilitySemanticCatalog } from "../semantic-tools/catalog.js";

export const PILIBALA_RUNNER_BUILD_METADATA_SCHEMA =
  "pilibala-runner/build-metadata/v1" as const;
export const PILIBALA_RUNNER_NATIVE_EXECUTION_SCHEMA =
  "pilibala-runner/native-execution/v1" as const;
export const PILIBALA_RUNNER_EVAL_INTEGRATION_SCHEMA =
  "pilibala-runner/evals-integration/v1" as const;
export const PILIBALA_RUNNERD_BUILD_METADATA_SCHEMA =
  "pilibala-runner/runnerd-build-metadata/v1" as const;

export const PILIBALA_RUNNER_SEMANTIC_CATALOG_SHA256 =
  `sha256:${createHash("sha256")
    .update(canonicalCapabilitySemanticCatalog())
    .digest("hex")}` as const;

/**
 * App-owned release metadata that Evals pins beside every native attempt.
 * Contract versions are independent from package semver so consumers can give
 * a precise mismatch instead of guessing from a package version.
 */
export const PILIBALA_RUNNER_BUILD_METADATA = Object.freeze({
  schema: PILIBALA_RUNNER_BUILD_METADATA_SCHEMA,
  package: Object.freeze({
    name: PILIBALA_RUNNER_COMPATIBILITY.packageName,
    version: PILIBALA_RUNNER_COMPATIBILITY.packageVersion,
  }),
  contracts: Object.freeze({
    evalIntegration: PILIBALA_RUNNER_COMPATIBILITY.components.evalIntegration,
    nativeExecution: PILIBALA_RUNNER_COMPATIBILITY.components.nativeExecution,
    runnerdArtifact: PILIBALA_RUNNER_COMPATIBILITY.components.runnerdBinary,
    prp: PRP_PROTOCOL_VERSION,
    semanticCatalog: PILIBALA_RUNNER_COMPATIBILITY.components.catalog,
    harnessDriver: PILIBALA_RUNNER_COMPATIBILITY.components.harnessDriver,
    controlPlaneAdapter: PILIBALA_RUNNER_COMPATIBILITY.components.controlPlaneAdapter,
    testkit: PILIBALA_RUNNER_COMPATIBILITY.components.testkit,
  }),
  prp: Object.freeze({
    name: PRP_PROTOCOL_NAME,
    minimumVersion: PRP_PROTOCOL_MIN_VERSION,
    maximumVersion: PRP_PROTOCOL_VERSION,
  }),
  semanticCatalog: Object.freeze({
    version: PILIBALA_RUNNER_COMPATIBILITY.components.catalog,
    sha256: PILIBALA_RUNNER_SEMANTIC_CATALOG_SHA256,
  }),
  runnerd: Object.freeze({
    binaryName: "pilibala-runnerd" as const,
    metadataSchema: PILIBALA_RUNNERD_BUILD_METADATA_SCHEMA,
    digestAlgorithm: "sha256" as const,
  }),
});

export type PilibalaRunnerBuildMetadata = typeof PILIBALA_RUNNER_BUILD_METADATA;
