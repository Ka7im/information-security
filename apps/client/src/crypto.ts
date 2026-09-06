export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function createClientProof(password: string, challengeHash: string): Promise<string> {
  return sha256((await sha256(password)) + challengeHash);
}
