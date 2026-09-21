/* Ce qu'on peut prouver sans téléphone : la page charge, le rayon répond, le
 * champ « largeur réelle » redimensionne, et le tableau fabriqué à partir
 * d'une photo est un GLB que model-viewer accepte, aux bonnes dimensions.
 *
 *   python -m http.server 8080    (dans ce dossier)
 *   node verifier.mjs
 *   URL_PAGE=https://carentre.vercel.app/ node verifier.mjs
 *
 * L'AR elle-même ne se teste pas ici : Quick Look est un visualiseur iOS.
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
  "--headless=new", "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + PROFIL, "--no-first-run", "--hide-scrollbars",
  "--window-size=430,932", "about:blank"
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
  if (r.exceptionDetails) {
    return { __erreur: r.exceptionDetails.exception?.description?.split("\n")[0]
      || r.exceptionDetails.text };
  }
  return r.result?.value;
};

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Page.navigate", { url: PAGE });

let echecs = 0;
const verifier = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log("  %s %s%s", ok ? "ok   " : "ÉCHEC", nom.padEnd(42),
    detail === undefined ? "" : detail);
};

/** Attend le prochain chargement du modèle et rend ses dimensions en cm. */
const attendreModele = (avant = "") => evaluer(`(async () => {
  const v = document.getElementById("vue");
  const fini = new Promise(r => {
    v.addEventListener("load", () => r(1), { once: true });
    v.addEventListener("error", () => r(0), { once: true });
    setTimeout(() => r(0), 60000);
  });
  ${avant}
  if (!await fini) return null;
  await new Promise(r => setTimeout(r, 120));
  const d = await v.getDimensions();
  return { l: Math.round(d.x*100), h: Math.round(d.y*100), p: Math.round(d.z*100),
           champ: Number(document.getElementById("largeur").value),
           texte: document.getElementById("mesures").textContent };
})()`);

console.log("Banc « Ça rentre ? »  " + PAGE + "\n");

const depart = await attendreModele();
verifier("l'élément model-viewer est défini",
  !!(await evaluer("!!customElements.get('model-viewer')")));
verifier("le modèle par défaut se charge", !!depart && !depart.__erreur,
  depart && !depart.__erreur ? `${depart.l} × ${depart.p} × ${depart.h} cm` : "");
verifier("le champ reprend la largeur du fichier",
  !!depart && depart.champ === depart.l, depart?.champ + " cm");

/* le rayon */
const rayon = await evaluer(`({
  objets: document.querySelectorAll("#rayon .objet[data-id]").length,
  actes: document.querySelectorAll("#rayon .objet.acte").length,
  actif: document.querySelector('#rayon .objet[aria-current="true"]')?.dataset.id || null
})`);
verifier("le rayon est garni", rayon.objets === 5 && rayon.actes === 2,
  `${rayon.objets} objets + ${rayon.actes} actions`);
verifier("l'objet courant est marqué", rayon.actif === "SheenChair", rayon.actif);

/* Les vignettes sont servies d'ici, mais elles sont générées par un script à
   part : une régénération ratée ou un fichier oublié se verrait ici. */
await dodo(3000);
const vignettes = await evaluer(`[...document.querySelectorAll("#rayon img")]
  .filter(i => i.complete && i.naturalWidth > 0).length`);
verifier("les vignettes du rayon s'affichent", vignettes === 5, vignettes + "/5");

/* Changer d'objet doit recharger ET remesurer. Le canapé fait 219 cm : s'il
   arrivait à 83, c'est que la mesure serait restée celle de la chaise. */
const canape = await attendreModele(
  `document.querySelector('#rayon .objet[data-id="GlamVelvetSofa"]').click();`);
verifier("le rayon charge un autre objet", !!canape && canape.l === 219,
  canape ? `${canape.l} × ${canape.p} × ${canape.h} cm` : "échec");
