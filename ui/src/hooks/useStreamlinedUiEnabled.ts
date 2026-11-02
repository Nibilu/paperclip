import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import type { InstanceExperimentalSettings } from "@pilibalaai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { isTemporaryApiError } from "@/api/response";
import { queryKeys } from "@/lib/queryKeys";

export function resolveStreamlinedUiEnabled(
  settings:
    | Pick<InstanceExperimentalSettings, "enableStreamlinedUi">
    | null
    | undefined,
): boolean {
  return settings?.enableStreamlinedUi !== false;
}

let detachedClient: QueryClient | null = null;
function getDetachedClient(): QueryClient {
  detachedClient ??= new QueryClient();
  return detachedClient;
}

/**
 * The streamlined shell is the default experience. Missing legacy values,
 * loading states, and read failures all fail open so the app never flashes or
 * falls back to the legacy shell unless an instance explicitly opts out.
 *
 * Boot-gate note: this query runs pre-auth and the endpoint 403s unauthenticated
 * by design. Auth errors are terminal, so they skip the retry ladder entirely
 * (react-query v5 keeps `error` null while retrying, which would otherwise
 * stall `loaded` for the full ~7.5s backoff before the auth gate mounts) and
 * `loaded` fails open as soon as a terminal error lands.
 */
export function useStreamlinedUiEnabled(): { enabled: boolean; loaded: boolean } {
  const contextClient = useContext(QueryClientContext);
  const query = useQuery(
    {
      queryKey: queryKeys.instance.experimentalSettings,
      queryFn: () => instanceSettingsApi.getExperimental(),
      enabled: contextClient != null,
      retry: (failureCount, error) => isTemporaryApiError(error) && failureCount < 3,
    },
    contextClient ?? getDetachedClient(),
  );

  if (!contextClient) return { enabled: true, loaded: true };

  return {
    enabled: resolveStreamlinedUiEnabled(query.data),
    loaded: query.isFetched || (query.error !== null && !isTemporaryApiError(query.error)),
  };
}
