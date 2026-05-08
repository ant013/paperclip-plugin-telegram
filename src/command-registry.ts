import type { PluginContext } from "@paperclipai/plugin-sdk";
import { sendMessage, escapeMarkdownV2, sendChatAction } from "./telegram-api.js";
import { METRIC_NAMES } from "./constants.js";

// --- Types ---

type WorkflowStepBase = {
  id: string;
  name?: string;
};

type FetchIssueStep = WorkflowStepBase & {
  type: "fetch_issue";
  issueId: string; // supports {{arg1}} template
};

type InvokeAgentStep = WorkflowStepBase & {
  type: "invoke_agent";
  agentId: string;
  prompt: string; // supports {{prev.result}}, {{arg1}} etc.
};

type HttpRequestStep = WorkflowStepBase & {
  type: "http_request";
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
};

type SendMessageStep = WorkflowStepBase & {
  type: "send_message";
  text: string;
};

type CreateIssueStep = WorkflowStepBase & {
  type: "create_issue";
  title: string;
  description?: string;
  projectId?: string;
  assigneeAgentId?: string;
};

type WaitApprovalStep = WorkflowStepBase & {
  type: "wait_approval";
  prompt: string;
  timeoutMs?: number;
};

type SetStateStep = WorkflowStepBase & {
  type: "set_state";
  key: string;
  value: string;
};

type WorkflowStep =
  | FetchIssueStep
  | InvokeAgentStep
  | HttpRequestStep
  | SendMessageStep
  | CreateIssueStep
  | WaitApprovalStep
  | SetStateStep;

type CustomCommand = {
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdBy: string;
  createdAt: string;
};

type StepResult = {
  stepId: string;
  result: string;
  data?: unknown;
};

type StepResultSnapshot = Pick<StepResult, "stepId" | "result">;

type CommandResumeState = {
  status: "pending" | "approved" | "rejected";
  command: CustomCommand;
  args: string[];
  results: StepResultSnapshot[];
  nextStepIndex: number;
  chatId: string;
  messageThreadId?: number;
  companyId: string;
  createdAt: number;
  resolvedBy?: string;
  resolvedAt?: number;
};

const AWAITING_APPROVAL_RESULT = "awaiting_approval";

function isCommandResumeState(value: unknown): value is CommandResumeState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.status !== "pending" && record.status !== "approved" && record.status !== "rejected") return false;
  if (!Array.isArray(record.args) || !Array.isArray(record.results)) return false;
  if (typeof record.nextStepIndex !== "number" || typeof record.chatId !== "string" || typeof record.companyId !== "string") return false;
  if (!record.command || !Array.isArray((record.command as Record<string, unknown>).steps)) return false;
  return true;
}

export async function handleCustomCommandApprovalCallback(
  ctx: PluginContext,
  token: string,
  approvalId: string,
  action: "approve" | "reject",
  actor: string,
): Promise<"handled" | "already" | "missing" | "error"> {
  const stateKey = `cmd_approval_${approvalId}`;
  const rawState = await ctx.state.get({
    scopeKind: "instance",
    stateKey,
  });

  if (!rawState || typeof rawState !== "object") {
    return "missing";
  }

  if (!isCommandResumeState(rawState)) {
    return "error";
  }

  const state = rawState;
  if (state.status !== "pending") {
    return state.status === "approved" || state.status === "rejected" ? "already" : "error";
  }

  if (action === "reject") {
    await ctx.state.set(
      { scopeKind: "instance", stateKey },
      {
        ...state,
        status: "rejected",
        resolvedBy: actor,
        resolvedAt: Date.now(),
      },
    );
    return "handled";
  }

  const approvedState: CommandResumeState = {
    ...state,
    status: "approved",
    resolvedBy: actor,
    resolvedAt: Date.now(),
  };
  await ctx.state.set(
    { scopeKind: "instance", stateKey },
    approvedState,
  );

  try {
    await executeWorkflow(
      ctx,
      token,
      state.chatId,
      state.command,
      state.args,
      state.messageThreadId,
      state.companyId,
      state.results,
      state.nextStepIndex,
      false,
    );
    return "handled";
  } catch (err) {
    ctx.logger.error("Failed to resume custom command", {
      approvalId,
      command: state.command.name,
      error: String(err),
    });
    await ctx.state.set(
      { scopeKind: "instance", stateKey },
      {
        ...approvedState,
        status: "pending",
        resolvedBy: undefined,
        resolvedAt: undefined,
      },
    );
    return "error";
  }
}

// --- Built-in commands ---

