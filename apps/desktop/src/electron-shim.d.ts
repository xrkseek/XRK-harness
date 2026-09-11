/**
 * Minimal `electron` surface for compile-time wiring of `main.ts` / preload.
 * Runtime still requires a real Electron install (product shell not ready).
 */
declare module "electron" {
  export interface WebPreferences {
    preload?: string;
    nodeIntegration?: boolean;
    contextIsolation?: boolean;
    sandbox?: boolean;
    webSecurity?: boolean;
  }

  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    show?: boolean;
    webPreferences?: WebPreferences;
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions);
    static getAllWindows(): BrowserWindow[];
    isDestroyed(): boolean;
    isMinimized(): boolean;
    restore(): void;
    show(): void;
    focus(): void;
    once(event: "ready-to-show", listener: () => void): this;
    on(event: "closed", listener: () => void): this;
    loadURL(url: string): Promise<void>;
    readonly webContents: {
      setWindowOpenHandler(handler: () => { action: "deny" | "allow" }): void;
      on(
        event: "will-navigate",
        listener: (event: { preventDefault(): void }, url: string) => void,
      ): void;
      send(channel: string, ...args: unknown[]): void;
    };
  }

  export interface App {
    requestSingleInstanceLock(): boolean;
    quit(): void;
    exit(code?: number): void;
    whenReady(): Promise<void>;
    getLocale(): string;
    on(event: "second-instance", listener: () => void): this;
    on(event: "activate", listener: () => void): this;
    on(event: "window-all-closed", listener: () => void): this;
  }

  export interface ProtocolPrivileges {
    standard?: boolean;
    secure?: boolean;
    supportFetchAPI?: boolean;
    corsEnabled?: boolean;
    stream?: boolean;
    codeCache?: boolean;
  }

  export const protocol: {
    registerSchemesAsPrivileged(
      schemes: ReadonlyArray<{
        scheme: string;
        privileges: ProtocolPrivileges;
      }>,
    ): void;
    handle(
      scheme: string,
      handler: (request: Request) => Response | Promise<Response>,
    ): void;
  };

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: unknown): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ): void;
    off(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ): void;
  };

  export const ipcMain: {
    handle(
      channel: string,
      listener: (
        event: unknown,
        ...args: unknown[]
      ) => unknown | Promise<unknown>,
    ): void;
  };

  export const app: App;
}
