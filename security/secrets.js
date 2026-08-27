const crypto = require("crypto");

function getEncryptionKey() {
  const secret = String(process.env.CREDENTIAL_ENCRYPTION_KEY || "").trim();
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptCredential(value) {
  const key = getEncryptionKey();
  if (!key) throw new Error("CREDENTIAL_ENCRYPTION_KEY is required to store provider credentials.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decryptCredential(payload) {
  if (!payload || typeof payload !== "object") return "";
  const key = getEncryptionKey();
  if (!key) throw new Error("CREDENTIAL_ENCRYPTION_KEY is required to read provider credentials.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

module.exports = { decryptCredential, encryptCredential };