const BUILTIN_COMMANDS = new Set([
  "status", "issues", "agents", "approve", "help",
  "connect", "connect_topic", "topics", "acp", "commands",
]);

// --- Command registry ---

export async function handleCommandsCommand(
  ctx: PluginContext,
  token: string,
  chatId: string,
  args: string,
  messageThreadId?: number,
  companyId?: string,
): Promise<void> {
  const parts = args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() ?? "";

  switch (subcommand) {
    case "list":
      await listCommands(ctx, token, chatId, messageThreadId, companyId);
      break;
    case "import":
      await importCommand(ctx, token, chatId, parts.slice(1).join(" "), messageThreadId, companyId);
      break;
    case "delete":
      await deleteCommand(ctx, token, chatId, parts[1] ?? "", messageThreadId, companyId);
      break;
    case "run":
      await runCommand(ctx, token, chatId, parts[1] ?? "", parts.slice(2), messageThreadId, companyId);
      break;
    default:
      await sendMessage(ctx, token, chatId, [
        escapeMarkdownV2("\ud83d\udee0\ufe0f") + " *Custom Commands*",
        "",
        `/commands list \\- ${escapeMarkdownV2("Show all custom commands")}`,
        `/commands import <json> \\- ${escapeMarkdownV2("Import a workflow command")}`,
        `/commands delete <name> \\- ${escapeMarkdownV2("Remove a custom command")}`,
        `/commands run <name> [args] \\- ${escapeMarkdownV2("Execute a custom command")}`,
      ].join("\n"), { parseMode: "MarkdownV2", messageThreadId });
  }
}

// Check if a command is custom and run it, returns true if handled
export async function tryCustomCommand(
  ctx: PluginContext,
  token: string,
  chatId: string,
  command: string,
  argsStr: string,
  messageThreadId?: number,
  companyId?: string,
): Promise<boolean> {
  if (BUILTIN_COMMANDS.has(command)) return false;

  const resolvedCompanyId = companyId ?? chatId;
  const commands = await getCommandRegistry(ctx, resolvedCompanyId);
  const cmd = commands.find((c) => c.name === command);

  if (!cmd) return false;

  const args = argsStr.trim().split(/\s+/).filter(Boolean);
  await executeWorkflow(ctx, token, chatId, cmd, args, messageThreadId, resolvedCompanyId);
  return true;
}

async function listCommands(
  ctx: PluginContext,
  token: string,
  chatId: string,
  messageThreadId?: number,
  companyId?: string,
): Promise<void> {
  const resolvedCompanyId = companyId ?? chatId;
  const commands = await getCommandRegistry(ctx, resolvedCompanyId);

  if (commands.length === 0) {
    await sendMessage(ctx, token, chatId, "No custom commands registered. Use /commands import to add one.", { messageThreadId });
    return;
  }

  const lines = [
    escapeMarkdownV2("\ud83d\udee0\ufe0f") + " *Custom Commands*",
    "",
  ];

  for (const cmd of commands) {
    lines.push(`/${escapeMarkdownV2(cmd.name)} \\- ${escapeMarkdownV2(cmd.description)}`);
    lines.push(`  Steps: ${escapeMarkdownV2(String(cmd.steps.length))} \\| Created: ${escapeMarkdownV2(cmd.createdAt.split("T")[0] ?? cmd.createdAt)}`);
  }

  await sendMessage(ctx, token, chatId, lines.join("\n"), {
    parseMode: "MarkdownV2",
    messageThreadId,
  });
}

