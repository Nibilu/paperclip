import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PILIBALA_ISSUE_PERF_PORT ?? 3201);
const EXTERNAL_URL = process.env.PILIBALA_ISSUE_PERF_BASE_URL;
if (EXTERNAL_URL) {
  const target = new URL(EXTERNAL_URL);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.username || target.password || target.search || target.hash || target.pathname !== "/"
  ) {
    throw new Error("PILIBALA_ISSUE_PERF_BASE_URL must be a loopback origin for a disposable local instance; these tests create fixtures.");
  }
}
const BASE_URL = EXTERNAL_URL ?? `http://127.0.0.1:${PORT}`;
const PILIBALA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pilibala-issue-perf-home-"));
const PILIBALA_INSTANCE_ID = "playwright-issue-perf";
const PILIBALA_CONFIG = path.join(PILIBALA_HOME, "instances", PILIBALA_INSTANCE_ID, "config.json");

process.env.PILIBALA_HOME = PILIBALA_HOME;
process.env.PILIBALA_CONFIG = PILIBALA_CONFIG;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 30 * 60_000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    headless: true,
  },
  webServer: EXTERNAL_URL ? undefined : {
    command: "pnpm pilibalaai onboard --yes --run",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      PILIBALA_OPEN_ON_LISTEN: "false",
      PILIBALA_HOME,
      PILIBALA_INSTANCE_ID,
      PILIBALA_CONFIG,
      PILIBALA_AGENT_JWT_SECRET: "playwright-issue-perf-agent-jwt-secret",
      PILIBALA_TOOL_ACTION_SIGNING_SECRET: "playwright-issue-perf-tool-action-signing-secret",
      PILIBALA_BIND: "loopback",
      PILIBALA_DEPLOYMENT_MODE: "local_trusted",
      PILIBALA_DEPLOYMENT_EXPOSURE: "private",
    },
  },
  outputDir: "../../../test-results/issue-detail-perf/playwright",
  reporter: [["list"]],
});
