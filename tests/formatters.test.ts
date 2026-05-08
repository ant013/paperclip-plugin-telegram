import { describe, it, expect } from "vitest";
import {
  formatIssueCreated,
  formatIssueDone,
  formatIssueAssigned,
  formatApprovalCreated,
  formatAgentError,
  formatAgentRunStarted,
  formatAgentRunFinished,
} from "../src/formatters.js";
import type { PluginEvent } from "@paperclipai/plugin-sdk";

function mockEvent(overrides: Record<string, unknown> = {}): PluginEvent {
  return {
    eventType: "issue.created",
    entityId: "iss-123",
    entityType: "issue",
    companyId: "co-1",
    occurredAt: new Date().toISOString(),
    payload: { identifier: "PROJ-42", title: "Test issue", ...overrides },
  } as PluginEvent;
}

describe("formatIssueCreated", () => {
  it("includes identifier and title", () => {
    const msg = formatIssueCreated(mockEvent());
    expect(msg.text).toContain("PROJ\\-42");
    expect(msg.text).toContain("Test issue");
  });

  it("uses inline issue link text without a dedicated issue button", () => {
    const msg = formatIssueCreated(mockEvent(), {
      baseUrl: "https://paperclip.example",
      issuePrefix: "companies/abc",
    });
    expect(msg.options.inlineKeyboard).toBeUndefined();
    expect(msg.text).toContain("[PROJ\\-42](https://paperclip.example/companies/abc/issues/PROJ-42)");
  });

  it("falls back to entityId when no identifier", () => {
    const msg = formatIssueCreated(mockEvent({ identifier: undefined }));
    expect(msg.text).toContain("iss\\-123");
  });

  it("uses MarkdownV2 parse mode", () => {
    const msg = formatIssueCreated(mockEvent());
    expect(msg.options.parseMode).toBe("MarkdownV2");
  });

  it("includes metadata fields when available", () => {
    const msg = formatIssueCreated(mockEvent({
      status: "open",
      priority: "high",
      assigneeName: "Alice",
      projectName: "Backend",
    }));
    expect(msg.text).toContain("open");
    expect(msg.text).toContain("high");
    expect(msg.text).toContain("Alice");
    expect(msg.text).toContain("Backend");
  });

  it("includes description snippet", () => {
    const msg = formatIssueCreated(mockEvent({ description: "A long description about this issue" }));
    expect(msg.text).toContain("A long description");
  });

  it("truncates long descriptions at word boundary", () => {
    const words = Array(50).fill("word").join(" ");
    const msg = formatIssueCreated(mockEvent({ description: words }));
    expect(msg.text).toContain("\\.\\.\\.");
    expect(msg.text.length).toBeLessThan(words.length * 2);
  });

  it("limits issue description preview to two lines", () => {
    const longDescription = Array(100).fill("word").join(" ");
    const msg = formatIssueCreated(mockEvent({ description: longDescription }));
    const previewLines = msg.text.split("\n").filter((line) => line.includes("\\>"));
    expect(previewLines.length).toBeLessThanOrEqual(2);
  });

  it("omits metadata line when no metadata", () => {
    const msg = formatIssueCreated(mockEvent({
      status: undefined,
      priority: undefined,
      assigneeName: undefined,
      projectName: undefined,
    }));
    expect(msg.text).not.toContain("\\|");
  });
});

describe("formatIssueDone", () => {
  it("includes identifier and done text", () => {
    const msg = formatIssueDone(mockEvent());
    expect(msg.text).toContain("PROJ\\-42");
    expect(msg.text).toContain("done");
  });

  it("falls back to entityId", () => {
    const msg = formatIssueDone(mockEvent({ identifier: undefined }));
    expect(msg.text).toContain("iss\\-123");
  });

  it("includes comment when provided", () => {
    const msg = formatIssueDone(mockEvent({ comment: "Board prep package completed for Q3" }));
    expect(msg.text).toContain("Board prep package completed for Q3");
  });

  it("truncates long comments", () => {
    const longComment = Array(80).fill("word").join(" ");
    const msg = formatIssueDone(mockEvent({ comment: longComment }));
    expect(msg.text).toContain("\\.\\.\\.");
  });

  it("limits issue completion preview to two lines", () => {
    const longComment = Array(100).fill("word").join(" ");
    const msg = formatIssueDone(mockEvent({ comment: longComment }));
    const previewLines = msg.text.split("\n").filter((line) => line.includes("\\>"));
    expect(previewLines.length).toBeLessThanOrEqual(2);
  });

  it("omits comment section when no comment", () => {
    const msg = formatIssueDone(mockEvent());
    // Should only have the title and done line, no blockquote
    const lines = msg.text.split("\n").filter((l: string) => l.trim());
    expect(lines.length).toBe(2);
  });
});