async function importCommand(
  ctx: PluginContext,
  token: string,
  chatId: string,
  jsonStr: string,
  messageThreadId?: number,
  companyId?: string,
): Promise<void> {
  if (!jsonStr.trim()) {
    await sendMessage(ctx, token, chatId, "Usage: /commands import <json-definition>", { messageThreadId });
    return;
  }

  let definition: { name: string; description: string; steps: WorkflowStep[] };
  try {
    definition = JSON.parse(jsonStr);
  } catch {
    await sendMessage(ctx, token, chatId, "Invalid JSON. Please provide a valid command definition.", { messageThreadId });
    return;
  }

  if (!definition.name || !definition.steps || !Array.isArray(definition.steps)) {
    await sendMessage(ctx, token, chatId, "Command definition must have 'name' and 'steps' fields.", { messageThreadId });
    return;
  }

  if (BUILTIN_COMMANDS.has(definition.name)) {
    await sendMessage(ctx, token, chatId, `Cannot override built-in command: /${definition.name}`, { messageThreadId });
    return;
  }

  // Validate steps
  for (const step of definition.steps) {
    if (!step.type || !step.id) {
      await sendMessage(ctx, token, chatId, "Each step must have 'type' and 'id' fields.", { messageThreadId });
      return;
    }
    const validTypes = ["fetch_issue", "invoke_agent", "http_request", "send_message", "create_issue", "wait_approval", "set_state"];
    if (!validTypes.includes(step.type)) {
      await sendMessage(ctx, token, chatId, `Invalid step type: ${step.type}. Valid: ${validTypes.join(", ")}`, { messageThreadId });
      return;
    }
  }

  const resolvedCompanyId = companyId ?? chatId;
  const commands = await getCommandRegistry(ctx, resolvedCompanyId);

  // Replace existing or add new
  const existingIdx = commands.findIndex((c) => c.name === definition.name);
  const newCmd: CustomCommand = {
    name: definition.name,
    description: definition.description ?? "No description",
    steps: definition.steps,
    createdBy: `telegram:${chatId}`,
    createdAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    commands[existingIdx] = newCmd;
  } else {
    commands.push(newCmd);
  }

  await saveCommandRegistry(ctx, resolvedCompanyId, commands);

  await sendMessage(
    ctx,
    token,
    chatId,
    `${escapeMarkdownV2("\u2705")} Command /${escapeMarkdownV2(definition.name)} ${existingIdx >= 0 ? "updated" : "imported"} \\(${escapeMarkdownV2(String(definition.steps.length))} steps\\)`,
    { parseMode: "MarkdownV2", messageThreadId },
  );
}

async function deleteCommand(
  ctx: PluginContext,
  token: string,
  chatId: string,
  name: string,
  messageThreadId?: number,
  companyId?: string,
): Promise<void> {
  if (!name.trim()) {
    await sendMessage(ctx, token, chatId, "Usage: /commands delete <name>", { messageThreadId });
    return;
  }

  const resolvedCompanyId = companyId ?? chatId;
  const commands = await getCommandRegistry(ctx, resolvedCompanyId);
  const filtered = commands.filter((c) => c.name !== name);

  if (filtered.length === commands.length) {
    await sendMessage(ctx, token, chatId, `Command /${name} not found.`, { messageThreadId });
    return;
  }

  await saveCommandRegistry(ctx, resolvedCompanyId, filtered);

  await sendMessage(
    ctx,
    token,
    chatId,
    `${escapeMarkdownV2("\ud83d\uddd1\ufe0f")} Command /${escapeMarkdownV2(name)} deleted.`,
    { parseMode: "MarkdownV2", messageThreadId },
  );
}

async function runCommand(
  ctx: PluginContext,
  token: string,
  chatId: string,
  name: string,
  args: string[],
  messageThreadId?: number,
  companyId?: string,
): Promise<void> {
  const resolvedCompanyId = companyId ?? chatId;
  const commands = await getCommandRegistry(ctx, resolvedCompanyId);
  const cmd = commands.find((c) => c.name === name);

  if (!cmd) {
    await sendMessage(ctx, token, chatId, `Command /${name} not found.`, { messageThreadId });
    return;
  }

  await executeWorkflow(ctx, token, chatId, cmd, args, messageThreadId, resolvedCompanyId);
}

// --- Workflow executor ---

async function executeWorkflow(
  ctx: PluginContext,
  token: string,
  chatId: string,
  cmd: CustomCommand,
  args: string[],
  messageThreadId: number | undefined,
  companyId: string,
  seededResults: StepResultSnapshot[] = [],
  startAtStepIndex = 0,
  countCommandMetric = true,
): Promise<void> {
  await sendChatAction(ctx, token, chatId);
  if (countCommandMetric) {
    await ctx.metrics.write(METRIC_NAMES.commandsExecuted, 1);
  }

  const results: StepResult[] = [...seededResults];

  for (let stepIndex = startAtStepIndex; stepIndex < cmd.steps.length; stepIndex += 1) {
    const step = cmd.steps[stepIndex];
    if (!step) continue;
    try {
      const result = await executeStep(
        ctx,
        token,
        chatId,
        step,
        args,
        results,
        messageThreadId,
        companyId,
        cmd,
        stepIndex,
      );
      if (result === "awaiting_approval") {
        results.push({ stepId: step.id, result });
        return;
      }
      results.push({ stepId: step.id, result: result ?? "" });
    } catch (err) {
      ctx.logger.error("Workflow step failed", { command: cmd.name, stepId: step.id, error: String(err) });
      await sendMessage(
        ctx,
        token,
        chatId,
        `Step "${step.name ?? step.id}" failed: ${String(err)}`,
        { messageThreadId },
      );
      return; // Stop execution on failure
    }
  }

  ctx.logger.info("Workflow completed", { command: cmd.name, steps: results.length });
}

