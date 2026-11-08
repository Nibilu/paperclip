import type { PilibalaPluginManifestV1 } from "@pilibalaai/plugin-sdk";

const PLUGIN_ID = "pilibala.boxd-sandbox-provider";
const PLUGIN_VERSION = "0.1.0";

const manifest: PilibalaPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "boxd Sandbox Provider",
  description:
    "Sandbox provider plugin that runs Pilibala environments on boxd microVMs, with suspend and resume for reused leases.",
  author: "boxd",
  categories: ["automation"],
  capabilities: ["environment.drivers.register"],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  environmentDrivers: [
    {
      driverKey: "boxd",
      kind: "sandbox_provider",
      displayName: "boxd Machine",
      description:
        "Creates an isolated boxd machine for each run. With reuse on, the machine is suspended after a run and resumed with its disk, memory and processes for the next run.",
      sandboxCapabilities: { reusableLeases: true },
      configSchema: {
        type: "object",
        properties: {
          apiKey: {
            type: "string",
            format: "secret-ref",
            description:
              "Paste a boxd API key (`bxd_...`) or pick a saved Pilibala secret. Create one with `boxd auth keys create pilibala --org <org>`. The key decides which org the machines belong to.",
          },
          reuseLease: {
            type: "boolean",
            description:
              "Suspend the machine after a run and resume it for the next run on the same issue, instead of deleting it. Disk, memory and running processes are kept.",
            default: false,
          },
          snapshot: {
            type: "string",
            description:
              "Optional snapshot name or ID to restore for each run, for example a machine with your tools preinstalled. Leave blank to start from the default boxd image (Ubuntu 24.04 with Node 24, git, Docker, Claude Code, Codex and OpenCode).",
            "x-pilibala-advanced": true,
            "x-pilibala-group": "Machine",
          },
          vcpu: {
            type: "number",
            enum: [1, 2, 4, 8],
            description:
              "Machine size for fresh machines: 1 vCPU/4 GB, 2/8 GB, 4/16 GB or 8/32 GB. Leave blank for the org default. A snapshot keeps its own size.",
            "x-pilibala-advanced": true,
            "x-pilibala-group": "Machine",
          },
          org: {
            type: "string",
            description: "Optional org name or ID. Leave blank to use the API key's org.",
            "x-pilibala-advanced": true,
            "x-pilibala-group": "Machine",
          },
          namePrefix: {
            type: "string",
            description: "Prefix for machine names. Machines are reachable at https://<name>.boxd.sh.",
            default: "pilibala",
            "x-pilibala-advanced": true,
            "x-pilibala-group": "Machine",
          },
          timeoutMs: {
            type: "number",
            description: "Default command timeout in milliseconds. Pilibala also uses it as the default run timeout for this environment.",
            default: 3600000,
            "x-pilibala-advanced": true,
            "x-pilibala-group": "Runtime",
          },
        },
      },
    },
  ],
};

export default manifest;
