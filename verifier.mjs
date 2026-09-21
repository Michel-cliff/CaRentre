/* Ce qu'on peut prouver sans téléphone : la page charge, le modèle est mesuré,
 * et le champ « largeur réelle » redimensionne pour de vrai.
 *
 *   python -m http.server 8080    (dans ce dossier)
 *   node verifier.mjs
 *
 * L'AR elle-même ne se teste pas ici — Quick Look est un visualiseur iOS. Ce
 * banc couvre tout le reste, c'est-à-dire tout ce que j'ai écrit.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const RACINE = dirname(fileURLToPath(import.meta.url));
const PORT = 9361;
const PAGE = process.env.URL_PAGE || "http://localhost:8080/index.html";

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

const PROFIL = mkdtempSync(join(tmpdir(), "carentre-"));
const chrome = spawn(chercherChrome(), [
  "--headless=new",
  "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + PROFIL,
  "--no-first-run",
  "--hide-scrollbars",
  "--window-size=430,932",
  "about:blank"
], { stdio: "ignore" });

const nettoyer = () => {
  chrome.kill();
  try { rmSync(PROFIL, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { /* Windows garde le profil un instant */ }
};
process.on("exit", nettoyer);

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));

let cible = null;
for (let i = 0; i < 40 && !cible; i++) {
  await dodo(400);
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    cible = l.find((t) => t.type === "page");
  } catch { /* Chrome démarre encore */ }
}
if (!cible) { console.log("Chrome injoignable"); process.exit(1); }

const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const attentes = new Map();
const journal = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && attentes.has(m.id)) { attentes.get(m.id)(m.result); attentes.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
    journal.push(m.params.type + " : " + m.params.args.map((a) => a.value ?? a.description).join(" "));
  }
  if (m.method === "Runtime.exceptionThrown") {
    journal.push("exception : " + m.params.exceptionDetails.text
      + " " + (m.params.exceptionDetails.exception?.description || ""));
  }
});
const cdp = (method, params) => new Promise((res) => {
  const n = ++id;
  attentes.set(n, res);
  ws.send(JSON.stringify({ id: n, method, params: params || {} }));
});
const evaluer = async (expression) => {
  const r = await cdp("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true
  });
  if (r.exceptionDetails) return { __erreur: r.exceptionDetails.text };
  return r.result?.value;
};

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.navigate", { url: PAGE });

let echecs = 0;
const verifier = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log("  %s %s%s", ok ? "ok   " : "ÉCHEC", nom.padEnd(40),
    detail === undefined ? "" : detail);
};

console.log("Banc « Ça rentre ? »\n");

/* Le modèle pèse 4 Mo et le CDN doit répondre : on attend l'événement de
   chargement plutôt qu'un délai au hasard. */
const charge = await evaluer(`new Promise((res) => {
  const v = document.getElementById("vue");
  if (v.loaded) return res(true);
  v.addEventListener("load", () => res(true), { once: true });
  setTimeout(() => res(false), 45000);
})`);

verifier("l'élément model-viewer est défini",
  !!(await evaluer("!!customElements.get('model-viewer')")));
verifier("le modèle se charge", charge === true, charge === true ? "" : "→ délai dépassé");

const dims = await evaluer(`(async () => {
  const d = await document.getElementById("vue").getDimensions();
  return { x: d.x, y: d.y, z: d.z };
})()`);
const mesure = dims && !dims.__erreur && dims.x > 0;
verifier("le meuble est mesuré", mesure,
  mesure ? `${Math.round(dims.x * 100)} × ${Math.round(dims.z * 100)} × ${Math.round(dims.y * 100)} cm` : "");

/* Le champ affiche-t-il bien la largeur du fichier, sans la réinventer ? */
const affichee = Number(await evaluer("document.getElementById('largeur').value"));
verifier("le champ reprend la largeur du fichier",
  mesure && Math.abs(affichee - dims.x * 100) < 1, affichee + " cm");

/* Le cœur du sujet : taper une largeur doit changer l'échelle du modèle. */
const mise = await evaluer(`(() => {
  const l = document.getElementById("largeur");
  l.value = 80;
  l.dispatchEvent(new Event("input"));
  return { echelle: document.getElementById("vue").scale,
           texte: document.getElementById("mesures").textContent };
})()`);
const attendu = mesure ? (0.8 / dims.x) : 0;
const obtenu = Number(String(mise?.echelle || "").split(" ")[0]);
verifier("80 cm → bon facteur d'échelle",
  mesure && Math.abs(obtenu - attendu) < 1e-6, obtenu ? "×" + obtenu.toFixed(3) : "");
verifier("la ligne de mesures suit", /^80 × \d+ cm au sol/.test(mise?.texte || ""),
  mise?.texte || "(vide)");

/* Deux frappes de suite ne doivent pas composer les facteurs. */
const deuxfois = await evaluer(`(() => {
  const l = document.getElementById("largeur");
  for (const v of [120, 80]) { l.value = v; l.dispatchEvent(new Event("input")); }
  return document.getElementById("vue").scale;
})()`);
verifier("deux réglages ne se cumulent pas",
  Math.abs(Number(String(deuxfois).split(" ")[0]) - attendu) < 1e-6, String(deuxfois));

verifier("pas de bouton AR mort sur ordinateur",
  (await evaluer("document.getElementById('ar').hidden")) === true
  && (await evaluer("document.getElementById('depuis').hidden")) === false);

const bruit = journal.filter((l) => !/favicon/i.test(l));
verifier("console propre", bruit.length === 0);
for (const l of bruit) console.log("        " + l);

ws.close();
console.log(echecs ? `\n${echecs} échec(s)` : "\ntout passe — reste l'AR, qui se juge sur l'iPhone");
nettoyer();
process.exitCode = echecs ? 1 : 0;
