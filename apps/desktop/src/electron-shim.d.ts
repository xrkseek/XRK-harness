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
    /** Retain the page's visibility state (and its animation clock) while backgrounded. */
    backgroundThrottling?: boolean;
  }

  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    show?: boolean;
    title?: string;
    icon?: string;
    frame?: boolean;
    resizable?: boolean;
    thickFrame?: boolean;
    titleBarStyle?: "default" | "hidden" | "hiddenInset";
    trafficLightPosition?: { readonly x: number; readonly y: number };
    webPreferences?: WebPreferences;
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions);
    static getAllWindows(): BrowserWindow[];
    static getFocusedWindow(): BrowserWindow | null;
    static fromWebContents(webContents: unknown): BrowserWindow | null;
    isDestroyed(): boolean;
    isMinimized(): boolean;
    isMaximized(): boolean;
    minimize(): void;
    maximize(): void;
    unmaximize(): void;
    restore(): void;
    show(): void;
    focus(): void;
    close(): void;
    setTitle(title: string): void;
    once(event: "ready-to-show", listener: () => void): this;
    on(
      event: "closed" | "maximize" | "unmaximize",
      listener: () => void,
    ): this;
    loadURL(url: string): Promise<void>;
    readonly webContents: {
      setWindowOpenHandler(handler: () => { action: "deny" | "allow" }): void;
      on(
        event: "will-navigate",
        listener: (event: { preventDefault(): void }, url: string) => void,
      ): void;
      send(channel: string, ...args: unknown[]): void;
      reload(): void;
    };
  }

  export interface App {
    requestSingleInstanceLock(): boolean;
    quit(): void;
    exit(code?: number): void;
    whenReady(): Promise<void>;
    getLocale(): string;
    getVersion(): string;
    getAppPath(): string;
    readonly isPackaged: boolean;
    on(event: "second-instance", listener: () => void): this;
    on(event: "activate", listener: () => void): this;
    on(event: "window-all-closed", listener: () => void): this;
    on(event: "will-quit", listener: () => void): this;
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

  /** Renderer-safe path for a File from drag/drop or `<input type="file">`. */
  export const webUtils: {
    getPathForFile(file: File): string;
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
        event: { readonly sender: unknown },
        ...args: unknown[]
      ) => unknown | Promise<unknown>,
    ): void;
  };

  export const dialog: {
    showErrorBox(title: string, content: string): void;
    showMessageBox(
      window: unknown | undefined,
      options: {
        type?: string;
        title?: string;
        message: string;
        detail?: string;
        buttons: string[];
        defaultId?: number;
        cancelId?: number;
      },
    ): Promise<{ response: number }>;
  };

  export const Menu: {
    setApplicationMenu(menu: unknown): void;
    buildFromTemplate(template: unknown[]): unknown;
  };

  export const app: App;
}

declare namespace NodeJS {
  interface Process {
    readonly resourcesPath: string;
  }
}
