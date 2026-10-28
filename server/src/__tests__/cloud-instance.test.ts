import { describe, expect, it } from "vitest";
import {
  getCloudStackContext,
  isCloudManagedInstance,
  type CloudInstanceEnv,
} from "../services/cloud-instance.js";

describe("isCloudManagedInstance", () => {
  it("unifies both prior signals without weakening either restrictive floor", () => {
    const cases: CloudInstanceEnv[] = [
      {},
      { PILIBALA_CLOUD_TENANT_SERVER_TOKEN: "tenant-token" },
      { PILIBALA_MANAGED_CONFIG: "" },
      {
        PILIBALA_CLOUD_TENANT_SERVER_TOKEN: "tenant-token",
        PILIBALA_MANAGED_CONFIG: "managed-document",
      },
    ];

    for (const env of cases) {
      const priorTokenFloor = Boolean(env.PILIBALA_CLOUD_TENANT_SERVER_TOKEN?.trim());
      const priorManagedConfigFloor = env.PILIBALA_MANAGED_CONFIG !== undefined;
      const canonicalFloor = isCloudManagedInstance(env);

      expect(canonicalFloor).toBe(priorTokenFloor || priorManagedConfigFloor);
      expect(canonicalFloor || !priorTokenFloor).toBe(true);
      expect(canonicalFloor || !priorManagedConfigFloor).toBe(true);
    }
  });

  it("does not treat a blank tenant token alone as a managed signal", () => {
    expect(isCloudManagedInstance({ PILIBALA_CLOUD_TENANT_SERVER_TOKEN: "   " })).toBe(false);
  });
});

describe("getCloudStackContext", () => {
  it("returns null outside Pilibala Cloud even when stray stack metadata exists", () => {
    expect(getCloudStackContext({ PILIBALA_STACK_SLUG: "stray-stack" })).toBeNull();
  });

  it("returns normalized provisioner metadata for cloud instances", () => {
    expect(getCloudStackContext({
      PILIBALA_CLOUD_TENANT_SERVER_TOKEN: "tenant-token",
      PILIBALA_CLOUD_STACK_ID: " stack-1 ",
      PILIBALA_STACK_SLUG: " acme ",
      PILIBALA_CLOUD_ACCOUNT_GROUP_ID: " account-group-1 ",
      PILIBALA_PRIMARY_HOST: " acme.pilibala.app ",
      PILIBALA_CLOUD_API_ORIGIN: " https://app.pilibala.app ",
    })).toEqual({
      stackId: "stack-1",
      stackSlug: "acme",
      accountGroupId: "account-group-1",
      primaryHost: "acme.pilibala.app",
      cloudOrigin: "https://app.pilibala.app",
    });
  });

  it("represents missing managed metadata explicitly without failing health checks", () => {
    expect(getCloudStackContext({ PILIBALA_MANAGED_CONFIG: "managed-document" })).toEqual({
      stackId: null,
      stackSlug: null,
      accountGroupId: null,
      primaryHost: null,
      cloudOrigin: null,
    });
  });
});
