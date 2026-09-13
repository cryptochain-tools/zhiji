const COOKIE_NAME = "zj_vid";
const STORAGE_KEY = "zj_vid";
const YEAR_SECONDS = 60 * 60 * 24 * 365;

let memoryVisitorId: string | undefined;

export function getVisitorId(): string {
  const fromCookie = readCookie(COOKIE_NAME);
  if (fromCookie) return fromCookie;

  const fromStorage = safeStorageGet(STORAGE_KEY);
  if (fromStorage) {
    writeCookie(fromStorage);
    return fromStorage;
  }

  const visitorId = memoryVisitorId ?? createUuid();
  memoryVisitorId = visitorId;
  if (writeCookie(visitorId)) return visitorId;
  safeStorageSet(STORAGE_KEY, visitorId);
  return visitorId;
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${encodeURIComponent(name)}=`;
  const part = document.cookie.split("; ").find((item) => item.startsWith(prefix));
  if (!part) return undefined;
  try { return decodeURIComponent(part.slice(prefix.length)); } catch { return undefined; }
}

function writeCookie(value: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${YEAR_SECONDS}${secure}`;
    return readCookie(COOKIE_NAME) === value;
  } catch { return false; }
}

function safeStorageGet(key: string): string | undefined {
  try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; }
}

function safeStorageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* memory fallback remains */ }
}

export function createUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}
