/** DeepSeek Files API identifiers (DSH `dsh-v0.1.1-rc.2`). */

export type DeepSeekFileId = string & { readonly __brand: "DeepSeekFileId" };
export type DeepSeekFileScope = string & { readonly __brand: "DeepSeekFileScope" };

export function deepSeekFileId(id: string): DeepSeekFileId {
  return id as DeepSeekFileId;
}

export function deepSeekFileScopeDigest(digest: string): DeepSeekFileScope {
  return digest as DeepSeekFileScope;
}
