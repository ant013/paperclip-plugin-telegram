import type { PluginEvent } from "@paperclipai/plugin-sdk";
import { escapeMarkdownV2, truncateAtWord } from "./telegram-api.js";
import type { SendMessageOptions } from "./telegram-api.js";

type Payload = Record<string, unknown>;

type FormattedMessage = {
  text: string;
  options: SendMessageOptions;
};

function esc(s: string): string {
  return escapeMarkdownV2(s);
}

function bold(s: string): string {
  return `*${esc(s)}*`;
}

function code(s: string): string {
  return `\`${esc(s)}\``;
}

export type IssueLinksOpts = { baseUrl?: string; issuePrefix?: string };

function isExternalUrl(url?: string): boolean {
  return !!url && url.startsWith("https://");
}

function issueLink(identifier: string, opts?: IssueLinksOpts): string {
  if (opts?.baseUrl && opts?.issuePrefix) {
    const url = `${opts.baseUrl}/${opts.issuePrefix}/issues/${identifier}`;
    return `[${esc(identifier)}](${url})`;
  }
  return bold(identifier);
}

function runLinkLine(agentId: string, runId: string | null, publicUrl?: string): string | null {
  if (!runId) return null;
  if (!publicUrl || !isExternalUrl(publicUrl)) return `Run: ${code(runId)}`;
  return `[${esc("Run")} ${esc(runId)}](${publicUrl}/agents/${agentId}/runs/${runId})`;
}

function issueTaskContext(
  issueIdentifier: string | null,
  issueTitle: string | null,
  opts?: IssueLinksOpts,
): string | null {
  if (!issueIdentifier) return null;
  const title = issueTitle ? ` — ${esc(truncateAtWord(issueTitle, 50))}` : "";
  return `${issueLink(issueIdentifier, opts)}${title}`;
}

function issueTaskRunContext(
  issueIdentifier: string | null,
  issueTitle: string | null,
  opts?: IssueLinksOpts,
): string | null {
  if (!issueIdentifier) return null;
  const title = issueTitle ? ` — ${esc(truncateAtWord(issueTitle, 50))}` : "";
  return `${issueLink(issueIdentifier, opts)}${title}`;
}

function issuePreviewLines(text: string, maxLineLength = 120): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const budget = Math.max(1, maxLineLength);
  const preview = truncateAtWord(normalized, budget * 2);
  if (preview.length <= budget) return [preview];

  const splitAt = preview.lastIndexOf(" ", budget);
  const firstLine = splitAt > budget * 0.35
    ? preview.slice(0, splitAt)
    : preview.slice(0, budget);
  const secondLine = truncateAtWord(preview.slice(firstLine.length).trim(), budget);

  return secondLine ? [firstLine, secondLine] : [firstLine];
}

function classifyAgentError(errorMessage: string): string {
  if (/timed?\s*out|timeout/i.test(errorMessage)) return "Agent Timeout";
  if (/limit|rate.?limit|quota/i.test(errorMessage)) return "Agent Rate Limit";
  return "Agent Error";
}

export function formatIssueCreated(event: PluginEvent, opts?: IssueLinksOpts): FormattedMessage {
  const p = event.payload as Payload;
  const identifier = String(p.identifier ?? event.entityId);
  const title = String(p.title ?? "Untitled");
  const status = p.status ? String(p.status) : null;
  const priority = p.priority ? String(p.priority) : null;
  const assigneeName = p.assigneeName ? String(p.assigneeName) : null;
  const projectName = p.projectName ? String(p.projectName) : null;

  const lines: string[] = [
    `${esc("📋")} ${bold("Issue Created")}: ${issueLink(identifier, opts)}`,
    bold(title),
  ];

  const meta: string[] = [];
  if (status) meta.push(`Status: ${code(status)}`);
  if (priority) meta.push(`Priority: ${code(priority)}`);
  if (assigneeName) meta.push(`Assignee: ${esc(assigneeName)}`);
  if (projectName) meta.push(`Project: ${esc(projectName)}`);
  if (meta.length > 0) lines.push(meta.join(" \\| "));

  if (p.description) {
    const description = issuePreviewLines(String(p.description));
    lines.push(`\n${esc(">")} ${esc(description[0] ?? "")}`);
    for (const line of description.slice(1)) {
      lines.push(`${esc(">")} ${esc(line)}`);
    }
  }

  return {
    text: lines.join("\n"),
    options: {
      parseMode: "MarkdownV2",
    },
  };
}

