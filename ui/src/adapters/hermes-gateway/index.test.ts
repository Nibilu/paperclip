import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "../types";
import { hermesGatewayUIAdapter } from "./index";

/**
 * The builder reads only `url` and `adapterSchemaValues` from the create
 * values, so the tests pass just those and cast through unknown — the full
 * CreateConfigValues shape belongs to the wizard, not to this mapping.
 */
function createValues(values: Record<string, unknown>): CreateConfigValues {
  return values as unknown as CreateConfigValues;
}

describe("hermesGatewayUIAdapter.buildAdapterConfig", () => {
  it("maps the wizard's url field to apiBaseUrl", () => {
    // The onboarding wizard collects the gateway address through its generic
    // `url` field; the full agent configuration form passes it as the schema
    // field `apiBaseUrl`.
    const config = hermesGatewayUIAdapter.buildAdapterConfig(
      createValues({ url: "http://127.0.0.1:8642" }),
    );

    expect(config.apiBaseUrl).toBe("http://127.0.0.1:8642");
  });

  it("leaves an explicit apiBaseUrl from the schema values untouched", () => {
    const config = hermesGatewayUIAdapter.buildAdapterConfig(
      createValues({ url: "http://stale:1", adapterSchemaValues: { apiBaseUrl: "http://real:8642" } }),
    );

    expect(config.apiBaseUrl).toBe("http://real:8642");
  });

  it("does not invent an address from an empty url", () => {
    const config = hermesGatewayUIAdapter.buildAdapterConfig(
      createValues({ url: "   " }),
    );

    expect(config.apiBaseUrl).toBeUndefined();
  });
});