verifier("le champ suit le nouvel objet", canape?.champ === 219, canape?.champ + " cm");

/* largeur réelle */
const mise = await evaluer(`(() => {
  const l = document.getElementById("largeur");
  l.value = 180; l.dispatchEvent(new Event("input"));
  return { echelle: document.getElementById("vue").scale,
           texte: document.getElementById("mesures").textContent };
})()`);
const facteur = Number(String(mise?.echelle || "").split(" ")[0]);
verifier("180 cm → bon facteur d'échelle",
  Math.abs(facteur - 1.8 / 2.1899999) < 1e-3, "×" + facteur.toFixed(3));
verifier("la ligne de mesures suit", /^180 × \d+ cm au sol/.test(mise?.texte || ""),
  mise?.texte || "(vide)");

const deuxfois = await evaluer(`(() => {
  const l = document.getElementById("largeur");
  for (const v of [90, 180]) { l.value = v; l.dispatchEvent(new Event("input")); }
  return document.getElementById("vue").scale;
})()`);
verifier("deux réglages ne se cumulent pas",
  Math.abs(Number(String(deuxfois).split(" ")[0]) - facteur) < 1e-9);

/* sol ou mur */
const mur = await evaluer(`(() => {
  document.getElementById("pose-mur").click();
  return { pose: document.getElementById("vue").getAttribute("ar-placement"),
           presse: document.getElementById("pose-mur").getAttribute("aria-pressed"),
           texte: document.getElementById("mesures").textContent };
})()`);
verifier("le mode mur change ar-placement", mur.pose === "wall" && mur.presse === "true",
  mur.pose);
verifier("le mode mur reformule les mesures", /sur le mur/.test(mur.texte || ""),
  mur.texte);
await evaluer(`document.getElementById("pose-sol").click()`);

/* le tableau fabriqué à la main */
const tableau = await evaluer(`(async () => {
  const { construireTableau } = await import("./tableau.js");
  // une photo synthétique en 400 × 300 : le tableau doit en hériter le rapport
  const c = document.createElement("canvas");
  c.width = 400; c.height = 300;
  const g = c.getContext("2d");
  g.fillStyle = "#c33"; g.fillRect(0, 0, 400, 300);
  g.fillStyle = "#fff"; g.fillRect(20, 20, 120, 60);
  const photo = await new Promise(r => c.toBlob(r, "image/png"));
  const glb = await construireTableau(photo, 0.6);
  const t = new Uint8Array(await glb.slice(0, 12).arrayBuffer());
  const entete = new DataView(t.buffer).getUint32(0, true);
  return { octets: glb.size, type: glb.type, magique: entete === 0x46546C67,
           url: URL.createObjectURL(glb) };
})()`);
verifier("le tableau produit un GLB valide",
  tableau && !tableau.__erreur && tableau.magique,
  tableau?.__erreur || `${tableau?.octets} octets, ${tableau?.type}`);

const pose = await attendreModele(
  `document.getElementById("vue").src = ${JSON.stringify(tableau?.url || "")};`);
verifier("model-viewer accepte le tableau", !!pose && !pose.__erreur,
  pose ? `${pose.l} × ${pose.h} × ${pose.p} cm` : "refusé");
// 60 cm de large, photo 4:3 → 45 cm de haut, 2 cm d'épaisseur
verifier("le tableau fait la taille demandée",
  !!pose && pose.l === 60 && pose.h === 45 && pose.p === 2,
  pose ? `${pose.l} × ${pose.h} × ${pose.p}` : "");

const bruit = journal.filter((l) => !/favicon/i.test(l));
verifier("console propre", bruit.length === 0);
for (const l of bruit) console.log("        " + l);

ws.close();
console.log(echecs ? `\n${echecs} échec(s)`
  : "\ntout passe, reste l'AR, qui se juge sur l'iPhone");
nettoyer();
process.exitCode = echecs ? 1 : 0;
