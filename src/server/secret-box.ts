import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SecretBox = {
  seal(plaintext: string): string;
  open(sealed: string): string;
  isSealed(stored: string): boolean;
};

const version = "v1";
export const sealedPrefix = `${version}.`;
const ivLength = 12;
const tagLength = 16;

/** Encrypts secrets the app stores, such as Discogs access tokens, with AES-256-GCM. */
export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new Error("A secret box key must be 32 bytes");
  return {
    seal(plaintext) {
      const iv = randomBytes(ivLength);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
      return `${version}.${iv.toString("base64url")}.${ciphertext.toString("base64url")}`;
    },
    open(sealed) {
      const [prefix, iv, data] = sealed.split(".");
      if (prefix !== version || !iv || !data) throw new Error("Not a sealed secret");
      const bytes = Buffer.from(data, "base64url");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(bytes.subarray(bytes.length - tagLength));
      return Buffer.concat([decipher.update(bytes.subarray(0, bytes.length - tagLength)), decipher.final()]).toString("utf8");
    },
    isSealed(stored) {
      return stored.startsWith(sealedPrefix);
    },
  };
}
