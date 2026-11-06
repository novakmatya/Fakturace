import crypto from "node:crypto";

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const value = alphabet.indexOf(ch);
    if (value < 0) throw new Error(`Neplatný znak base32: ${ch}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** TOTP podle RFC 6238 (SHA-1, 30 s, 6 číslic) z URI otpauth://. */
export function totpFromUri(uri: string, now = Date.now()): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("URI neobsahuje secret");
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}
