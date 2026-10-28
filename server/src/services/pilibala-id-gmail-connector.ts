/**
 * @deprecated Pilibala ID is identity-only. Import the Pilibala Cloud
 * connector names from `pilibala-cloud-connector.ts` for new code.
 *
 * These aliases keep source compatibility while deployments and persisted app
 * definitions move from the former Pilibala ID broker prototype.
 */
export {
  GMAIL_CONNECTOR_SCOPES,
  GMAIL_MCP_URL,
  GOOGLE_WORKSPACE_CONNECTOR_PROFILES,
  PilibalaCloudConnectorError as PilibalaIdConnectorError,
  createPilibalaCloudConnector as createPilibalaIdGmailConnector,
  pilibalaCloudConnectorCapabilitiesFromEnv as pilibalaIdGoogleConnectorCapabilitiesFromEnv,
  pilibalaCloudConnectorConfigFromEnv as pilibalaIdGmailConnectorConfigFromEnv,
} from "./pilibala-cloud-connector.js";

export type {
  PilibalaCloudConnector as PilibalaIdGmailConnector,
  PilibalaCloudConnector as PilibalaIdGoogleWorkspaceConnector,
  PilibalaCloudConnectorConfig as PilibalaIdGmailConnectorConfig,
  PilibalaCloudConnectorEnvironment as PilibalaIdConnectorEnvironment,
  PilibalaCloudConnectorOperation as PilibalaIdConnectorOperation,
  SealedGmailCredentials,
  SealedGoogleWorkspaceCredentials,
} from "./pilibala-cloud-connector.js";
