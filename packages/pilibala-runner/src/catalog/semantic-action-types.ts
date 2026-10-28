export type PilibalaSemanticActionId =
  | "search_api"
  | "call_api"
  | "set_task_title"
  | "set_task_monitor"
  | "get_task_context"
  | "get_task_history"
  | "list_documents"
  | "read_document"
  | "list_document_revisions"
  | "report_progress"
  | "answer_status_question"
  | "write_document"
  | "request_human_input"
  | "register_deliverable"
  | "finish_task"
  | "block_task"
  | "request_review"
  | "list_agents"
  | "hire_agent"
  | "get_agent"
  | "search_tasks"
  | "list_approvals"
  | "get_approval"
  | "get_approval_context"
  | "get_workspace_runtime"
  | "control_workspace_service"
  | "reassign_task"
  | "set_dependencies"
  | "create_skill"
  | "update_skill"
  | "get_workspace"
  | "list_workspaces"
  | "select_workspace"
  | "prepare_repository"
  | "create_project"
  | "list_project_repositories"
  | "list_projects"
  | "create_task"
  | "request_approval"
  | "decide_approval"
  | "comment_on_approval"
  | "schedule_wake";

export type PilibalaSemanticActionPlacement = "always" | "optional";
export type PilibalaSemanticActionMode =
  "standard" | "ask" | "planning" | "skill_test";
export type PilibalaSemanticActionEffect = "read" | "write" | "governance";

export type PilibalaJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PilibalaJsonValue[]
  | { readonly [key: string]: PilibalaJsonValue };

/** The JSON Schema subset used by the v1 semantic action catalog. */
export interface PilibalaJsonSchema {
  readonly type?: string | readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, PilibalaJsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | PilibalaJsonSchema;
  readonly items?: PilibalaJsonSchema;
  readonly enum?: readonly PilibalaJsonValue[];
  readonly const?: PilibalaJsonValue;
  readonly oneOf?: readonly PilibalaJsonSchema[];
  readonly anyOf?: readonly PilibalaJsonSchema[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly pattern?: string;
  readonly format?: string;
  readonly default?: PilibalaJsonValue;
}

/**
 * A transport-neutral declaration. Catalog membership never grants discovery
 * or invocation authority; a run-scoped authorization layer must do that.
 */
export interface PilibalaSemanticActionDescriptor {
  readonly schema: "pilibala.semantic-action.v1";
  readonly operationId: PilibalaSemanticActionId;
  readonly version: 1;
  readonly title: string;
  readonly description: string;
  readonly placement: PilibalaSemanticActionPlacement;
  readonly effect: PilibalaSemanticActionEffect;
  readonly requiredClaims: readonly string[];
  readonly allowedModes: readonly PilibalaSemanticActionMode[];
  readonly allowedRoles?: readonly string[];
  readonly inputSchema: PilibalaJsonSchema;
  readonly outputSchema: PilibalaJsonSchema;
}
