/** Ambient module for optional electron-updater (packaged Desktop only). */
declare module "electron-updater" {
  export const autoUpdater: {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    channel: string;
    allowPrerelease: boolean;
    allowDowngrade: boolean;
    checkForUpdates(): Promise<{
      updateInfo?: { version?: string };
      isUpdateAvailable?: boolean;
    } | null>;
    downloadUpdate(): Promise<unknown>;
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  };
}
