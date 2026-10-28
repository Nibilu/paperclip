import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Use a dedicated port so e2e tests always start their own server in local_trusted mode,
// even when the dev server is running on :3100 in authenticated mode.
const PORT = Number(process.env.PILIBALA_E2E_PORT ?? 3199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PILIBALA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pilibala-e2e-home-"));
const PILIBALA_INSTANCE_ID = "playwright-e2e";
const PILIBALA_CONFIG = path.join(PILIBALA_HOME, "instances", PILIBALA_INSTANCE_ID, "config.json");
const PILIBALA_AGENT_JWT_SECRET = process.env.PILIBALA_AGENT_JWT_SECRET ?? "playwright-e2e-agent-jwt-secret";
const PILIBALA_DECISION_SIGNING_SECRET =
  process.env.PILIBALA_DECISION_SIGNING_SECRET ?? "playwright-e2e-decision-signing-secret";
const PILIBALA_TOOL_ACTION_SIGNING_SECRET =
  process.env.PILIBALA_TOOL_ACTION_SIGNING_SECRET ?? "playwright-e2e-tool-action-signing-secret";
const PLAYWRIGHT_CHANNEL = process.env.PILIBALA_PLAYWRIGHT_CHANNEL;

process.env.PILIBALA_HOME = PILIBALA_HOME;
process.env.PILIBALA_CONFIG = PILIBALA_CONFIG;
// Worker processes reload this config; retain the main process's server path
// for specs that seed historical database state in the throwaway instance.
process.env.PILIBALA_E2E_SERVER_CONFIG ??= PILIBALA_CONFIG;
// Specs that mint agent JWTs in-process (via createLocalAgentJwt) must derive
// the same per-instance signing key as the webServer, or verification fails
// with a 401 instead of authenticating as the agent.
process.env.PILIBALA_INSTANCE_ID = PILIBALA_INSTANCE_ID;
process.env.PILIBALA_AGENT_JWT_SECRET = PILIBALA_AGENT_JWT_SECRET;
process.env.PILIBALA_DECISION_SIGNING_SECRET = PILIBALA_DECISION_SIGNING_SECRET;
process.env.PILIBALA_TOOL_ACTION_SIGNING_SECRET = PILIBALA_TOOL_ACTION_SIGNING_SECRET;

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  // These suites target dedicated multi-user configurations/ports and are
  // intentionally not part of the default local_trusted e2e run.
  testIgnore: ["in-feed-native/**", "multi-user.spec.ts", "multi-user-authenticated.spec.ts"],
  timeout: 60_000,
  retries: 0,
  // All specs share one throwaway server, and several toggle instance-level
  // state (the `enableConferenceRoomChat` experimental flag) that changes
  // which UI variant renders. Run files serially so a flag flip in one spec
  // can't change the wizard/thread under another spec mid-flight.
  workers: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(PLAYWRIGHT_CHANNEL ? { channel: PLAYWRIGHT_CHANNEL } : {}),
      },
    },
  ],
  // The webServer directive bootstraps a throwaway instance and then starts it.
  // `onboard --yes --run` works in a non-interactive temp PILIBALA_HOME.
  webServer: {
    cwd: path.resolve(import.meta.dirname, "../.."),
    // Exercise the shipped UI. Source-checkout onboarding otherwise enables
    // Vite middleware: every reload traverses thousands of modules, including
    // service-worker-intercepted requests, before React can even start.
    // Build the server's first-choice static directory so a prior package build
    // cannot shadow the UI under test with stale server/ui-dist assets.
    command: "pnpm --filter @pilibalaai/ui build --outDir ../server/ui-dist --emptyOutDir && node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts onboard --yes --run",
    url: `${BASE_URL}/api/health`,
    // Always boot a dedicated throwaway instance for e2e so browser tests
    // never attach to the developer's active Pilibala home/server.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      PILIBALA_UI_DEV_MIDDLEWARE: "false",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${path.resolve(import.meta.dirname, "fixtures/agent-chat-github.mjs")} --import=${path.resolve(import.meta.dirname, "fixtures/ai-connection-provider.mjs")}`,
      PORT: String(PORT),
      PILIBALA_OPEN_ON_LISTEN: "false",
      PILIBALA_API_URL: BASE_URL,
      PILIBALA_HOME,
      PILIBALA_INSTANCE_ID,
      PILIBALA_CONFIG,
      PILIBALA_AGENT_JWT_SECRET,
      PILIBALA_DECISION_SIGNING_SECRET,
      PILIBALA_TOOL_ACTION_SIGNING_SECRET,
      PILIBALA_BIND: "loopback",
      PILIBALA_DEPLOYMENT_MODE: "local_trusted",
      PILIBALA_DEPLOYMENT_EXPOSURE: "private",
    },
  },
  outputDir: "./test-results",
  reporter: [
    ["list"], ["html", { open: "never", outputFolder: "./playwright-report" }],
    ...(process.env.PILIBALA_CI_PROFILE === "true"
      ? [[path.resolve(import.meta.dirname, "../../scripts/ci-profile/playwright-reporter.mjs")] as [string]]
      : []),
  ],
});
