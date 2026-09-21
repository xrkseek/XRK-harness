/** Single-quote wrap for remote POSIX shell. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Join argv into a remote shell command string. */
export function shJoin(argv: readonly string[]): string {
  if (argv.length === 0) throw new Error("ssh remote argv must be non-empty");
  return argv.map(shQuote).join(" ");
}
