import type { JsonValue, PrivacyPolicy, PropertyRule } from "./types.js";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SENSITIVE_KEY = /(?:pass(?:word)?|authorization|cookie|token|secret|session|email|e-?mail|phone|address|card|ssn)/i;
const LIKELY_IDENTIFIER_SEGMENT = /(?:^|[-_])(\d{5,}|[0-9a-f]{8}-[0-9a-f-]{27,}|[\w.+-]+@[\w.-]+)(?:$|[-_])/i;

export function sanitizePageKey(input: string | undefined, policy: PrivacyPolicy | undefined): string | null {
  if (!input || !policy) return null;
  const normalized = normalizePath(input);
  if (!normalized || normalized.length > 512) return null;

  if (policy.pageKeys?.includes(normalized)) return normalized;
  if (policy.routeTemplates?.some((template) => matchesTemplate(normalized, template))) {
    const template = policy.routeTemplates.find((item) => matchesTemplate(normalized, item));
    return template ?? null;
  }
  return null;
}

function normalizePath(input: string): string | null {
  try {
    const base = typeof location === "undefined" ? "https://zhiji.invalid" : location.origin;
    const parsed = new URL(input, base);
    if (typeof location !== "undefined" && parsed.origin !== location.origin) return null;
    const path = parsed.pathname;
    if (!path.startsWith("/") || path.split("/").some((part) => LIKELY_IDENTIFIER_SEGMENT.test(part))) return null;
    return path;
  } catch {
    return null;
  }
}

function matchesTemplate(path: string, template: string): boolean {
  if (!template.startsWith("/") || template.includes("?") || template.includes("#")) return false;
  const actual = path.split("/").filter(Boolean);
  const pattern = template.split("/").filter(Boolean);
  if (actual.length !== pattern.length) return false;
  return pattern.every((part, index) => {
    if (part.startsWith(":")) return /^[A-Za-z0-9_-]{1,128}$/.test(actual[index] ?? "");
    return part === actual[index];
  });
}

export function sanitizeProperties(
  value: unknown,
  schema: Readonly<Record<string, PropertyRule>> | undefined,
): Record<string, JsonValue> {
  if (!isPlainObject(value) || !schema) return {};
  const result: Record<string, JsonValue> = {};
  for (const [key, rule] of Object.entries(schema)) {
    if (DANGEROUS_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    const sanitized = sanitizeRule(value[key], rule);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

function sanitizeRule(value: unknown, rule: PropertyRule): JsonValue | undefined {
  if (rule.type === "string" && typeof value === "string") {
    const trimmed = value.slice(0, rule.maxLength ?? 512);
    if (rule.enum && !rule.enum.includes(trimmed)) return undefined;
    return trimmed;
  }
  if (rule.type === "number" && typeof value === "number" && Number.isFinite(value)) return value;
  if (rule.type === "boolean" && typeof value === "boolean") return value;
  if (rule.type === "string[]" && Array.isArray(value) && value.length <= 20 && value.every((item) => typeof item === "string")) {
    const result = value.map((item) => item.slice(0, rule.maxLength ?? 512));
    return rule.enum && result.some((item) => !rule.enum?.includes(item)) ? undefined : result;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
