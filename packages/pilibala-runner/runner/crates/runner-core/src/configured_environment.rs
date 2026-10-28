//! Controller-selected task environment; mirrors configured-environment.ts.
use crate::local_runner::LocalRunnerError;
use std::process::Command;

const MARKER: &str = "PILIBALA_CONFIGURED_ENV_KEYS";
const RESERVED: &[&str] = &[
    "AGENT_HOME",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
    "BASH_ENV",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CODEX_API_KEY",
    "CODEX_HOME",
    "COPILOT_GITHUB_TOKEN",
    "CURSOR_API_KEY",
    "CURSOR_AUTH_TOKEN",
    "ENV",
    "GH_ENTERPRISE_TOKEN",
    "GH_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
    "GITHUB_TOKEN",
    "HOME",
    "NODE_OPTIONS",
    "NODE_PATH",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "PILIBALA_ACPX_CREDENTIAL_BINDING",
    "PILIBALA_AGENT_ID",
    "PILIBALA_AGENT_KEY_ID",
    "PILIBALA_AGENT_MESSAGE_KEY",
    "PILIBALA_AGENT_PRIVATE_KEY",
    "PILIBALA_AGENT_PUBLIC_KEY",
    "PILIBALA_AI_PROVIDER_KEY",
    "PILIBALA_API_BRIDGE_MODE",
    "PILIBALA_API_KEY",
    "PILIBALA_API_URL",
    "PILIBALA_APPROVAL_ID",
    "PILIBALA_APPROVAL_STATUS",
    "PILIBALA_COMPANY_ID",
    "PILIBALA_CONFIGURED_ENV_KEYS",
    "PILIBALA_EXECUTION_MODE",
    "PILIBALA_EXTERNAL_CHAT_EXECUTION_BOUND_KEY",
    "PILIBALA_GITHUB_AUTH_MODE",
    "PILIBALA_GITHUB_BRIDGE_TOKEN",
    "PILIBALA_GITHUB_BROKER_TOKEN",
    "PILIBALA_GITHUB_BROKER_URL",
    "PILIBALA_GITHUB_HOST_HOME",
    "PILIBALA_GITHUB_LAUNCHER_DIR",
    "PILIBALA_GIT_METADATA_ROOTS",
    "PILIBALA_GIT_TOKEN",
    "PILIBALA_HARNESS_CHECKOUT_KEY",
    "PILIBALA_INSTANCE_ID",
    "PILIBALA_LINKED_ISSUE_IDS",
    "PILIBALA_NATIVE_MCP_NAME",
    "PILIBALA_NATIVE_MCP_TOKEN",
    "PILIBALA_NATIVE_MCP_URL",
    "PILIBALA_NATIVE_MCP_STDIO",
    "PILIBALA_NATIVE_MCP_PROXY",
    "PILIBALA_NORMALIZED_SESSION_ID",
    "PILIBALA_PROVIDER_TRACE_MAX_BYTES",
    "PILIBALA_PROVIDER_TRACE_PATH",
    "PILIBALA_RUNNER_BOOTSTRAP_TICKET",
    "PILIBALA_RUNNER_EXTERNAL_SANDBOX",
    "PILIBALA_RUNNER_INSTANCE_ID",
    "PILIBALA_RUNNER_NETWORK_ACCESS",
    "PILIBALA_RUNNER_NETWORK_ROOTS",
    "PILIBALA_RUNTIME_PRIMARY_URL",
    "PILIBALA_RUNTIME_SERVICES_JSON",
    "PILIBALA_RUNTIME_SERVICE_INTENTS_JSON",
    "PILIBALA_RUN_ID",
    "PILIBALA_TASK_ID",
    "PILIBALA_WAKE_COMMENT_ID",
    "PILIBALA_WAKE_PAYLOAD_JSON",
    "PILIBALA_WAKE_REASON",
    "PILIBALA_WORKSPACES_JSON",
    "PILIBALA_WORKSPACE_AUTHORITATIVE_ROOT",
    "PILIBALA_WORKSPACE_BRANCH",
    "PILIBALA_WORKSPACE_CWD",
    "PILIBALA_WORKSPACE_ID",
    "PILIBALA_WORKSPACE_REALIZATION_MODE",
    "PILIBALA_WORKSPACE_REPO_REF",
    "PILIBALA_WORKSPACE_REPO_URL",
    "PILIBALA_WORKSPACE_SOURCE",
    "PILIBALA_WORKSPACE_WORKTREE_PATH",
    "PATH",
    "PERL5LIB",
    "PERL5OPT",
    "PYTHONHOME",
    "PYTHONPATH",
    "RUBYLIB",
    "RUBYOPT",
    "SHELL",
    "USERPROFILE",
    "XAI_API_KEY",
];

