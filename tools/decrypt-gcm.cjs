// decrypt-gcm.cjs <container (hex cipher + 32-hex tag)> <out.js>
const fs = require("node:fs");
const crypto = require("node:crypto");
const KEY = Buffer.from("826ac684c5e1fb190ff1d5f85bf397b1", "utf8");
const IV = Buffer.from("1e69a0b68e1682b8adfe6af7a2b0068d", "utf8");
const [, , inPath, outPath] = process.argv;
const raw = fs.readFileSync(inPath, "utf8").trim();
const d = crypto.createDecipheriv("aes-256-gcm", KEY, IV);
d.setAuthTag(Buffer.from(raw.substr(-32), "hex"));
const plain = Buffer.concat([d.update(Buffer.from(raw.substr(0, raw.length - 32), "hex")), d.final()]);
fs.writeFileSync(outPath, plain);
console.log(JSON.stringify({ containerChars: raw.length, plainBytes: plain.length, sha1: crypto.createHash("sha1").update(plain).digest("hex").slice(0, 12) }));
