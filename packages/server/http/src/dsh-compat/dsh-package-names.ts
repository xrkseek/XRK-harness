export function shortPackageName(packageName: string): string {
  const trimmed = packageName.trim();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}
