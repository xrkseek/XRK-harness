/**
 * Inventory → `host.mjs` apply bridge (after manifest compose).
 */
import { existsSync } from "node:fs";
import type { DshAdapterContribution, DshCompatWireOptions } from "./adapter-types.js";
import { clientPluginRoot, resolvePluginHostManifest } from "./plugin-host-manifest.js";
import { readXrkPluginInventory } from "../xrk/plugin-services.js";
import { hasHostApplyEntry, tryApplyHostModule, recordAppliedHostContribution } from "./xrk-host-apply.js";
import {
  applyHostPackageWithFiberFallback,
  createCordisFiberRpcContribution,
  stopCordisFiber,
} from "./cordis-fiber-runner.js";
import { appendDshCompatContribution } from "./shared-registry.js";
import {
  hasWorkBuddyHostLib,
  isWorkBuddyConnectPackage,
  tryApplyWorkBuddyHost,
} from "./workbuddy-host.js";
import {
  hasOurFreeModelEntry,
  isOurFreeModelPackage,
  tryApplyOurFreeModelHost,
} from "./our-free-model-host.js";

async function tryApplyStagedHost(
  root: string,
  packageName: string,
  ctx: DshCompatWireOptions,
): Promise<DshAdapterContribution | undefined> {
  if (isWorkBuddyConnectPackage(packageName) && hasWorkBuddyHostLib(root)) {
    const wb = await tryApplyWorkBuddyHost(root, packageName, ctx);
    if (wb) return wb;
  }
  if (isOurFreeModelPackage(packageName) && hasOurFreeModelEntry(root)) {
    const ofm = await tryApplyOurFreeModelHost(root, packageName, ctx);
    if (ofm) return ofm;
  }
  if (!hasHostApplyEntry(root)) return undefined;
  return tryApplyHostModule(root, packageName, ctx);
}

function hasStagedHostEntry(root: string, packageName: string): boolean {
  return (
    hasHostApplyEntry(root) ||
    (isWorkBuddyConnectPackage(packageName) && hasWorkBuddyHostLib(root)) ||
    (isOurFreeModelPackage(packageName) && hasOurFreeModelEntry(root))
  );
}

function manifestUsesXrkModule(
  manifest: { http?: readonly { provider: string }[]; rpc?: readonly { provider: string }[] },
): boolean {
  for (const row of manifest.http ?? []) {
    if (row.provider === "xrk-module") return true;
  }
  for (const row of manifest.rpc ?? []) {
    if (row.provider === "xrk-module") return true;
  }
  return false;
}

export async function composeApplyBridgeContributions(
  ctx: DshCompatWireOptions,
): Promise<readonly DshAdapterContribution[]> {
  const inventory = readXrkPluginInventory(ctx);
  const out: DshAdapterContribution[] = [];

  for (const pkg of inventory.packages) {
    const root = clientPluginRoot(inventory.pluginsDir, pkg.name);
    if (!existsSync(root) || !hasStagedHostEntry(root, pkg.name)) continue;
    const manifest = resolvePluginHostManifest(root, pkg.name);
    if (manifest && manifestUsesXrkModule(manifest)) continue;
    const contribution = await tryApplyStagedHost(root, pkg.name, ctx);
    if (contribution) {
      recordAppliedHostContribution(contribution);
      out.push(contribution);
    }
  }

  return out;
}

/** On-demand `host.mjs` apply for Cordis panel `runHostHalf`. */
export async function applyHostPackageByName(
  ctx: DshCompatWireOptions,
  packageName: string,
): Promise<boolean> {
  const name = packageName.trim();
  if (!name || !ctx.pluginsDir) return false;
  const inventory = readXrkPluginInventory(ctx);
  const pkg = inventory.packages.find((row) => row.name === name);
  if (!pkg) return false;
  const root = clientPluginRoot(inventory.pluginsDir, pkg.name);
  if (!existsSync(root) || !hasStagedHostEntry(root, name)) return false;
  const manifest = resolvePluginHostManifest(root, pkg.name);
  if (manifest && manifestUsesXrkModule(manifest)) return false;
  const contribution = await tryApplyStagedHost(root, pkg.name, ctx);
  const fiberFallback = await applyHostPackageWithFiberFallback(
    ctx,
    pkg.name,
    root,
    Boolean(contribution),
    contribution,
  );
  if (!fiberFallback.ok) return false;
  if (contribution) {
    recordAppliedHostContribution(contribution);
    await appendDshCompatContribution(ctx, contribution);
  }
  if (fiberFallback.fiber) {
    const proxy = createCordisFiberRpcContribution(
      pkg.name,
      fiberFallback.rpcChannels,
    );
    if (proxy) {
      recordAppliedHostContribution(proxy);
      await appendDshCompatContribution(ctx, proxy);
    }
  }
  return true;
}

export async function stopHostPackageFiber(packageName: string): Promise<void> {
  await stopCordisFiber(packageName);
}