async function executeStep(
  ctx: PluginContext,
  token: string,
  chatId: string,
  step: WorkflowStep,
  args: string[],
  prevResults: StepResult[],
  messageThreadId: number | undefined,
  companyId: string,
  cmd: CustomCommand,
  stepIndex: number,
): Promise<string | null> {
  const interpolate = (template: string): string => {
    let result = template;
    // Replace {{arg0}}, {{arg1}}, etc.
    for (let i = 0; i < args.length; i++) {
      result = result.replace(new RegExp(`\\{\\{arg${i}\\}\\}`, "g"), args[i]!);
    }
    result = result.replace(/\{\{args\}\}/g, args.join(" "));
    // Replace {{prev.result}}, {{step_id.result}}
    if (prevResults.length > 0) {
      const lastResult = prevResults[prevResults.length - 1]!;
      result = result.replace(/\{\{prev\.result\}\}/g, lastResult.result);
    }
    for (const prev of prevResults) {
      result = result.replace(new RegExp(`\\{\\{${prev.stepId}\\.result\\}\\}`, "g"), prev.result);
    }
    return result;
  };

  switch (step.type) {
    case "fetch_issue": {
      const issueId = interpolate(step.issueId);
      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue) return JSON.stringify({ error: "Issue not found", issueId });
      return JSON.stringify({ id: issue.id, title: issue.title, status: issue.status });
    }

    case "invoke_agent": {
      const prompt = interpolate(step.prompt);
      const { runId } = await ctx.agents.invoke(step.agentId, companyId, {
        prompt,
        reason: `custom_command:${step.id}`,
      });
      return runId;
    }

    case "http_request": {
      const url = interpolate(step.url);
      const body = step.body ? interpolate(step.body) : undefined;
      const res = await ctx.http.fetch(url, {
        method: step.method,
        headers: step.headers ? Object.fromEntries(
          Object.entries(step.headers).map(([k, v]) => [k, interpolate(v)]),
        ) : undefined,
        body,
      });
      const data = await res.text();
      return data;
    }

    case "send_message": {
      const text = interpolate(step.text);
      await sendMessage(ctx, token, chatId, text, { messageThreadId });
      return "sent";
    }

    case "create_issue": {
      const title = interpolate(step.title);
      const description = step.description ? interpolate(step.description) : undefined;
      const issue = await ctx.issues.create({
        companyId,
        title,
        description,
        projectId: step.projectId,
        assigneeAgentId: step.assigneeAgentId,
      });
      if (step.assigneeAgentId) {
        await ctx.issues.update(issue.id, { status: "todo" }, companyId);
      }
      return issue.id;
    }

    case "wait_approval": {
      const prompt = interpolate(step.prompt);
      const approvalId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const stepResult = AWAITING_APPROVAL_RESULT;
      await sendMessage(ctx, token, chatId, prompt, {
        messageThreadId,
        inlineKeyboard: [
          [
            { text: "Approve", callback_data: `cmd_approve_${approvalId}` },
            { text: "Reject", callback_data: `cmd_reject_${approvalId}` },
          ],
        ],
      });
      // Store approval state - workflow will be continued by callback handler
      await ctx.state.set(
        { scopeKind: "instance", stateKey: `cmd_approval_${approvalId}` },
        {
          status: "pending",
          command: cmd,
          args,
          results: [
            ...prevResults.map((result) => ({ stepId: result.stepId, result: result.result })),
            { stepId: step.id, result: stepResult },
          ],
          nextStepIndex: stepIndex + 1,
          chatId,
          messageThreadId,
          companyId,
          createdAt: Date.now(),
        },
      );
      return stepResult;
    }

    case "set_state": {
      const key = interpolate(step.key);
      const value = interpolate(step.value);
      await ctx.state.set(
        { scopeKind: "company", scopeId: companyId, stateKey: key },
        value,
      );
      return value;
    }

    default:
      return null;
  }
}

// --- State helpers ---

async function getCommandRegistry(ctx: PluginContext, companyId: string): Promise<CustomCommand[]> {
  const commands = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: `commands_${companyId}`,
  }) as CustomCommand[] | null;
  return commands ?? [];
}

async function saveCommandRegistry(ctx: PluginContext, companyId: string, commands: CustomCommand[]): Promise<void> {
  await ctx.state.set(
    { scopeKind: "company", scopeId: companyId, stateKey: `commands_${companyId}` },
    commands,
  );
}
