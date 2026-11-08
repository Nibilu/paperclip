// Generated from acpx-profiles.json and cursor-distributions.json. Do not edit.
pub(crate) const QUALIFIED_ACPX_VERSION: &str = "0.13.1";
pub(crate) const ACPX_DRIVER_KIND: &str = "acpx_runtime";

#[derive(Debug)]
pub(crate) struct AcpxReleaseProfile {
    pub agent_server_package: &'static str,
    pub agent_server_version: &'static str,
    pub agent_runtime_package: Option<&'static str>,
    pub agent_runtime_version: Option<&'static str>,
    pub command_digest: &'static str,
    pub requires_provider_policy: bool,
    pub qualification_pending: bool,
}

pub(crate) fn kimi_native_closure(platform: &str, architecture: &str) -> Option<&'static str> {
    match (platform, architecture) {
        ("darwin", "arm64") => {
            Some("6038325abd0431c30097ff1f572a9b29816e1b4da372d8cb86b2ca5d18ea34e7")
        }
        ("linux", "x64") => {
            Some("105d8394adbbc76a953a12cc51b5288eb940ad693291e584f6cdc6407213164d")
        }
        _ => None,
    }
}

pub(crate) fn acpx_release_profile(agent: &str) -> Option<AcpxReleaseProfile> {
    Some(match agent {
        "antigravity" => AcpxReleaseProfile {
            agent_server_package: "native:antigravity-acp",
            agent_server_version: "1.4.3",
            agent_runtime_package: Some("native:antigravity-localharness"),
            agent_runtime_version: Some("1.4.3"),
            command_digest:
                "sha256:988eaf3acfe8d2bee5a5442a1c3e008c0c06d4712526e55f0ac89913c22104eb",
            requires_provider_policy: true,
            qualification_pending: true,
        },
        "grok" => AcpxReleaseProfile {
            agent_server_package: "builtin:grok-acp",
            agent_server_version: "1",
            agent_runtime_package: Some("native:grok"),
            agent_runtime_version: Some("1.0.13"),
            command_digest:
                "sha256:55d8b55cd4959933ef3f8c2ad227c1c3ebaabda4a8f2fd921e687046fd015a6f",
            requires_provider_policy: false,
            qualification_pending: false,
        },
        "pi" => AcpxReleaseProfile {
            agent_server_package: "pi-acp",
            agent_server_version: "0.0.33",
            agent_runtime_package: Some("@earendil-works/pi-coding-agent"),
            agent_runtime_version: Some("1.0.0"),
            command_digest:
                "sha256:789d035dee19302a494e4d3ad36f59c4691d004a255e9ac99fb4bca7e9e2789b",
            requires_provider_policy: true,
            qualification_pending: false,
        },
        "cursor" => AcpxReleaseProfile {
            agent_server_package: "cursor-agent",
            agent_server_version: "2026.09.26-dd393fe",
            agent_runtime_package: None,
            agent_runtime_version: None,
            command_digest:
                "sha256:f4fd9aa154e07af07c389b41da0a42797ad3c3b19ccd0b14492a33b57a993cfc",
            requires_provider_policy: true,
            qualification_pending: false,
        },
        "copilot" => AcpxReleaseProfile {
            agent_server_package: "@github/copilot",
            agent_server_version: "1.0.88",
            agent_runtime_package: None,
            agent_runtime_version: None,
            command_digest:
                "sha256:6d342295a740b5955185ab9c1f0fff5e8d7d3fffe78ae301e31b9b5f9bbff5f6",
            requires_provider_policy: true,
            qualification_pending: false,
        },
        "claude" => AcpxReleaseProfile {
            agent_server_package: "@agentclientprotocol/claude-agent-acp",
            agent_server_version: "0.73.0",
            agent_runtime_package: Some("@anthropic-ai/claude-agent-sdk"),
            agent_runtime_version: Some("0.3.286"),
            command_digest:
                "sha256:9d73d1f0f121fb96cc8badb28c22d5bff02d8582eb2e40360a81c189e1b9422a",
            requires_provider_policy: false,
            qualification_pending: false,
        },
        "codex" => AcpxReleaseProfile {
            agent_server_package: "@agentclientprotocol/codex-acp",
            agent_server_version: "1.6.2",
            agent_runtime_package: Some("@openai/codex"),
            agent_runtime_version: Some("0.160.0"),
            command_digest:
                "sha256:443491f4e814501a5dc47347e4510e84faeec9c9382e2d4e53bfe69386d5aabc",
            requires_provider_policy: false,
            qualification_pending: false,
        },
        "kimi" => AcpxReleaseProfile {
            agent_server_package: "@moonshot-ai/kimi-code",
            agent_server_version: "2.3.3",
            agent_runtime_package: None,
            agent_runtime_version: None,
            command_digest:
                "sha256:3989972460350ceefea24ab99fc7e3d4defde041f3fdd4c78b904a2f98d1f215",
            requires_provider_policy: true,
            qualification_pending: false,
        },
        _ => return None,
    })
}
