import { z } from "zod";

export const EngineSchema = z.enum(["cmd", "powershell", "python", "linux", "git"]);
export const RiskSchema = z.enum(["low", "medium", "high"]);
export const RunPolicySchema = z.enum(["inherit", "auto", "ask"]);

const CommandInputItemSchema = z.object({
  name: z.string().min(1).describe("Short display name for the command"),
  alias: z.string().optional().describe("Short quick-launcher alias, e.g. disk"),
  command: z
    .string()
    .min(1)
    .describe("Shell command string (supports {var} or {{var:default}} placeholders)"),
  engine: EngineSchema.default("powershell"),
  riskLevel: RiskSchema.default("low"),
  runPolicy: RunPolicySchema.default("inherit"),
  aiAllowed: z.boolean().default(false),
  description: z.string().optional(),
});

export const TOOL_SCHEMAS = {
  list_projects: z.object({}),
  create_project: z.object({
    name: z.string().min(1).describe("Human-readable project name, e.g. Explorer"),
    basePath: z
      .string()
      .min(1)
      .describe("Local Windows directory path, e.g. C:\\Users\\Dev\\Explorer"),
    defaultEngine: EngineSchema.default("powershell").describe(
      "Default shell engine: cmd, powershell, python, linux, or git"
    ),
  }),
  scaffold_project_with_commands: z.object({
    name: z.string().min(1).describe("Human-readable project name"),
    basePath: z
      .string()
      .min(1)
      .describe("Local Windows directory path, e.g. C:\\Users\\Dev\\MyApp"),
    defaultEngine: EngineSchema.default("powershell"),
    commands: z
      .array(CommandInputItemSchema)
      .min(1)
      .describe("Initial starter commands to save atomically with the new project"),
  }),
  update_project: z.object({
    projectId: z.string().min(1).describe("ID of the project to update"),
    name: z.string().min(1).optional(),
    basePath: z.string().min(1).optional(),
    defaultEngine: EngineSchema.optional(),
  }),
  delete_project: z.object({
    projectId: z.string().min(1).describe("ID of the project to delete"),
  }),
  validate_local_path: z.object({
    path: z.string().min(1).describe("Windows directory path to validate"),
  }),
  inspect_workspace_files: z.object({
    projectId: z
      .string()
      .optional()
      .describe("Existing project ID whose directory should be inspected"),
    basePath: z
      .string()
      .optional()
      .describe("Optional Windows directory path (if projectId is omitted)"),
    manifestFile: z
      .string()
      .optional()
      .describe(
        "Optional top-level safe manifest to read (package.json, Cargo.toml, pyproject.toml, requirements.txt, Makefile, docker-compose.yml, README.md)"
      ),
  }),
  list_commands: z.object({
    projectId: z
      .string()
      .optional()
      .describe("Optional project ID, or 'global' for Global Root commands"),
    engine: EngineSchema.optional(),
  }),
  create_command: z.object({
    name: z.string().min(1).describe("Short display name for the command"),
    alias: z.string().optional().describe("Short quick-launcher alias, e.g. git-status"),
    command: z
      .string()
      .min(1)
      .describe("Shell command string (supports {var} or {{var:default}} runtime placeholders)"),
    engine: EngineSchema.default("powershell"),
    projectId: z
      .string()
      .nullable()
      .optional()
      .describe("Target project ID, or null/omitted for Global Root"),
    riskLevel: RiskSchema.default("low"),
    runPolicy: RunPolicySchema.default("inherit"),
    aiAllowed: z.boolean().default(false),
    description: z.string().optional(),
  }),
  create_commands_batch: z.object({
    projectId: z
      .string()
      .nullable()
      .optional()
      .describe("Target project ID, or null/omitted for Global Root"),
    commands: z
      .array(CommandInputItemSchema)
      .min(1)
      .describe("List of 1 or more commands to save atomically in one batch write"),
  }),
  update_command: z.object({
    commandId: z.string().min(1),
    name: z.string().optional(),
    alias: z.string().optional(),
    command: z.string().optional(),
    engine: EngineSchema.optional(),
    riskLevel: RiskSchema.optional(),
    runPolicy: RunPolicySchema.optional(),
    aiAllowed: z.boolean().optional(),
    description: z.string().optional(),
  }),
  delete_command: z.object({
    commandId: z.string().min(1),
  }),
  run_stored_command: z.object({
    commandId: z.string().min(1),
    basePath: z.string().optional(),
    variables: z
      .record(z.string(), z.string())
      .optional()
      .describe("Optional key-value map for dynamic {var} / {{var}} placeholders"),
  }),
  run_adhoc_command: z.object({
    command: z.string().min(1),
    engine: EngineSchema.default("powershell"),
    basePath: z.string().optional(),
    riskLevel: RiskSchema.default("low"),
  }),
  run_command_sequence: z.object({
    steps: z
      .array(
        z.object({
          commandId: z
            .string()
            .optional()
            .describe("ID of a stored command to run in this step"),
          commandText: z
            .string()
            .optional()
            .describe("Ad-hoc command text to run if commandId is not provided"),
          engine: EngineSchema.optional().describe("Shell engine for ad-hoc steps"),
          label: z.string().optional().describe("Short human label for this step"),
          riskLevel: RiskSchema.optional(),
          variables: z.record(z.string(), z.string()).optional(),
        })
      )
      .min(1)
      .describe("Ordered steps to execute sequentially in the Embedded Console"),
    basePath: z
      .string()
      .optional()
      .describe("Optional working directory shared across steps"),
    stopOnError: z
      .boolean()
      .default(true)
      .describe("Stop remaining steps if any step exits with a non-zero code (default true)"),
  }),
  stop_execution: z.object({
    executionId: z.string().min(1),
  }),
  get_execution_logs: z.object({
    executionId: z.string().optional(),
  }),
  search_execution_history: z.object({
    projectId: z
      .string()
      .optional()
      .describe("Optional project ID, or 'global' for Global Root runs"),
    status: z.enum(["completed", "failed", "killed", "blocked"]).optional(),
    engine: EngineSchema.optional(),
    query: z
      .string()
      .optional()
      .describe("Optional keyword filter matched against commandText or basePath"),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  analyze_execution_error: z.object({
    executionId: z.string().min(1),
  }),
  export_project_template: z.object({
    projectId: z.string().min(1).describe("ID of the project to export as a shareable JSON template"),
  }),
  list_available_engines: z.object({}),
  ask_user_options: z.object({
    question: z.string().min(1).describe("Concise question to ask the user"),
    selectionType: z
      .enum(["single", "multiple"])
      .default("single")
      .describe("Whether the user selects one option or multiple options"),
    displayAs: z
      .enum(["buttons", "select"])
      .default("buttons")
      .describe("Use 'buttons' for 2-4 short choices, or 'select' for 5+ choices"),
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          description: z.string().optional(),
        })
      )
      .min(1)
      .describe("List of selectable choices"),
    allowCustomInput: z
      .boolean()
      .optional()
      .describe("Allow user to enter a custom text answer in addition to preset options"),
  }),
} as const;

