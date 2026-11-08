import { createRoot, type Root } from "react-dom/client";

export interface PilibalaReactRootHost {
  __pilibalaReactRoot?: Root;
}

type CreateRoot = (container: Parameters<typeof createRoot>[0]) => Root;

/**
 * Keep one React root per browser window even if Vite evaluates the entry
 * module more than once during a development reload.
 */
export function getOrCreatePilibalaReactRoot(
  host: object,
  container: Parameters<typeof createRoot>[0],
  create: CreateRoot = createRoot,
): Root {
  const rootHost = host as PilibalaReactRootHost;
  if (rootHost.__pilibalaReactRoot) return rootHost.__pilibalaReactRoot;

  const root = create(container);
  rootHost.__pilibalaReactRoot = root;
  return root;
}
