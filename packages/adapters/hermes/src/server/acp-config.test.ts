import { describe, expect, test } from "vitest";

import { buildHermesAcpConfig } from "./acp.js";

describe("buildHermesAcpConfig provider↔model transport guard", () => {
  test("qualifies the model id with the explicit provider so the association survives the ACP transport", () => {
    const config = buildHermesAcpConfig({
      provider: "nvidia",
      model: "deepseek-ai/deepseek-v4.1-flash",
    });
    expect(config.model).toBe("nvidia:deepseek-ai/deepseek-v4.1-flash");
    expect(config.agent).toBe("hermes");
  });

  test("does not double-prefix an already qualified id", () => {
    const config = buildHermesAcpConfig({
      provider: "nvidia",
      model: "nvidia:deepseek-ai/deepseek-v4.1-flash",
    });
    expect(config.model).toBe("nvidia:deepseek-ai/deepseek-v4.1-flash");
  });

  test("leaves the model untouched without an explicit provider (Hermes native resolution)", () => {
    expect(buildHermesAcpConfig({ model: "deepseek-ai/deepseek-v4.1-flash" }).model).toBe(
      "deepseek-ai/deepseek-v4.1-flash",
    );
    expect(buildHermesAcpConfig({}).model).toBeUndefined();
  });

  test("ignores an auto provider", () => {
    expect(
      buildHermesAcpConfig({ provider: "auto", model: "deepseek-ai/deepseek-v4.1-flash" }).model,
    ).toBe("deepseek-ai/deepseek-v4.1-flash");
  });
});