export type OmniToolName = keyof typeof TOOL_SCHEMAS;

export const TOOL_DESCRIPTIONS: Record<OmniToolName, string> = {
  list_projects: "List all OmniCommand projects and their local Windows basePath and default engine.",
  create_project: "Validate a local Windows path and create a new persistent OmniCommand project without commands.",
  scaffold_project_with_commands:
    "Atomically create a new project AND its initial starter commands in one step and one combined Approval Card. Prefer this over separate create_project + create_commands_batch calls.",
  update_project: "Update an existing project's name, basePath, or defaultEngine.",
  delete_project: "Delete a project by ID (always requires explicit user confirmation).",
  validate_local_path:
    "Check whether a Windows directory is safe (outside protected OS folders) and canonicalize it.",
  inspect_workspace_files:
    "Read-only sandboxed workspace inspection: lists top-level files/folders and optionally reads one safe manifest (package.json, Cargo.toml, pyproject.toml, requirements.txt, Makefile, docker-compose.yml, README.md; max 8 KB; secret files strictly blocked).",
  list_commands: "List stored commands filtered optionally by projectId ('global' for Global Root) or engine.",
  create_command: "Save a single new reusable command inside a project (via projectId) or Global Root.",
  create_commands_batch:
    "Atomically save 2 or more reusable commands into an existing project (or Global Root) in one write and one Batch Approval Card.",
  update_command: "Edit a stored command's script, engine, riskLevel, runPolicy, or metadata.",
  delete_command: "Delete a stored command by ID (always requires explicit user confirmation).",
  run_stored_command:
    "Run a saved command by ID; accepts optional dynamic {var}/{{var}} values and prompts the user if required variables or a Global Root directory are missing.",
  run_adhoc_command: "Execute an unstored ad-hoc shell command in a given engine and directory.",
  run_command_sequence:
    "Execute an ordered multi-step workflow (e.g., build -> test -> deploy) sequentially in the Embedded Console with one Batch Approval Card and stopOnError support.",
  stop_execution: "Kill a running execution's entire process tree by executionId.",
  get_execution_logs: "Read exit code, status, and output tail of an execution log.",
  search_execution_history:
    "Search recent command executions filtered by projectId, status, engine, or keyword without dumping the full history.",
  analyze_execution_error:
    "Diagnose a failed execution (exitCode !== 0) with untrusted-output isolation.",
  export_project_template:
    "Export a project and its commands as a clean, shareable JSON template (stripping machine-specific local paths and secrets) with Copy & Download UI.",
  list_available_engines:
    "Report available shell engines (CMD, PowerShell, Python, Linux/WSL, Git) on this machine.",
  ask_user_options:
    "Present an interactive choice card (clickable buttons or dropdown select) in chat when you need the user to choose between options.",
};
