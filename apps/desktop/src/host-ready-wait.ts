/**
 * Testable Desktop Host Fetch gate: listen first, then poll ready/failed sticky.
 * Avoids the get→listen race that permanently hangs Face on `handshake:host`.
 */

export interface HostReadyWaitPorts {
  getReady: () => Promise<boolean>;
  /** Sticky failure message from main; `null` when none. */
  getFailed: () => Promise<string | null>;
  onReady: (listener: () => void) => () => void;
  onFailed: (listener: (message: string) => void) => () => void;
}

/**
 * Resolve when Host Fetch is ready; reject on sticky or pushed failure.
 * Callers must register listeners before any await that yields (this does).
 */
export function waitForHostReady(ports: HostReadyWaitPorts): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubReady = (): void => {};
    let unsubFailed = (): void => {};

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      unsubReady();
      unsubFailed();
      fn();
    };

    unsubReady = ports.onReady(() => {
      settle(() => {
        resolve();
      });
    });
    unsubFailed = ports.onFailed((message) => {
      settle(() => {
        reject(
          new Error(
            message.trim() !== "" ? message : "Desktop Host failed to start",
          ),
        );
      });
    });

    void (async () => {
      try {
        if (await ports.getReady()) {
          settle(() => {
            resolve();
          });
          return;
        }
        const failed = await ports.getFailed();
        if (failed !== null && failed.trim() !== "") {
          settle(() => {
            reject(new Error(failed));
          });
        }
      } catch (error) {
        settle(() => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }
    })();
  });
}
