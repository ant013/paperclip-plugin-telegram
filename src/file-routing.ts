export type TelegramFileRoute = {
  name?: unknown;
  enabled?: unknown;
  projectKey?: unknown;
  chatId?: unknown;
  topicId?: unknown;
};

export type NormalizedTelegramFileRoute = {
  name: string;
  projectKey: string;
  chatId: string;
  topicId?: number;
};

export type FileRouteValidationIssue = {
  index?: number;
  field: "fileRoutes" | "name" | "projectKey" | "chatId" | "topicId";
  message: string;
};

export type FileRouteValidationResult = {
  routes: NormalizedTelegramFileRoute[];
  issues: FileRouteValidationIssue[];
  duplicateProjectKeys: string[];
};

export type TelegramFileDestination =
  | {
    ok: true;
    chatId: string;
    topicId?: number;
    source: "explicit" | "file_route" | "legacy_fallback";
    routeName?: string;
    projectKey?: string;
    issueIdentifier?: string;
  }
  | {
    ok: false;
    code:
      | "missing_destination"
      | "missing_route_context"
      | "unknown_project_route"
      | "ambiguous_route"
      | "invalid_route_config"
      | "invalid_route_context"
      | "conflicting_route_context"
      | "conflicting_destination"
      | "unresolved_issue";
    message: string;
    invalidField?: RouteContextField;
    projectKey?: string;
    issueIdentifier?: string;
  };

export type RouteContextField = "projectKey" | "issueIdentifier" | "issueId";

export type TelegramFileDestinationRequest = {
  explicitChatId?: unknown;
  explicitThreadId?: unknown;
  issueId?: unknown;
  issueIdentifier?: unknown;
  projectKey?: unknown;
  lookupIssueIdentifier?: (issueId: string) => Promise<string | null>;
};

