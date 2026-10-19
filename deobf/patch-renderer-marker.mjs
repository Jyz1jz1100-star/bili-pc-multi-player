// Stamp every "play this video" bridge call with a main-process-visible marker.
//
// The renderer bundles the single sender of window/openPlayerWindow as an arrow function, e.g.
//     lw=e=>_e("window/openPlayerWindow",e),
// We rewrite it so the payload carries __realOpen = "pointerdown/click/keydown within 1500ms",
// which lets the main-process shim tell a real user action from a programmatic/automatic open.
//
// Usage: node patch-renderer-marker.mjs <shared chunk js> <out.js>
import fs from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: node patch-renderer-marker.mjs <in.js> <out.js>'); process.exit(2); }
let src = fs.readFileSync(inPath, 'utf8');

function markerDef(alias, param, bridge) {
  return (
    `${alias}=${param}=>{const g=globalThis;` +
    `if(!g.__biliActHook){g.__biliActHook=1;try{const f=()=>{g.__biliUserActAt=Date.now()};` +
    `["pointerdown","click","keydown"].forEach(n=>document.addEventListener(n,f,true))}catch{}` +
    `g.__biliUserActAt=Date.now()}` +
    `return ${bridge}("window/openPlayerWindow",{...${param},"__realOpen":!!(g.__biliUserActAt&&Date.now()-g.__biliUserActAt<1500)})},`
  );
}

const EXACT = 'lw=e=>_e("window/openPlayerWindow",e),';
let how = null;
if (src.split(EXACT).length - 1 === 1) {
  src = src.replace(EXACT, markerDef('lw', 'e', '_e'));
  how = 'exact';
} else {
  // generic: <alias>=<param>=><bridge>("window/openPlayerWindow",<param>),
  const re = /([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)=>([A-Za-z0-9_$]+)\("window\/openPlayerWindow",\2\),/;
  const m = src.match(re);
  if (!m) {
    console.error('[!] could not find the openPlayerWindow bridge sender in this chunk -- client version not supported');
    process.exit(1);
  }
  src = src.replace(re, markerDef(m[1], m[2], m[3]));
  how = 'regex';
}

// install the capture-phase listeners as a top-level statement (before the chunk's trailing export{})
const HOOK = ';(function(){try{var g=globalThis;g.__biliUserActAt=0;var f=function(){g.__biliUserActAt=Date.now()};["pointerdown","click","keydown"].forEach(function(n){document.addEventListener(n,f,true)})}catch(e){}})();';
const exp = src.lastIndexOf('export{');
if (exp < 0) { console.error('[!] no trailing export{ in this chunk -- not a Vite module?'); process.exit(1); }
src = src.slice(0, exp) + HOOK + src.slice(exp);

if (src.indexOf('__realOpen') < 0) { console.error('[!] marker not inserted'); process.exit(1); }
fs.writeFileSync(outPath, src, 'utf8');
console.log(`[ok] __realOpen marker inserted (${how})`);
console.log(`[ok] capture-phase pointer/key hook appended before export{} at ${exp} (${fs.statSync(inPath).size} -> ${src.length} bytes)`);
