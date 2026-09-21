/* Fabrique les vignettes du rayon à partir des modèles eux-mêmes.
 *
 *   python -m http.server 8080    (dans ce dossier)
 *   node vignettes.mjs
 *
 * Les captures officielles de Khronos existent, mais elles sont cadrées pour
 * une fiche technique : recadrées en 4:3 dans une vignette de 96 px, le canapé
 * devient une bande bleue indéchiffrable. On rend donc chaque objet soi-même,
 * au même cadrage et sur le même fond que la page, et on cesse au passage de
 * dépendre de GitHub pour afficher le rayon.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const RACINE = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(RACINE, "vignettes");
const PORT = 9378;
const KHRONOS = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";

const MODELES = ["GlamVelvetSofa", "SheenChair", "DiffuseTransmissionPlant",
  "IridescenceLamp", "GlassVaseFlowers"];

function chercherChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(RACINE, "..", "Notouch", "chrome");
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      for (const p of [join(base, d, "chrome-win64", "chrome.exe"),
                       join(base, d, "chrome-linux64", "chrome")]) {
        if (existsSync(p)) return p;
      }
    }
  }
  return "C:/Program Files/Google/Chrome/Application/chrome.exe";
}

mkdirSync(SORTIE, { recursive: true });
const PROFIL = mkdtempSync(join(tmpdir(), "vignettes-"));
const chrome = spawn(chercherChrome(), ["--headless=new", "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + PROFIL, "--no-first-run", "--hide-scrollbars",
  "--force-device-scale-factor=1", "--window-size=500,500", "about:blank"], { stdio: "ignore" });
const nettoyer = () => {
  chrome.kill();
  try { rmSync(PROFIL, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
};
process.on("exit", nettoyer);

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
let cible = null;
for (let i = 0; i < 40 && !cible; i++) {
  await dodo(400);
  try {
    cible = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
      .find((t) => t.type === "page");
  } catch { /* Chrome démarre encore */ }
}
if (!cible) { console.log("Chrome injoignable"); process.exit(1); }

const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const at = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && at.has(m.id)) { at.get(m.id)(m.result); at.delete(m.id); }
});
const cdp = (m, p) => new Promise((res) => {
  const n = ++id; at.set(n, res);
  ws.send(JSON.stringify({ id: n, method: m, params: p || {} }));
});
const ev = async (expression) => {
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __erreur: r.exceptionDetails.exception?.description?.split("\n")[0] };
  return r.result?.value;
};

await cdp("Page.enable"); await cdp("Runtime.enable");
/* Une page nue plutôt que index.html : on veut un cadrage de vignette, pas
   celui de la scène principale, et aucune de ses commandes. */
await cdp("Page.navigate", { url: "http://localhost:8080/index.html" });
await dodo(4000);
await ev(`(() => {
  document.body.innerHTML = "";
  const v = document.createElement("model-viewer");
  v.id = "v";
  v.style.cssText = "width:256px;height:192px;background:transparent;display:block";
  v.setAttribute("environment-image", "neutral");
  v.setAttribute("exposure", "1.1");
  v.setAttribute("shadow-intensity", "0.9");
  v.setAttribute("shadow-softness", "1");
  v.setAttribute("camera-orbit", "-28deg 74deg auto");
  v.setAttribute("interaction-prompt", "none");
  v.setAttribute("disable-zoom", "");
  document.body.style.background = "transparent";
  document.body.appendChild(v);
})()`);

console.log("Vignettes du rayon\n");
let echecs = 0;
for (const m of MODELES) {
  const r = await ev(`(async () => {
    const v = document.getElementById("v");
    const fini = new Promise(r => {
      v.addEventListener("load", () => r(1), { once: true });
      v.addEventListener("error", () => r(0), { once: true });
      setTimeout(() => r(0), 90000);
    });
    v.src = ${JSON.stringify(`${KHRONOS}/${m}/glTF-Binary/${m}.glb`)};
    if (!await fini) return null;
    // laisser le rendu se stabiliser : la première image est souvent blanche
    await new Promise(r => setTimeout(r, 1200));
    const blob = await v.toBlob({ mimeType: "image/png", idealAspect: false });
    const o = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (const b of o) s += String.fromCharCode(b);
    return { b64: btoa(s), octets: o.length };
  })()`);
  if (!r || r.__erreur) { echecs++; console.log("  ÉCHEC %s %s", m, r?.__erreur || ""); continue; }
  const dest = join(SORTIE, m + ".png");
  writeFileSync(dest, Buffer.from(r.b64, "base64"));
  console.log("  ok    %s  %d ko", m.padEnd(26), Math.round(r.octets / 1024));
}
ws.close();
console.log(echecs ? `\n${echecs} échec(s)` : "\nDans " + SORTIE);
nettoyer();
process.exitCode = echecs ? 1 : 0;
