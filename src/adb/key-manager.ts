// Persistent ADB key storage using browser Credential Management API.
// Adapted from Perfetto's adb_key_manager.ts (Apache 2.0).

// PasswordCredential is available in Chrome but not in all TS DOM libs.
declare class PasswordCredential extends Credential {
  constructor(data: { id: string; password: string; name?: string });
  readonly password: string;
}

import { AdbKey } from "./key";

const KEY_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class AdbKeyManager {
  private key: AdbKey | null = null;
  private pending: Promise<AdbKey> | null = null;
  private expiryTimer = -1;

  async getOrCreateKey(): Promise<AdbKey> {
    this.refreshExpiry();
    if (this.key) return this.key;
    if (this.pending) return this.pending;
    this.pending = this.loadOrGenerate();
    try {
      this.key = await this.pending;
      return this.key;
    } finally {
      this.pending = null;
    }
  }

  private async loadOrGenerate(): Promise<AdbKey> {
    // Try to load from browser credential store
    if ("PasswordCredential" in window && navigator.credentials) {
      try {
        const cred = await navigator.credentials.get({
          password: true,
          mediation: "silent",
        } as CredentialRequestOptions);
        if (cred && "password" in cred && typeof (cred as PasswordCredential).password === "string") {
          return AdbKey.deserialize((cred as PasswordCredential).password);
        }
      } catch {
        // Fall through to generate
      }
    }

    // Generate new key
    const key = await AdbKey.generateNewKeyPair();
    await this.storeKey(key);
    return key;
  }

  private async storeKey(key: AdbKey): Promise<void> {
    if (!("PasswordCredential" in window) || !navigator.credentials) return;
    try {
      const cred = new PasswordCredential({
        id: "ahat-web-adb-key",
        password: key.serialize(),
        name: "ahat.web ADB Key",
      });
      await navigator.credentials.store(cred);
    } catch {
      // Credential storage not available — key stays in memory only
    }
  }

  private refreshExpiry(): void {
    if (this.expiryTimer >= 0) clearTimeout(this.expiryTimer);
    this.expiryTimer = self.setTimeout(() => {
      this.key = null;
    }, KEY_TTL_MS);
  }
}
