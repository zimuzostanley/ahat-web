import { describe, it, expect } from "vitest";
import { AdbKey } from "./key";

describe("AdbKey", () => {
  it("generates a new key pair", async () => {
    const key = await AdbKey.generateNewKeyPair();
    expect(key).toBeDefined();
  });

  it("serializes and deserializes roundtrip", async () => {
    const key = await AdbKey.generateNewKeyPair();
    const serialized = key.serialize();
    expect(typeof serialized).toBe("string");
    const parsed = JSON.parse(serialized);
    expect(parsed.n).toBeDefined();
    expect(parsed.e).toBeDefined();
    expect(parsed.d).toBeDefined();

    const restored = AdbKey.deserialize(serialized);
    expect(restored.serialize()).toBe(serialized);
  });

  it("generates public key in Android format", async () => {
    const key = await AdbKey.generateNewKeyPair();
    const pubkey = key.getPublicKey();
    // Should be base64-encoded data followed by " ahat.web"
    expect(pubkey).toMatch(/.+ ahat\.web$/);
    // Decode base64 part
    const b64Part = pubkey.split(" ")[0];
    const decoded = atob(b64Part);
    // Should be PUBKEY_ENCODED_SIZE = 3*4 + 2*256 = 524 bytes
    expect(decoded.length).toBe(524);
  });

  it("signs a 20-byte token", async () => {
    const key = await AdbKey.generateNewKeyPair();
    const token = new Uint8Array(20);
    crypto.getRandomValues(token);
    const sig = key.sign(token);
    // Signature should be 256 bytes (2048-bit RSA)
    expect(sig.length).toBe(256);
    // Should not be all zeros
    expect(sig.some(b => b !== 0)).toBe(true);
  });

  it("produces different signatures for different tokens", async () => {
    const key = await AdbKey.generateNewKeyPair();
    const token1 = new Uint8Array(20);
    const token2 = new Uint8Array(20);
    crypto.getRandomValues(token1);
    crypto.getRandomValues(token2);
    const sig1 = key.sign(token1);
    const sig2 = key.sign(token2);
    // Different tokens should produce different signatures
    const same = sig1.every((b, i) => b === sig2[i]);
    expect(same).toBe(false);
  });
});