describe("formatIssueAssigned", () => {
  it("shows the assigned user when assigning from nobody", () => {
    const msg = formatIssueAssigned(mockEvent({
      assigneeUserId: "user-me",
      assigneeName: "Nuno",
      _previous: { assigneeUserId: null, assigneeName: null },
    }));
    expect(msg.text).toContain("Issue Assigned");
    expect(msg.text).toContain("PROJ\\-42");
    expect(msg.text).toContain("Nuno");
    // No previous-name line
    expect(msg.text).not.toContain("→");
  });

  it("shows 'previous → new' when reassigning from another user", () => {
    const msg = formatIssueAssigned(mockEvent({
      assigneeUserId: "user-me",
      assigneeName: "Nuno",
      _previous: { assigneeUserId: "user-other", assigneeName: "Alice" },
    }));
    expect(msg.text).toContain("Alice");
    expect(msg.text).toContain("Nuno");
    expect(msg.text).toContain("→");
  });

  it("shows 'Unassigned' when the new assignee is null", () => {
    const msg = formatIssueAssigned(mockEvent({
      assigneeUserId: null,
      assigneeName: null,
      _previous: { assigneeUserId: "user-me", assigneeName: "Nuno" },
    }));
    expect(msg.text).toContain("Unassigned");
  });

  it("uses MarkdownV2 parse mode", () => {
    const msg = formatIssueAssigned(mockEvent({ assigneeName: "Nuno" }));
    expect(msg.options.parseMode).toBe("MarkdownV2");
  });

  it("falls back to entityId when no identifier", () => {
    const msg = formatIssueAssigned(mockEvent({ identifier: undefined, assigneeName: "Nuno" }));
    expect(msg.text).toContain("iss\\-123");
  });
});

describe("formatApprovalCreated", () => {
  it("includes approve and reject buttons", () => {
    const msg = formatApprovalCreated(mockEvent({
      type: "deploy",
      approvalId: "apr-1",
      title: "Deploy to prod",
    }));
    expect(msg.options.inlineKeyboard).toBeDefined();
    const buttons = msg.options.inlineKeyboard![0];
    expect(buttons.length).toBe(2);
    expect(buttons[0].text).toBe("Approve");
    expect(buttons[0].callback_data).toBe("approve_apr-1");
    expect(buttons[1].text).toBe("Reject");
    expect(buttons[1].callback_data).toBe("reject_apr-1");
  });

  it("falls back to entityId for approvalId", () => {
    const msg = formatApprovalCreated(mockEvent({ approvalId: undefined }));
    const buttons = msg.options.inlineKeyboard![0];
    expect(buttons[0].callback_data).toBe("approve_iss-123");
  });

  it("includes agent name when provided", () => {
    const msg = formatApprovalCreated(mockEvent({
      agentName: "Builder",
      type: "deploy",
    }));
    expect(msg.text).toContain("Builder");
  });

  it("uses displayName as agent label fallback", () => {
    const msg = formatApprovalCreated(mockEvent({
      displayName: "Release Captain",
      type: "deploy",
    }));
    expect(msg.text).toContain("Release Captain");
  });

  it("keeps only approval action buttons when linked issues exist", () => {
    const msg = formatApprovalCreated(mockEvent({
      linkedIssues: [{ identifier: "ISS-1", title: "First", status: "open" }],
    }), {
      baseUrl: "https://paperclip.example",
      issuePrefix: "companies/abc",
    });
    expect(msg.options.inlineKeyboard).toBeDefined();
    expect(msg.options.inlineKeyboard![0]).toHaveLength(2);
    expect(msg.options.inlineKeyboard![0][0].text).toBe("Approve");
    expect(msg.options.inlineKeyboard![0][1].text).toBe("Reject");
    expect(msg.text).toContain("[ISS\\-1](https://paperclip.example/companies/abc/issues/ISS-1)");
  });

  it("includes linked issues", () => {
    const msg = formatApprovalCreated(mockEvent({
      linkedIssues: [
        { identifier: "ISS-1", title: "First", status: "open" },
        { identifier: "ISS-2", title: "Second", status: "done" },
      ],
    }));
    expect(msg.text).toContain("ISS\\-1");
    expect(msg.text).toContain("ISS\\-2");
    expect(msg.text).toContain("Linked Issues");
  });

  it("truncates description at word boundary", () => {
    const longDesc = Array(80).fill("word").join(" ");
    const msg = formatApprovalCreated(mockEvent({ description: longDesc }));
    expect(msg.text).toContain("\\.\\.\\.");
  });
});

