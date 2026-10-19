// build-shim-bundle.cjs <raw-bundle.js> <shim.js> <out.js>
// Produces a bundle whose text is  <shim statements>  +  <raw bundle unchanged>
// Both end up inside the launcher's wrapper function, so the shim runs first with
// (module, exports, require, __dirname, __filename) in scope, and the script's completion
// value stays the wrapper function the launcher calls.
const fs = require("node:fs");
const [, , rawPath, shimPath, outPath] = process.argv;
if (!rawPath || !shimPath || !outPath) { console.error("usage: build-shim-bundle.cjs <raw.js> <shim.js> <out.js>"); process.exit(2); }

const raw = fs.readFileSync(rawPath, "utf8");
const shim = fs.readFileSync(shimPath, "utf8");
const header = "/* bili-multiplayer patch: shim prepended, original bundle untouched below */\n";
const patched = header + shim + "\n;\n" + raw;
fs.writeFileSync(outPath, patched, "utf8");
console.log(JSON.stringify({ rawBytes: raw.length, shimBytes: shim.length, outBytes: patched.length }));
