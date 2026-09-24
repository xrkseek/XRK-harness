/** Browser-test stub: native keytar is unavailable under jsdom Vitest. */
export async function getPassword() { return null }
export async function setPassword() {}
export async function deletePassword() { return false }
export async function findCredentials() { return [] }
export async function findPassword() { return null }
