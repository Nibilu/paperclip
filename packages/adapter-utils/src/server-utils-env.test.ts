import { describe, expect, it } from "vitest";
import { sanitizeInheritedPilibalaEnv } from "./server-utils.js";

describe("sanitizeInheritedPilibalaEnv", () => {
  it("drops the host-only Pilibala CLI command pointer", () => {
    expect(sanitizeInheritedPilibalaEnv({
      PILIBALAAI_CMD: "node /missing/pilibalaai/dist/index.js",
      PILIBALA_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    })).toEqual({
      PILIBALA_RUNTIME_API_URL: "http://127.0.0.1:3100",
      PATH: "/usr/bin",
    });
  });
});
