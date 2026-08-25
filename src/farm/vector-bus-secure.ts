import crypto from "node:crypto";
import type { AgentVector } from "./vector-bus";

export type EncryptedVectorPacket = {
  sender: string;
  nonce: string;
  ciphertext: string;
  tag: string;
  issuedAt: number;
  ttl: number;
};

/** Optional authenticated encryption boundary for vector traffic.
 * Plain VectorBus remains available for simulation; this is the transport hook
 * for deployments that can provision a 32-byte shared key securely.
 */
export class SecureVectorBus {
  constructor(private readonly key: Buffer, private readonly clock = () => Date.now()) {
    if (key.length !== 32) throw new Error("SecureVectorBus key must be exactly 32 bytes");
  }

  encrypt(sender: string, vector: AgentVector, ttl = 3): EncryptedVectorPacket {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, nonce);
    const aad = Buffer.from(`${sender}:${ttl}`, "utf8");
    cipher.setAAD(aad);
    const plaintext = Buffer.from(JSON.stringify(vector), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      sender,
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      issuedAt: this.clock(),
      ttl,
    };
  }

  decrypt(packet: EncryptedVectorPacket): AgentVector {
    if (packet.ttl < 0 || !Number.isFinite(packet.issuedAt)) throw new Error("Invalid vector packet");
    const nonce = Buffer.from(packet.nonce, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, nonce);
    decipher.setAAD(Buffer.from(`${packet.sender}:${packet.ttl}`, "utf8"));
    decipher.setAuthTag(Buffer.from(packet.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(packet.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as AgentVector;
  }
}
