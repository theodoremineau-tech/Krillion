// Password hashing and tokens (Node). The practice build swaps in crypto-browser.mjs.
import crypto from 'node:crypto';
export const randomToken = n => crypto.randomBytes(n).toString('base64url');
export const randomHex = n => crypto.randomBytes(n).toString('hex');
export const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
export function safeEq(a, b) {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
