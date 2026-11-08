import { defaultSlackAppConfiguration } from "@pilibalaai/shared";

export function slackBotNameForAgent(agentName: string): string {
  return defaultSlackAppConfiguration(agentName).botName;
}

export function defaultSlackAppName(agentName: string): string {
  return defaultSlackAppConfiguration(agentName).appName;
}
