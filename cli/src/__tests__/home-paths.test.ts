import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeLocalInstancePaths,
  expandHomePrefix,
  resolvePilibalaHomeDir,
  resolvePilibalaInstanceId,
} from "../config/home.js";

const ORIGINAL_ENV = { ...process.env };

describe("home path resolution", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to ~/.pilibala and default instance", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pilibala-home-paths-"));
    process.env.PILIBALA_HOME = home;
    delete process.env.PILIBALA_INSTANCE_ID;

    const paths = describeLocalInstancePaths();
    expect(paths.homeDir).toBe(home);
    expect(paths.instanceId).toBe("default");
    expect(paths.configPath).toBe(path.resolve(home, "instances", "default", "config.json"));
  });

  it("supports PILIBALA_HOME and explicit instance ids", () => {
    process.env.PILIBALA_HOME = "~/pilibala-home";

    const home = resolvePilibalaHomeDir();
    expect(home).toBe(path.resolve(os.homedir(), "pilibala-home"));
    expect(resolvePilibalaInstanceId("dev_1")).toBe("dev_1");
  });

  it("rejects invalid instance ids", () => {
    expect(() => resolvePilibalaInstanceId("bad/id")).toThrow(/Invalid PILIBALA_INSTANCE_ID/);
  });

  it("expands ~ prefixes", () => {
    expect(expandHomePrefix("~")).toBe(os.homedir());
    expect(expandHomePrefix("~/x/y")).toBe(path.resolve(os.homedir(), "x/y"));
  });
});
