import { describe, expect, it } from "vitest";
import { encodeEnvValue, updateEnvFileContents } from "./env-file.js";

describe("env file editor", () => {
  it("pins minimal and JSON value encoding", () => {
    expect(encodeEnvValue("plain-value", "minimal")).toBe("plain-value");
    expect(encodeEnvValue("#439edb", "minimal")).toBe('"#439edb"');
    expect(encodeEnvValue("plain-value", "json")).toBe('"plain-value"');
  });

  it("preserves unrelated content and CRLF while updating every stale duplicate", () => {
    const original = [
      "# operator comment",
      "UNKNOWN='keep this encoding'",
      "",
      "export PILIBALA_HOME = '/old path'  # managed path",
      "PILIBALA_DUPLICATE=stale",
      'PILIBALA_DUPLICATE="current"',
      "TRAILING=untouched",
      "",
    ].join("\r\n");

    const updated = updateEnvFileContents(
      original,
      {
        PILIBALA_HOME: "/new path",
        PILIBALA_DUPLICATE: "current",
        PILIBALA_WORKTREE_COLOR: "#439edb",
      },
      { valueEncoding: "minimal" },
    );

    expect(updated).toBe([
      "# operator comment",
      "UNKNOWN='keep this encoding'",
      "",
      'export PILIBALA_HOME = "/new path"  # managed path',
      "PILIBALA_DUPLICATE=current",
      'PILIBALA_DUPLICATE="current"',
      "TRAILING=untouched",
      'PILIBALA_WORKTREE_COLOR="#439edb"',
      "",
    ].join("\r\n"));
    expect(updated.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("uses JSON encoding for changed values without re-encoding current assignments", () => {
    const original = [
      "PILIBALA_CURRENT=plain-value",
      "PILIBALA_CHANGED=old",
      "UNKNOWN=\"operator value\"",
      "",
    ].join("\n");

    expect(
      updateEnvFileContents(
        original,
        {
          PILIBALA_CURRENT: "plain-value",
          PILIBALA_CHANGED: "new",
          PILIBALA_ADDED: "added",
        },
        { valueEncoding: "json" },
      ),
    ).toBe([
      "PILIBALA_CURRENT=plain-value",
      'PILIBALA_CHANGED="new"',
      'UNKNOWN="operator value"',
      'PILIBALA_ADDED="added"',
      "",
    ].join("\n"));
  });

  it("does not treat an unquoted dotenv comment as the managed value", () => {
    expect(
      updateEnvFileContents(
        ["PILIBALA_COLOR=#439edb", "PILIBALA_HOME=old# keep this comment"].join("\n"),
        {
          PILIBALA_COLOR: "#439edb",
          PILIBALA_HOME: "new",
        },
        { valueEncoding: "minimal" },
      ),
    ).toBe(
      ['PILIBALA_COLOR="#439edb"#439edb', "PILIBALA_HOME=new# keep this comment"].join("\n"),
    );
  });

  it("is a no-op when every managed duplicate is already current", () => {
    const original = [
      "export PILIBALA_HOME = '/same path' # first",
      'PILIBALA_HOME="/same path"',
      "UNKNOWN=value",
    ].join("\n");

    expect(updateEnvFileContents(original, { PILIBALA_HOME: "/same path" })).toBe(original);
  });
});
