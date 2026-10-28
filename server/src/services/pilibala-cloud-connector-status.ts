import {
  pilibalaCloudConnectorEnrollmentStatus,
  type PilibalaCloudConnectorEnrollmentStatus,
} from "./pilibala-cloud-connector-enrollment.js";
import {
  createPilibalaCloudConnector,
  pilibalaCloudConnectorConfigFromEnv,
} from "./pilibala-cloud-connector.js";

export async function reconcilePilibalaCloudConnectorEnrollmentStatus(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): Promise<PilibalaCloudConnectorEnrollmentStatus> {
  const local = pilibalaCloudConnectorEnrollmentStatus(env);
  if (!local.configured) return local;
  const config = pilibalaCloudConnectorConfigFromEnv(env);
  if (!config) return { ...local, configured: false, status: "not_configured" };
  try {
    const status = await createPilibalaCloudConnector({ config, request }).getInstanceStatus();
    if (status === "active") return { ...local, configured: true, status: "active" };
    if (status === "suspended") return { ...local, configured: false, status: "suspended" };
    return { ...local, configured: false, status: "not_configured" };
  } catch {
    return { ...local, configured: false, status: "unverified" };
  }
}