export function formatIssueAssigned(event: PluginEvent, opts?: IssueLinksOpts): FormattedMessage {
  const p = event.payload as Payload;
  const prev = (p._previous as Payload | undefined) ?? {};
  const identifier = String(p.identifier ?? event.entityId);
  const title = String(p.title ?? "Untitled");
  const assigneeName = p.assigneeName ? String(p.assigneeName) : null;
  const prevAssigneeName = prev.assigneeName ? String(prev.assigneeName) : null;

  const lines: string[] = [
    `${esc("🎯")} ${bold("Issue Assigned")}: ${issueLink(identifier, opts)}`,
    bold(title),
  ];

  if (assigneeName) {
    lines.push(
      prevAssigneeName
        ? `Assignee: ${esc(prevAssigneeName)} ${esc("→")} ${esc(assigneeName)}`
        : `Assignee: ${esc(assigneeName)}`,
    );
  } else {
    lines.push(esc("Unassigned"));
  }

  return {
    text: lines.join("\n"),
    options: {
      parseMode: "MarkdownV2",
    },
  };
}

export function formatIssueDone(event: PluginEvent, opts?: IssueLinksOpts): FormattedMessage {
  const p = event.payload as Payload;
  const identifier = String(p.identifier ?? event.entityId);
  const title = String(p.title ?? "");
  const comment = p.comment ? String(p.comment) : null;

  const lines: string[] = [
    `${esc("✅")} ${bold("Issue Completed")}: ${issueLink(identifier, opts)}`,
    `${bold(title)} ${esc("is now done.")}`,
  ];

  if (comment) {
    const preview = issuePreviewLines(comment);
    lines.push(`\n${esc(">")} ${esc(preview[0] ?? "")}`);
    for (const line of preview.slice(1)) {
      lines.push(`${esc(">")} ${esc(line)}`);
    }
  }

  return {
    text: lines.join("\n"),
    options: {
      parseMode: "MarkdownV2",
    },
  };
}

export function formatApprovalCreated(event: PluginEvent, opts?: IssueLinksOpts): FormattedMessage {
  const p = event.payload as Payload;
  const approvalType = String(p.type ?? "unknown");
  const approvalId = String(p.approvalId ?? event.entityId);
  const title = String(p.title ?? "Approval Requested");
  const description = p.description ? String(p.description) : null;
  const agentName = p.agentName ? String(p.agentName) : p.displayName ? String(p.displayName) : p.name ? String(p.name) : null;

  const lines: string[] = [
    `${esc("🔔")} ${bold("Approval Requested")}`,
    bold(title),
  ];

  if (agentName) lines.push(`Agent: ${esc(agentName)} \\| Type: ${code(approvalType)}`);
  if (description) lines.push(`\n${esc(truncateAtWord(description, 300))}`);

  // Add linked issues if present
  const linkedIssues = Array.isArray(p.linkedIssues) ? p.linkedIssues as Array<Payload> : [];
  if (linkedIssues.length > 0) {
    lines.push(`\n${bold(`Linked Issues (${String(linkedIssues.length)})`)}`);
    for (const issue of linkedIssues.slice(0, 5)) {
      const issueId = String(issue.identifier ?? "?");
      const issueParts = [`${issueLink(issueId, opts)} ${esc(String(issue.title ?? ""))}`];
      const issueMeta: string[] = [];
      if (issue.status) issueMeta.push(String(issue.status));
      if (issue.priority) issueMeta.push(String(issue.priority));
      if (issue.assignee) issueMeta.push(`-> ${String(issue.assignee)}`);
      if (issueMeta.length > 0) issueParts.push(`\\(${esc(issueMeta.join(" | "))}\\)`);
      lines.push(issueParts.join(" "));
    }
  }

  const keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> = [
    [
      { text: "Approve", callback_data: `approve_${approvalId}` },
      { text: "Reject", callback_data: `reject_${approvalId}` },
    ],
  ];

  return {
    text: lines.join("\n"),
    options: {
      parseMode: "MarkdownV2",
      inlineKeyboard: keyboard,
    },
  };
}

