/**
 * Optional Host lifecycle log sink (wired by CLI; Host stays quiet by default).
 * Mirrors DSH: the HTTP package does not print; the shell owns the URL line.
 */

export interface HostLogger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
}

export type HostSpawnOptions = {
  readonly logger?: HostLogger;
};
