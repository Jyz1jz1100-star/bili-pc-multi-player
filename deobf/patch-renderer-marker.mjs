// Renderer-side patch: make the openPlayerWindow bridge call carry an explicit, main-process-visible
// marker that separates a genuine user-initiated "play this video" from a programmatic/hover-triggered open.
//
// Applied to the main window's core chunk  render\assets\index.ef2cf61c.js :
//   1. replace the single bridge definition
//          lw=e=>_e("window/openPlayerWindow",e)
//      with one that stamps the payload: __realOpen = "pointerdown/click/keydown happened < 1500 ms ago"
//      (hook installed lazily on first use; the very first call is treated as real because the first open
//      always follows a click);
//   2. append one top-level statement right before the chunk's final `export{...}` that installs the
//      pointer/key listeners in the capture phase (so card anchors that stopPropagation are still seen).
//
// Nothing else changes: `_e` forwards the payload through Vue's toRaw, so extra fields reach the main
// process untouched (handleOpenPlayerWindow receives them in `params`).
//
// Usage: node patch-renderer-marker.mjs <in index.ef2cf61c.js> <out.js>
import fs from 'node:fs';

const [, , inPath, outPath] = process.argv;
let src = fs.readFileSync(inPath, 'utf8');

const OLD = 'lw=e=>_e("window/openPlayerWindow",e),';
const NEW = 'lw=e=>{const g=globalThis;if(!g.__biliActHook){g.__biliActHook=1;try{const f=()=>{g.__biliUserActAt=Date.now()};["pointerdown","click","keydown"].forEach(n=>document.addEventListener(n,f,true))}catch{}g.__biliUserActAt=Date.now()}return _e("window/openPlayerWindow",{...e,"__realOpen":!!(g.__biliUserActAt&&Date.now()-g.__biliUserActAt<1500)})},';

const n = src.split(OLD).length - 1;
if (n !== 1) { console.error(`[!] expected exactly 1 bridge definition, found ${n}`); process.exit(1); }
src = src.replace(OLD, NEW);

const HOOK = ';(function(){try{var g=globalThis;g.__biliUserActAt=0;var f=function(){g.__biliUserActAt=Date.now()};["pointerdown","click","keydown"].forEach(function(n){document.addEventListener(n,f,true)})}catch(e){}})();';
const exp = src.lastIndexOf('export{');
if (exp < 0) { console.error('[!] no export{ found -- unexpected chunk shape'); process.exit(1); }
src = src.slice(0, exp) + HOOK + src.slice(exp);

const i = src.indexOf('__realOpen');
if (i < 0) { console.error('[!] marker not inserted'); process.exit(1); }

fs.writeFileSync(outPath, src, 'utf8');
console.log('[ok] bridge marker inserted (__realOpen = user-act within 1500 ms)');
console.log('[ok] pointer/key hook appended before export{} at ' + exp);
console.log('[i]  ' + inPath + ' -> ' + outPath + '  (' + fs.statSync(inPath).size + ' -> ' + src.length + ' bytes)');
