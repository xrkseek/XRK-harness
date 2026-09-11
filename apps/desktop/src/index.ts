/**
 * Public package surface for `@xrkseek/harness-desktop` (no Electron runtime import).
 * Electron process entry is `./main.js` (see package.json `main`).
 */

export {
  claimDesktopSingleInstance,
  type DesktopSingleInstanceApplication,
} from "./single-instance.js";
export {
  acquireDesktopPackageLock,
  canReclaimDesktopPackageLock,
  isDesktopProcessAlive,
  readDesktopPackageLockOwner,
  writeDesktopPackageLockOwner,
  type DesktopPackageLockHold,
} from "./package-lock.js";
export {
  attachDesktopWindowLifecycle,
  bindDesktopMainWindowClosed,
  DESKTOP_WEB_PREFERENCES,
  DESKTOP_WINDOW_DEFAULTS,
  focusOrRecreatePrimaryWindow,
  showDesktopWindowWhenReady,
  type DesktopLifecycleApplication,
  type DesktopShellWindow,
} from "./window-lifecycle.js";
export {
  DESKTOP_PACKAGE_NAME,
  DESKTOP_PROFILE_NAME,
  DESKTOP_PROTOCOL_SCHEME,
  isDesktopProductReady,
  startDesktopMain,
} from "./desktop-bootstrap.js";
export {
  DESKTOP_BUILDER_DRAFT,
  DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES,
  DESKTOP_WINDOWS_SIGNING_ENV_PREFIX,
  assertDesktopPackageHostCompatible,
  desktopElectronBuilderDraftArguments,
  isDesktopFirstWavePackageTarget,
  listDesktopPackageTargets,
  resolveDesktopPackageTarget,
  withoutDesktopUploadCredentials,
  withoutDesktopWindowsSigningEnvironment,
  type DesktopDeferredPackageTargetName,
  type DesktopPackageTarget,
  type DesktopPackageTargetName,
} from "./package-targets.js";
export {
  desktopTargetBuildPaths,
  resolveDesktopAppRoot,
  resolveDesktopBuildTarget,
  resolveDesktopTargetBuildPaths,
  type DesktopTargetBuildPaths,
} from "./build-paths.js";
export {
  DESKTOP_BUNDLED_NODE_VERSION,
  DESKTOP_BUNDLED_PNPM_VERSION,
  desktopNodeArchiveName,
  desktopNodeArchiveStem,
  parseNodeSha256Line,
  prepareDesktopRuntime,
  type DesktopRuntimeVersions,
  type PrepareDesktopRuntimeOptions,
} from "./prepare-runtime.js";
export {
  DESKTOP_CLI_PACKAGE,
  DESKTOP_HOST_PACKAGE,
  DESKTOP_HOST_RUNTIME_FILES,
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  assertDesktopHostPackageFiles,
  desktopCorePackageOverrides,
  desktopCorePackageSpec,
  desktopSha512Integrity,
  parseDesktopCorePackageSet,
  readDesktopCorePackageSet,
  verifyDesktopCorePackageSet,
  type DesktopCorePackageRecord,
  type DesktopCorePackageSet,
} from "./core-package-set.js";
export {
  DESKTOP_SEED_INTEGRITY_FILE,
  buildDesktopSeedIntegrity,
  parseDesktopSeedIntegrity,
  verifyDesktopSeedIntegrity,
  writeDesktopSeedIntegrity,
  type DesktopSeedIntegrity,
  type DesktopSeedIntegrityRecord,
} from "./seed-integrity.js";
export {
  collectDesktopFirstPartyPackageDirs,
  indexDesktopWorkspacePackages,
  packDesktopFirstPartyPackages,
  prepareDesktopPackageSet,
  prepareDesktopSeedPackageArtifacts,
  selectDesktopPackageClosure,
  type PackedDesktopPackage,
  type PrepareDesktopPackageSetOptions,
  type PrepareDesktopSeedPackageArtifactsOptions,
} from "./prepare-package-set.js";
export {
  DESKTOP_BUILD_DIR_NAME,
  resolveDesktopDevelopmentLayout,
  resolveDesktopHarnessHome,
  resolveDesktopPaths,
  type DesktopDevelopmentLayout,
  type DesktopPaths,
} from "./paths.js";
export {
  DesktopProfileTransactionManager,
  defaultDesktopProfileHealthCheck,
  type DesktopPendingProfileTransaction,
  type DesktopProfileActivationStep,
  type DesktopProfileHooks,
} from "./profile-transaction.js";
export {
  DESKTOP_UPDATE_MVP_MODE,
  DESKTOP_UPDATE_PHASE2_DEFERRED,
  DESKTOP_UPDATE_UNIT_PARTS,
  assertDesktopUpdateUnit,
  createDesktopRelease,
  isDesktopUpdatePhase2Deferred,
  parseDesktopRelease,
  resolveDesktopUpdateMvpMode,
  type DesktopRelease,
  type DesktopUpdateMvpMode,
  type DesktopUpdatePhase2Deferred,
  type DesktopUpdateUnitPart,
} from "./release.js";
export {
  DesktopUpdateCoordinator,
  type DesktopAppUpdater,
  type DesktopUpdateCoordinatorOptions,
} from "./update-coordinator.js";
export {
  DESKTOP_SEED_DEFERRED,
  DESKTOP_SEED_LAYOUT,
  DESKTOP_SEED_STORE_STRATEGY,
  isDesktopOfflineSeedReady,
  isDesktopSeedCapabilityDeferred,
  resolveDesktopInstallMode,
  resolveDesktopSeedResourceRoot,
  resolveDesktopUserPnpmStore,
  type DesktopInstallMode,
} from "./seed-store-strategy.js";
export {
  DESKTOP_DEVELOPMENT_PROJECT_NAME,
  createDesktopDevelopmentProjectMetadata,
  prepareDesktopDevelopmentProject,
  type PrepareDesktopDevelopmentProjectOptions,
} from "./development-project.js";
export {
  DESKTOP_CONTROL_IPC_FD,
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DESKTOP_REQUEST_PIPE_FD,
  DESKTOP_RESPONSE_PIPE_FD,
  DesktopHostRequestDecoder,
  DesktopHostResponseDecoder,
  encodeDesktopRequestCancel,
  encodeDesktopRequestData,
  encodeDesktopRequestEnd,
  encodeDesktopRequestStart,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseError,
  encodeDesktopResponseStart,
  iterDesktopPipeChunks,
  writeDesktopPipeFrame,
  type DesktopHostCommand,
  type DesktopHostEvent,
  type DesktopHostRequestFrame,
  type DesktopHostRequestStart,
  type DesktopHostResponseFrame,
} from "./host-protocol.js";
export {
  DesktopHostProcess,
  type DesktopHostProcessOptions,
  type DesktopHostReady,
} from "./host-process.js";
export {
  attachDesktopNavigationGuard,
  desktopAppIndexUrl,
  DESKTOP_PROTOCOL_PRIVILEGES,
  handleDesktopProtocolRequest,
  isDesktopProtocolUrl,
  resolveDesktopAssetPath,
  serveDesktopStaticAsset,
  type DesktopProtocolHandlerOptions,
} from "./protocol.js";
export {
  DESKTOP_BRIDGE_PROTOCOL_VERSION,
  DESKTOP_IPC,
  type DesktopUpdateState,
  type XrkDesktopApi,
} from "./ipc.js";
export {
  DESKTOP_PLUGIN_INSTALL_BOUNDARY,
  DESKTOP_PLUGIN_INSTALL_OPERATIONS,
  assertDesktopPluginAddSpec,
  assertDesktopPluginMutation,
  assertDesktopPluginPackageName,
  assertDesktopPluginVersion,
  desktopPluginPnpmArgv,
  isDesktopPluginInstallReady,
  type DesktopPluginInstallOperation,
  type DesktopPluginMutation,
  type DesktopPluginRecord,
} from "./plugin-install-surface.js";
export {
  en as desktopMessagesEn,
  zh as desktopMessagesZh,
  formatDesktopMessage,
  resolveDesktopLocale,
  type DesktopLocale,
  type DesktopMessages,
} from "./locale.js";
export { createXrkDesktopBridgeApi, type DesktopBridgeIpc } from "./bridge.js";
export {
  registerDesktopIpcHandlers,
  type DesktopIpcMain,
  type RegisterDesktopIpcOptions,
} from "./desktop-ipc.js";
