import crypto from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { env } from "./env";

const ISSUER = "财务对账及认账管理平台";

function getEncryptionKey() {
  const secret = env.appSecret || "dev-two-factor-secret";
  return crypto.createHash("sha256").update(secret).digest();
}

export function generateTwoFactorSecret() {
  return generateSecret();
}

export function encryptTwoFactorSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptTwoFactorSecret(payload: string) {
  const [ivText, tagText, encryptedText] = payload.split(".");
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("二次验证密钥格式异常");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function verifyTwoFactorCode(secret: string, code: string) {
  const result = await verify({ secret, token: code.replace(/\s+/g, "") });
  return result.valid;
}

export async function createTwoFactorSetup(username: string) {
  const secret = generateTwoFactorSecret();
  const otpauth = generateURI({ issuer: ISSUER, label: username, secret });
  const qrCodeDataUrl = await QRCode.toDataURL(otpauth, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
  });
  return { secret, otpauth, qrCodeDataUrl };
}