fn eligible_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    !key.is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .enumerate()
            .all(|(i, b)| b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit()))
        && !RESERVED.contains(&upper.as_str())
        && ![
            "LD_",
            "DYLD_",
            "GIT_CONFIG_",
            "PILIBALA_RUNNER_",
            "PILIBALA_NATIVE_",
            "PILIBALA_GITHUB_",
            "PILIBALA_ACPX_",
            "PILIBALA_VERIFIED_",
        ]
        .iter()
        .any(|prefix| upper.starts_with(prefix))
}

pub(crate) fn apply_configured_environment(
    command: &mut Command,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<(), LocalRunnerError> {
    let Some(raw) = lookup(MARKER) else {
        return Ok(());
    };
    let invalid = || LocalRunnerError::invalid("invalid configured environment projection");
    if raw.len() > 20_000 {
        return Err(invalid());
    }
    let mut names: Vec<String> = serde_json::from_str(&raw).map_err(|_| invalid())?;
    if names.len() > 128 || names.iter().any(|name| !eligible_key(name)) {
        return Err(invalid());
    }
    names.sort();
    if names.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(invalid());
    }
    let mut bytes = 0;
    // Validate all values before modifying the child launch specification.
    let mut values = Vec::new();
    for name in &names {
        let value = lookup(name).ok_or_else(invalid)?;
        let size = name.len() + value.len();
        bytes += size;
        if value.contains('\0') || size > 65_536 || bytes > 262_144 {
            return Err(invalid());
        }
        values.push((name, value));
    }
    command.envs(values);
    command.env(
        MARKER,
        serde_json::to_string(&names).map_err(|_| invalid())?,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn rejects_reserved_malformed_missing_and_oversized_environment() {
        for raw in [
            "not-json",
            "[1]",
            "[\"NODE_OPTIONS\"]",
            "[\"PILIBALA_API_KEY\"]",
            "[\"PILIBALA_RUNNER_BOOTSTRAP_TICKET\"]",
            "[\"OPENAI_API_KEY\"]",
            "[\"LD_PRELOAD\"]",
            "[\"bad=name\"]",
            "[\"CUSTOM\",\"CUSTOM\"]",
            "[\"MISSING\"]",
        ] {
            let mut command = Command::new("unused");
            assert!(
                apply_configured_environment(&mut command, |key| if key == MARKER {
                    Some(raw.into())
                } else {
                    None
                })
                .is_err()
            );
            assert_eq!(command.get_envs().count(), 0);
        }
        let mut command = Command::new("unused");
        assert!(
            apply_configured_environment(&mut command, |key| Some(if key == MARKER {
                "[\"CUSTOM\"]".into()
            } else {
                "x".repeat(65_536)
            }))
            .is_err()
        );
    }

    #[test]
    #[cfg(unix)]
    fn child_receives_only_selected_task_values_across_configuration_changes() {
        for secret in [None, Some("first-secret"), Some("rotated-secret"), None] {
            let mut source = BTreeMap::from([
                ("HOST_SECRET", "unbound-secret".to_string()),
                ("NODE_OPTIONS", "unbound-loader".to_string()),
            ]);
            let names = if let Some(value) = secret {
                source.insert("PILIBALA_PAGE_AWS_SECRET_ACCESS_KEY", value.into());
                vec!["PILIBALA_PAGE_AWS_SECRET_ACCESS_KEY"]
            } else {
                vec![]
            };
            source.insert(MARKER, serde_json::to_string(&names).unwrap());
            let mut command = Command::new("/bin/sh");
            command.env_clear().args(["-c", "printf '%s|%s|%s' \"$PILIBALA_PAGE_AWS_SECRET_ACCESS_KEY\" \"$HOST_SECRET\" \"$NODE_OPTIONS\""]);
            apply_configured_environment(&mut command, |key| source.get(key).cloned()).unwrap();
            let output = command.output().unwrap();
            assert!(output.status.success());
            assert_eq!(
                String::from_utf8(output.stdout).unwrap(),
                format!("{}||", secret.unwrap_or_default())
            );
        }
    }
}