describe("formatAgentError", () => {
  it("includes agent name and error", () => {
    const msg = formatAgentError(mockEvent({
      agentName: "Builder",
      error: "Connection refused",
    }));
    expect(msg.text).toContain("Builder");
    expect(msg.text).toContain("Connection refused");
  });

  it("uses displayName before raw ids for errors", () => {
    const msg = formatAgentError(mockEvent({
      displayName: "Ops Watch",
      error: "Connection refused",
    }));
    expect(msg.text).toContain("Ops Watch");
  });

  it("prefers issue context over run link for issue-backed errors", () => {
    const msg = formatAgentError(mockEvent({
      agentName: "Builder",
      runId: "run-1",
      issueIdentifier: "ISS-1",
      issueTitle: "Issue one",
      companyName: "Acme",
      error: "Connection refused",
      agentId: "agent-1",
    }), {
      baseUrl: "https://paperclip.example",
      issuePrefix: "companies/abc",
    });
    expect(msg.options.inlineKeyboard).toBeUndefined();
    expect(msg.text).toContain("Builder");
    expect(msg.text).toContain("failed\n[ISS\\-1](https://paperclip.example/companies/abc/issues/ISS-1) Issue one");
    expect(msg.text).not.toContain("[Run run\\-1](https://paperclip.example/agents/agent-1/runs/run-1)");
  });

  it("keeps run link fallback for errors without issue context", () => {
    const msg = formatAgentError(mockEvent({
      runId: "run-1",
      error: "Connection refused",
      agentId: "agent-1",
    }), {
      baseUrl: "https://paperclip.example",
      issuePrefix: "companies/abc",
    });
    expect(msg.text).toContain("[Run run\\-1](https://paperclip.example/agents/agent-1/runs/run-1)");
  });

  it("renders issue link inline without action buttons", () => {
    const msg = formatAgentError(mockEvent({
      issueIdentifier: "ISS-1",
      issueTitle: "Issue one",
      error: "Connection refused",
    }), {
      baseUrl: "https://paperclip.example",
      issuePrefix: "companies/abc",
    });
    expect(msg.options.inlineKeyboard).toBeUndefined();
    expect(msg.text).toContain("[ISS\\-1](https://paperclip.example/companies/abc/issues/ISS-1)");
  });

  it("truncates long error messages", () => {
    const longError = "x".repeat(600);
    const msg = formatAgentError(mockEvent({ error: longError }));
    expect(msg.text).toContain("\\.\\.\\.");
    expect(msg.text).not.toContain("x".repeat(501));
  });

  it("falls back to entityId for agent name", () => {
    const msg = formatAgentError(mockEvent({ agentName: undefined, name: undefined }));
    expect(msg.text).toContain("iss\\-123");
  });
});

