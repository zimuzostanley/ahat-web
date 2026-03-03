// ADB RSA key generation & authentication signing.
// Adapted from Perfetto's adb_key.ts (Apache 2.0).

import { BigInteger, RSAKey } from "jsbn-rsa";

const WORD_SIZE = 4;
const MODULUS_SIZE_BITS = 2048;
const MODULUS_SIZE = MODULUS_SIZE_BITS / 8;
const MODULUS_SIZE_WORDS = MODULUS_SIZE / WORD_SIZE;
const PUBKEY_ENCODED_SIZE = 3 * WORD_SIZE + 2 * MODULUS_SIZE;

const ADB_CRYPTO_ALGO = {
  name: "RSASSA-PKCS1-v1_5",
  hash: { name: "SHA-1" },
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
  modulusLength: MODULUS_SIZE_BITS,
};

const SIGNING_ASN1_PREFIX = new Uint8Array([
  0x00, 0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a,
  0x05, 0x00, 0x04, 0x14,
]);

const R32 = BigInteger.ONE.shiftLeft(32);

interface ValidJwk {
  n: string; e: string; d: string;
  p: string; q: string; dp: string; dq: string; qi: string;
}

function isValidJwk(key: JsonWebKey): key is ValidJwk {
  return key.n !== undefined && key.e !== undefined && key.d !== undefined &&
    key.p !== undefined && key.q !== undefined && key.dp !== undefined &&
    key.dq !== undefined && key.qi !== undefined;
}

function base64ToBytes(b64: string): Uint8Array {
  const str = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function bytesToBase64(buf: Uint8Array): string {
  let str = "";
  for (let i = 0; i < buf.length; i++) str += String.fromCharCode(buf[i]);
  return btoa(str);
}

function hexEncode(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

function bigIntToFixedArray(bn: BigInteger, size: number): Uint8Array {
  const padded = bn.toByteArray();
  let start = 0;
  while (start < padded.length && padded[start] === 0) start++;
  const bytes = Uint8Array.from(padded.slice(start));
  const res = new Uint8Array(size);
  if (bytes.length > res.length) throw new Error("BigInteger too large");
  res.set(bytes, res.length - bytes.length);
  return res;
}

export class AdbKey {
  private constructor(private jwk: ValidJwk) {}

  static async generateNewKeyPair(): Promise<AdbKey> {
    const keyPair = await crypto.subtle.generateKey(
      ADB_CRYPTO_ALGO, true, ["sign"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    if (!isValidJwk(jwk)) throw new Error("Invalid ADB key generated");
    return new AdbKey(jwk);
  }

  static deserialize(s: string): AdbKey {
    return new AdbKey(JSON.parse(s));
  }

  serialize(): string {
    return JSON.stringify(this.jwk);
  }

  /** Sign an ADB auth challenge token with PKCS#1 v1.5. */
  sign(token: Uint8Array): Uint8Array {
    const rsa = new RSAKey();
    rsa.setPrivateEx(
      hexEncode(base64ToBytes(this.jwk.n)),
      hexEncode(base64ToBytes(this.jwk.e)),
      hexEncode(base64ToBytes(this.jwk.d)),
      hexEncode(base64ToBytes(this.jwk.p)),
      hexEncode(base64ToBytes(this.jwk.q)),
      hexEncode(base64ToBytes(this.jwk.dp)),
      hexEncode(base64ToBytes(this.jwk.dq)),
      hexEncode(base64ToBytes(this.jwk.qi)),
    );

    // Message: 00 01 FF...FF [ASN.1 PREFIX] [TOKEN]
    const msg = new Uint8Array(MODULUS_SIZE);
    msg.fill(0xff);
    msg[0] = 0x00;
    msg[1] = 0x01;
    msg.set(SIGNING_ASN1_PREFIX, msg.length - SIGNING_ASN1_PREFIX.length - token.length);
    msg.set(token, msg.length - token.length);

    const msgInt = new BigInteger(Array.from(msg));
    const sig = rsa.doPrivate(msgInt);
    return bigIntToFixedArray(sig, MODULUS_SIZE);
  }

  /** Encode public key in Android's adb format. */
  getPublicKey(): string {
    const rsa = new RSAKey();
    rsa.setPublic(
      hexEncode(base64ToBytes(this.jwk.n)),
      hexEncode(base64ToBytes(this.jwk.e)),
    );

    const n0inv = R32.subtract(rsa.n.modInverse(R32)).intValue();
    const r = BigInteger.ONE.shiftLeft(1).pow(MODULUS_SIZE_BITS);
    const rr = r.multiply(r).mod(rsa.n);

    const buf = new ArrayBuffer(PUBKEY_ENCODED_SIZE);
    const dv = new DataView(buf);
    dv.setUint32(0, MODULUS_SIZE_WORDS, true);
    dv.setUint32(WORD_SIZE, n0inv, true);

    const u8 = new Uint8Array(buf);
    u8.set(bigIntToFixedArray(rsa.n, MODULUS_SIZE).reverse(), 2 * WORD_SIZE);
    u8.set(bigIntToFixedArray(rr, MODULUS_SIZE).reverse(), 2 * WORD_SIZE + MODULUS_SIZE);
    dv.setUint32(2 * WORD_SIZE + 2 * MODULUS_SIZE, rsa.e, true);

    return bytesToBase64(u8) + " ahat.web";
  }
}