const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]*$/;
const ISSUE_IDENTIFIER_PATTERN = /^([A-Z][A-Z0-9]*)-\d+$/;
const CHAT_ID_PATTERN = /^-?\d+$/;
const TOPIC_ID_PATTERN = /^\d+$/;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const ROUTE_CONTEXT_LIMITS: Record<RouteContextField, number> = {
  projectKey: 32,
  issueIdentifier: 64,
  issueId: 128,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function routeEnabled(value: unknown): boolean {
  return value !== false;
}

export function normalizeProjectKey(value: unknown): string | null {
  const normalized = cleanString(value).toUpperCase();
  return PROJECT_KEY_PATTERN.test(normalized) ? normalized : null;
}

export function parseProjectKeyFromIssueIdentifier(value: unknown): string | null {
  const issueIdentifier = cleanString(value).toUpperCase();
  const match = ISSUE_IDENTIFIER_PATTERN.exec(issueIdentifier);
  return match?.[1] ?? null;
}

export function validateTelegramFileRoutes(value: unknown): FileRouteValidationResult {
  const routes: NormalizedTelegramFileRoute[] = [];
  const issues: FileRouteValidationIssue[] = [];

  if (value === undefined || value === null) {
    return { routes, issues, duplicateProjectKeys: [] };
  }

  if (!Array.isArray(value)) {
    return {
      routes,
      issues: [{ field: "fileRoutes", message: "fileRoutes must be an array." }],
      duplicateProjectKeys: [],
    };
  }

  for (const [index, route] of value.entries()) {
    if (!isRecord(route)) {
      issues.push({ index, field: "fileRoutes", message: "Enabled file routes must be objects." });
      continue;
    }

    if (!routeEnabled(route.enabled)) {
      continue;
    }

    const name = cleanString(route.name);
    const projectKey = cleanString(route.projectKey);
    const chatId = cleanString(route.chatId);
    const rawTopicId = cleanString(route.topicId);
    let valid = true;

    if (!name) {
      issues.push({ index, field: "name", message: "Enabled file routes need a name." });
      valid = false;
    }
    if (!PROJECT_KEY_PATTERN.test(projectKey)) {
      issues.push({ index, field: "projectKey", message: "Project key must use uppercase letters and numbers." });
      valid = false;
    }
    if (!CHAT_ID_PATTERN.test(chatId)) {
      issues.push({ index, field: "chatId", message: "Enabled file routes need a numeric Telegram chat ID." });
      valid = false;
    }
    if (rawTopicId && !TOPIC_ID_PATTERN.test(rawTopicId)) {
      issues.push({ index, field: "topicId", message: "Topic ID must be numeric when provided." });
      valid = false;
    }

    if (valid) {
      routes.push({
        name,
        projectKey,
        chatId,
        topicId: rawTopicId ? Number(rawTopicId) : undefined,
      });
    }
  }

  const duplicateNames = findDuplicates(routes.map((route) => route.name));
  for (const name of duplicateNames) {
    issues.push({ field: "name", message: `Enabled file route names must be unique: ${name}.` });
  }

  return {
    routes,
    issues,
    duplicateProjectKeys: findDuplicates(routes.map((route) => route.projectKey)),
  };
}

export function getTelegramFileRouteSaveErrors(value: unknown): string[] {
  const validation = validateTelegramFileRoutes(value);
  return [
    ...validation.issues.map((issue) => issue.message),
    ...validation.duplicateProjectKeys.map((projectKey) =>
      `Enabled file routes must not duplicate project key ${projectKey}.`
    ),
  ];
}

export async function resolveTelegramFileDestination(
  fileRoutes: unknown,
  request: TelegramFileDestinationRequest,
): Promise<TelegramFileDestination> {
  const routeContextInput = validateRouteContextInput(request);
  if (!routeContextInput.ok) return routeContextInput;

  const explicitChatId = cleanString(request.explicitChatId);
  const hasRouteInput = Boolean(
    routeContextInput.projectKey
    || routeContextInput.issueIdentifier
    || routeContextInput.issueId
  );

  if (!hasRouteInput) {
    if (explicitChatId) {
      return { ok: true, source: "explicit", chatId: explicitChatId };
    }
    return { ok: true, source: "legacy_fallback", chatId: "" };
  }

  if (
    hasExplicitDestinationIntent(request.explicitChatId)
    || hasExplicitDestinationIntent(request.explicitThreadId)
  ) {
    return {
      ok: false,
      code: "conflicting_destination",
      message: "Route-aware Telegram sends cannot also set chatId or threadId.",
    };
  }

  const routeContext = await resolveRouteContext(routeContextInput, request.lookupIssueIdentifier);
  if (!routeContext.ok) return routeContext;

  const validation = validateTelegramFileRoutes(fileRoutes);
  if (validation.issues.length > 0) {
    return {
      ok: false,
      code: "invalid_route_config",
      message: "Telegram file route configuration has invalid enabled routes.",
      projectKey: routeContext.projectKey,
      issueIdentifier: routeContext.issueIdentifier,
    };
  }

  const matches = validation.routes.filter((route) => route.projectKey === routeContext.projectKey);
  if (matches.length === 0) {
    return {
      ok: false,
      code: "unknown_project_route",
      message: `No enabled Telegram file route matches project key ${routeContext.projectKey}.`,
      projectKey: routeContext.projectKey,
      issueIdentifier: routeContext.issueIdentifier,
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      code: "ambiguous_route",
      message: `Multiple enabled Telegram file routes match project key ${routeContext.projectKey}.`,
      projectKey: routeContext.projectKey,
      issueIdentifier: routeContext.issueIdentifier,
    };
  }

  const route = matches[0]!;
  return {
    ok: true,
    source: "file_route",
    chatId: route.chatId,
    topicId: route.topicId,
    routeName: route.name,
    projectKey: route.projectKey,
    issueIdentifier: routeContext.issueIdentifier,
  };
}

type ValidatedRouteContextInput = {
  ok: true;
  projectKey?: string;
  issueIdentifier?: string;
  issueId?: string;
};

function validateRouteContextInput(
  request: TelegramFileDestinationRequest,
): ValidatedRouteContextInput | Extract<TelegramFileDestination, { ok: false }> {
  const projectKey = validateRouteContextField("projectKey", request.projectKey);
  if (!projectKey.ok) return projectKey;

  const issueIdentifier = validateRouteContextField("issueIdentifier", request.issueIdentifier);
  if (!issueIdentifier.ok) return issueIdentifier;

  const issueId = validateRouteContextField("issueId", request.issueId);
  if (!issueId.ok) return issueId;

  return {
    ok: true,
    projectKey: projectKey.value,
    issueIdentifier: issueIdentifier.value,
    issueId: issueId.value,
  };
}

function validateRouteContextField(
  field: RouteContextField,
  value: unknown,
): { ok: true; value?: string } | Extract<TelegramFileDestination, { ok: false }> {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "string") return invalidRouteContext(field);

  const trimmed = value.trim();
  if (!trimmed) return { ok: true };
  if ([...value].length > ROUTE_CONTEXT_LIMITS[field] || CONTROL_CHARACTER_PATTERN.test(value)) {
    return invalidRouteContext(field);
  }

  if (field === "projectKey") {
    const normalized = normalizeProjectKey(trimmed);
    return normalized ? { ok: true, value: normalized } : invalidRouteContext(field);
  }

  if (field === "issueIdentifier") {
    const normalized = trimmed.toUpperCase();
    return parseProjectKeyFromIssueIdentifier(normalized)
      ? { ok: true, value: normalized }
      : invalidRouteContext(field);
  }

  return { ok: true, value: trimmed };
}

