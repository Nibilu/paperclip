import { SlackAdapter } from "@chat-adapter/slack";
import type { LinkPreview } from "chat";

export class PilibalaSlackAdapter extends SlackAdapter {
  // The SDK polls for an optional Slack unfurl for two seconds before it
  // delivers a message containing a URL. Pilibala accepts the message text,
  // links and files directly; preview metadata is not part of task admission.
  protected override async enrichLinks(links: LinkPreview[]): Promise<LinkPreview[]> {
    return links;
  }
}
