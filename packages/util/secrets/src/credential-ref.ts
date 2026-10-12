/**
 * DSH `@deepseek-ai/dsh-credentials` `credentialRef` stand-in.
 * Host remaps that package onto `@xrkseek/secrets` for community Cordis apply
 * (OFM channel-pack). Same POSIX env-var shape as Face credentials schemas.
 */

/** Branded credential reference (env-var name). */
export type CredentialRef = string & { readonly __credentialRef: unique symbol };

const REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Brand an env-var style credential reference.
 * @param ref - non-empty POSIX-portable name.
 * @returns the same string, branded.
 */
export function credentialRef(ref: string): CredentialRef {
  if (typeof ref !== "string" || !REF_RE.test(ref)) {
    throw new TypeError(`invalid credentialRef: ${String(ref)}`);
  }
  return ref as CredentialRef;
}