describe("formatAgentRunStarted", () => {
  it("includes agent name", () => {
    const msg = formatAgentRunStarted(mockEvent({ agentName: "Deployer" }));
    expect(msg.text).toContain("Deployer");
    expect(msg.text).toContain("started");
  });

  it("uses displayName as run-start label fallback", () => {
    const msg = formatAgentRunStarted(mockEvent({ displayName: "Ship Bot" }));
    expect(msg.text).toContain("Ship Bot");
  });

  it("falls back to run link when issue context is not available", () => {
    const msg = formatAgentRunStarted(mockEvent({ agentName: "Deployer", runId: "run-1", agentId: "agent-1" }), {
      baseUrl: "https://paperclip.example",
      issuePrefix: "companies/abc",
    });
    expect(msg.text).toContain("Deployer");
    expect(msg.text).toContain("started / [Run run\\-1](https://paperclip.example/agents/agent-1/runs/run-1)");
    expect(msg.text.split("\n")).toHaveLength(1);
  });

  it("keeps fallback single-line when no run link is available", () => {
    const msg = formatAgentRunStarted(mockEvent({ agentName: "Deployer" }));
    expect(msg.text).toContain("▶️ *Deployer* started");
    expect(msg.text.split("\n")).toHaveLength(1);
    expect(msg.text).not.toContain("Run:");
  });

  it("uses linked issue context as fallback and escapes/truncates title", () => {
    const msg = formatAgentRunStarted(mockEvent({
      agentName: "TGCTO",
      runId: "run-1",
      agentId: "agent-1",
      issueIdentifier: "TEL_17",
      issueTitle:
        "This markdown heavy title includes *asterisks*, _underscores_, [brackets], and an intentionally long tail that must be cut for preview safety.",
    }), {
      baseUrl: "https://paperclip.example",
      issuePrefix: "companies/abc",
    });
    expect(msg.text).toContain("TGCTO");
    expect(msg.text).toContain("started\n[TEL\\_17](https://paperclip.example/companies/abc/issues/TEL_17)");
    expect(msg.text).toContain("This markdown heavy title includes \\*asterisks\\*");
    expect(msg.text).toContain("\\.\\.\\.");
    expect(msg.text).not.toContain("[Run run\\-1](https://paperclip.example/agents/agent-1/runs/run-1)");
    expect(msg.text).not.toContain("intentionally long tail");
    expect(msg.text.split("\n")).toHaveLength(2);
  });

  it("disables notification", () => {
    const msg = formatAgentRunStarted(mockEvent());
    expect(msg.options.disableNotification).toBe(true);
  });
});

describe("formatAgentRunFinished", () => {
  it("includes agent name and completion text", () => {
    const msg = formatAgentRunFinished(mockEvent({ agentName: "Deployer" }));
    expect(msg.text).toContain("Deployer");
    expect(msg.text).toContain("completed");
  });

  it("uses displayName as run-finished label fallback", () => {
    const msg = formatAgentRunFinished(mockEvent({ displayName: "Ship Bot" }));
    expect(msg.text).toContain("Ship Bot");
  });

  it("falls back to run link when issue context is not available", () => {
    const msg = formatAgentRunFinished(mockEvent({ agentName: "Deployer", runId: "run-1", agentId: "agent-1" }), {
      baseUrl: "https://paperclip.example",
      issuePrefix: "companies/abc",
    });
    expect(msg.text).toContain("Deployer");
    expect(msg.text).toContain("completed / [Run run\\-1](https://paperclip.example/agents/agent-1/runs/run-1)");
    expect(msg.text.split("\n")).toHaveLength(1);
  });

  it("keeps fallback single-line when no run link is available", () => {
    const msg = formatAgentRunFinished(mockEvent({ agentName: "Deployer" }));
    expect(msg.text).toContain("⏹️ *Deployer* completed");
    expect(msg.text.split("\n")).toHaveLength(1);
    expect(msg.text).not.toContain("Run:");
  });

  it("uses linked issue context as fallback and escapes/truncates title", () => {
    const msg = formatAgentRunFinished(mockEvent({
      agentName: "TGCTO",
      runId: "run-1",
      agentId: "agent-1",
      issueIdentifier: "TEL_17",
      issueTitle:
        "This markdown heavy title includes *asterisks*, _underscores_, [brackets], and an intentionally long tail that must be cut for preview safety.",
    }), {
      baseUrl: "https://paperclip.example",
      issuePrefix: "companies/abc",
    });
    expect(msg.text).toContain("TGCTO");
    expect(msg.text).toContain("completed\n[TEL\\_17](https://paperclip.example/companies/abc/issues/TEL_17)");
    expect(msg.text).toContain("This markdown heavy title includes \\*asterisks\\*");
    expect(msg.text).toContain("\\.\\.\\.");
    expect(msg.text).not.toContain("[Run run\\-1](https://paperclip.example/agents/agent-1/runs/run-1)");
    expect(msg.text).not.toContain("intentionally long tail");
    expect(msg.text.split("\n")).toHaveLength(2);
  });

  it("disables notification", () => {
    const msg = formatAgentRunFinished(mockEvent());
    expect(msg.options.disableNotification).toBe(true);
  });
});
