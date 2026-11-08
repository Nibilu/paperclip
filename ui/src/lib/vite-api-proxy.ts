import type { ProxyOptions } from "vite";

// Shared /api proxy used by both the vite dev server and `vite preview`.
// The `configure` hook forwards the client's original Host as
// x-forwarded-host so the pilibala server's board mutation guard treats
// the browser's Origin as trusted when the SPA is served from a different
// port than the API (e.g. `pnpm dev:mobile` on :3101 → API on :3100).
export function createApiProxy(
  target = process.env.PILIBALA_API_PROXY_TARGET ?? "http://localhost:3100",
): Record<string, ProxyOptions> {
  return {
    "/api": {
      target,
      ws: true,
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq, req) => {
          const originalHost = req.headers.host;
          if (!originalHost) return;
          proxyReq.setHeader("x-forwarded-host", originalHost);
          // Prefer an upstream x-forwarded-proto (an HTTPS tunnel such as
          // ngrok or tailscale funnel terminates TLS and forwards HTTP to
          // vite with the header set). Fall back to the socket's TLS state.
          const upstreamProto = req.headers["x-forwarded-proto"];
          const proto = Array.isArray(upstreamProto) ? upstreamProto[0] : upstreamProto;
          const isTls = (req.socket as { encrypted?: boolean }).encrypted === true;
          proxyReq.setHeader("x-forwarded-proto", proto ?? (isTls ? "https" : "http"));
        });
      },
    },
    // MCP streamable-HTTP endpoints live on the API process (/mcp/runtime-tools,
    // /mcp/gateways/:id, /mcp/project-tools, /mcp/runner/*). The SPA has no /mcp
    // routes, so forwarding the whole prefix is safe; without this, a public
    // hostname served by `vite preview` 404s the MCP handshake and agent
    // sessions see "MCP server `Pilibala_connections` failed to start".
    "/mcp": {
      target,
      ws: true,
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq, req) => {
          const originalHost = req.headers.host;
          if (!originalHost) return;
          proxyReq.setHeader("x-forwarded-host", originalHost);
          const upstreamProto = req.headers["x-forwarded-proto"];
          const proto = Array.isArray(upstreamProto) ? upstreamProto[0] : upstreamProto;
          const isTls = (req.socket as { encrypted?: boolean }).encrypted === true;
          proxyReq.setHeader("x-forwarded-proto", proto ?? (isTls ? "https" : "http"));
        });
      },
    },
  };
}
