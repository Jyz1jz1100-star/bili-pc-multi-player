// encrypt-gcm-cjs: raw bundle -> asar container format (hex(ciphertext) + 32-hex tag), AES-256-GCM
// key/iv = the 32-char hex strings recovered from the 1.19.0 launcher (md5 of the two Chinese words).
const fs = require("node:fs");
const crypto = require("node:crypto");

const KEY = Buffer.from("826ac684c5e1fb190ff1d5f85bf397b1", "utf8");
const IV = Buffer.from("1e69a0b68e1682b8adfe6af7a2b0068d", "utf8");

const [, , inPath, outPath] = process.argv;
const plain = fs.readFileSync(inPath);
const c = crypto.createCipheriv("aes-256-gcm", KEY, IV);
const ct = Buffer.concat([c.update(plain), c.final()]);
const tag = c.getAuthTag();
const out = ct.toString("hex") + tag.toString("hex");
fs.writeFileSync(outPath, out);

// verify round-trip
const raw = fs.readFileSync(outPath, "utf8");
const d = crypto.createDecipheriv("aes-256-gcm", KEY, IV);
d.setAuthTag(Buffer.from(raw.substr(-32), "hex"));
const dec = Buffer.concat([d.update(Buffer.from(raw.substr(0, raw.length - 32), "hex")), d.final()]);
console.log(JSON.stringify({ plainBytes: plain.length, containerChars: out.length, roundTrip: dec.equals(plain) }));
