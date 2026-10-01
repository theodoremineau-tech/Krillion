// Practice-mode stand-ins: nothing leaves the page, so these only need to be unique, not secure.
const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
export const randomToken = n => rand(n);
export const randomHex = n => rand(n);
export const hashPw = (pw, salt) => salt + ':' + pw;
export const safeEq = (a, b) => a === b;