export function formatAgentError(event: PluginEvent, opts?: IssueLinksOpts): FormattedMessage {
  const p = event.payload as Payload;
  const agentId = String(p.agentId ?? event.entityId);
  const agentName = String(p.agentName ?? p.displayName ?? p.name ?? agentId);
  const errorMessage = String(p.error ?? p.message ?? "Unknown error");
  const runId = p.runId ? String(p.runId) : null;
  const companyName = p.companyName ? String(p.companyName) : null;
  const issueIdentifier = p.issueIdentifier ? String(p.issueIdentifier) : null;
  const issueTitle = p.issueTitle ? String(p.issueTitle) : null;
  const issueContext = issueTaskContext(issueIdentifier, issueTitle, opts);

  const lines: string[] = [
    `${esc("❌")} ${bold(classifyAgentError(errorMessage))}`,
  ];
  if (issueContext) {
    lines.push(`${bold(agentName)} ${esc("failed")}`);
    lines.push(issueContext);
  } else {
    lines.push(`Agent: ${bold(agentName)}`);
    const runLink = runLinkLine(agentId, runId, opts?.baseUrl);
    if (runLink) {
      lines.push(runLink);
    }
  }
  if (companyName) lines.push(`Company: ${esc(companyName)}`);
  lines.push(`\n${code(truncateAtWord(errorMessage, 500))}`);

  return {
    text: lines.join("\n"),
    options: {
      parseMode: "MarkdownV2",
    },
  };
}

export function formatAgentRunStarted(event: PluginEvent, opts?: IssueLinksOpts): FormattedMessage {
  const p = event.payload as Payload;
  const agentId = String(p.agentId ?? event.entityId);
  const agentName = String(p.agentName ?? p.displayName ?? p.name ?? agentId);
  const runId = p.runId ? String(p.runId) : null;
  const issueIdentifier = p.issueIdentifier ? String(p.issueIdentifier) : null;
  const issueTitle = p.issueTitle ? String(p.issueTitle) : null;
  const issueContext = issueTaskRunContext(issueIdentifier, issueTitle, opts);

  const lines: string[] = [
    `${esc("▶️")} ${bold(agentName)} ${esc("started")}`,
  ];
  if (issueContext) {
    lines.push(issueContext);
  } else {
    const fallbackContext = runLinkLine(agentId, runId, opts?.baseUrl);
    if (fallbackContext) lines[0] += ` / ${fallbackContext}`;
  }

  return {
    text: lines.join("\n"),
    options: {
      parseMode: "MarkdownV2",
      disableNotification: true,
    },
  };
}

export function formatAgentRunFinished(event: PluginEvent, opts?: IssueLinksOpts): FormattedMessage {
  const p = event.payload as Payload;
  const agentId = String(p.agentId ?? event.entityId);
  const agentName = String(p.agentName ?? p.displayName ?? p.name ?? agentId);
  const runId = p.runId ? String(p.runId) : null;
  const issueIdentifier = p.issueIdentifier ? String(p.issueIdentifier) : null;
  const issueTitle = p.issueTitle ? String(p.issueTitle) : null;
  const issueContext = issueTaskRunContext(issueIdentifier, issueTitle, opts);

  const lines: string[] = [
    `${esc("⏹️")} ${bold(agentName)} ${esc("completed")}`,
  ];
  if (issueContext) {
    lines.push(issueContext);
  } else {
    const fallbackContext = runLinkLine(agentId, runId, opts?.baseUrl);
    if (fallbackContext) lines[0] += ` / ${fallbackContext}`;
  }

  return {
    text: lines.join("\n"),
    options: {
      parseMode: "MarkdownV2",
      disableNotification: true,
    },
  };
}
