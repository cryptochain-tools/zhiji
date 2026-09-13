export function isConsolePath(path: string): boolean {
  return path === '/console' || path.startsWith('/console/')
}

export function consolePath(path: string): string {
  return isConsolePath(path) ? path : `/console${path === '/' ? '' : path}`
}