function invalidRouteContext(
  invalidField: RouteContextField,
): Extract<TelegramFileDestination, { ok: false }> {
  return {
    ok: false,
    code: "invalid_route_context",
    message: `${invalidField} is not valid Telegram route context.`,
    invalidField,
  };
}

function hasExplicitDestinationIntent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.length > 0;
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return [...duplicates].sort();
}

async function resolveRouteContext(
  request: ValidatedRouteContextInput,
  lookupIssueIdentifier?: (issueId: string) => Promise<string | null>,
): Promise<
  | { ok: true; projectKey: string; issueIdentifier?: string }
  | Extract<TelegramFileDestination, { ok: false }>
> {
  let resolvedIssueIdentifier: string | undefined;
  if (request.issueId) {
    const lookupResult = await lookupIssueIdentifier?.(request.issueId);
    if (!lookupResult) {
      return {
        ok: false,
        code: "unresolved_issue",
        message: "Could not resolve the Paperclip issue for Telegram routing.",
      };
    }

    const resolvedIdentifier = validateRouteContextField("issueIdentifier", lookupResult);
    if (!resolvedIdentifier.ok || !resolvedIdentifier.value) {
      return invalidRouteContext("issueId");
    }
    resolvedIssueIdentifier = resolvedIdentifier.value;
  }

  const explicitProjectKey = request.projectKey;
  const explicitIssueIdentifier = request.issueIdentifier;
  const projectKeys = [
    explicitProjectKey,
    explicitIssueIdentifier ? parseProjectKeyFromIssueIdentifier(explicitIssueIdentifier) : undefined,
    resolvedIssueIdentifier ? parseProjectKeyFromIssueIdentifier(resolvedIssueIdentifier) : undefined,
  ].filter((projectKey): projectKey is string => Boolean(projectKey));

  if (new Set(projectKeys).size > 1) {
    return {
      ok: false,
      code: "conflicting_route_context",
      message: "Telegram route context fields resolve to different project keys.",
    };
  }

  if (
    explicitIssueIdentifier
    && resolvedIssueIdentifier
    && explicitIssueIdentifier !== resolvedIssueIdentifier
  ) {
    return {
      ok: false,
      code: "conflicting_route_context",
      message: "Telegram route context fields resolve to different issue identifiers.",
    };
  }

  const projectKey = projectKeys[0];
  if (!projectKey) {
    return {
      ok: false,
      code: "invalid_route_context",
      message: "Telegram route context does not contain a valid project key.",
    };
  }

  return {
    ok: true,
    projectKey,
    issueIdentifier: explicitIssueIdentifier ?? resolvedIssueIdentifier,
  };
}
