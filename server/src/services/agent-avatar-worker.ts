import { parentPort } from "node:worker_threads";
import sharp from "sharp";
import { renderAgentSvg } from "@pilibalaai/shared/cliplab/static";
import { PILIBALA_DARK_AVATAR_BACKGROUND } from "@pilibalaai/shared";
import type { AgentAvatarRequest } from "./agent-avatars.js";

parentPort!.on("message", async (request: AgentAvatarRequest) => {
  try {
    const svg = renderAgentSvg(request.appearance, request.size, request.scale, request.pose, request.muted);
    const image = sharp(Buffer.from(svg));
    if (request.background === "pilibala-dark") image.flatten({ background: PILIBALA_DARK_AVATAR_BACKGROUND });
    const png = await image.png().toBuffer();
    parentPort!.postMessage({ png });
  } catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : "Avatar rendering failed" });
  }
});
