/* Transforme une photo en toile tendue, sous forme de GLB.
 *
 * Pourquoi fabriquer le fichier à la main plutôt que d'en télécharger un :
 * aucune bibliothèque 3D libre ne propose de cadre accroché au mur, et de
 * toute façon un tableau n'a d'intérêt que si c'est le tien. Un GLB est un
 * en-tête, un bloc JSON et un bloc binaire, c'est assemblable en une page.
 *
 * La géométrie est une boîte de 2 cm d'épaisseur : la photo sur la face avant,
 * un matériau sombre sur les cinq autres. Deux primitives partageant les mêmes
 * sommets, chacune avec sa plage d'indices.
 */

const EPAISSEUR = 0.02;   // mètres
const COTE_MAX = 2048;    // px. Au-delà, le USDZ devient inutilisable sur mobile

/** Ré-encode la photo en JPEG borné.
 *
 *  Trois problèmes réglés d'un coup : le HEIC de l'iPhone, que glTF n'accepte
 *  pas ; les 12 mégapixels qui feraient un USDZ de 40 Mo ; et l'orientation
 *  EXIF, que `from-image` applique au lieu de coucher la photo sur le côté.
 */
async function normaliser(fichier) {
  const bitmap = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  const facteur = Math.min(1, COTE_MAX / Math.max(bitmap.width, bitmap.height));
  const l = Math.max(1, Math.round(bitmap.width * facteur));
  const h = Math.max(1, Math.round(bitmap.height * facteur));

  const toile = document.createElement("canvas");
  toile.width = l;
  toile.height = h;
  toile.getContext("2d").drawImage(bitmap, 0, 0, l, h);
  bitmap.close();

  const blob = await new Promise((res, rej) => toile.toBlob(
    (b) => b ? res(b) : rej(new Error("encodage JPEG refusé")), "image/jpeg", 0.9));
  return { octets: new Uint8Array(await blob.arrayBuffer()), l, h };
}

/** Les six faces d'une boîte, l'avant en premier pour qu'il forme sa propre
 *  primitive. Sommets en sens antihoraire vus de l'extérieur. */
function boite(demiL, demiH, demiP) {
  const [w, h, p] = [demiL, demiH, demiP];
  return [
    { n: [0, 0, 1],  v: [[-w, -h, p], [w, -h, p], [w, h, p], [-w, h, p]],
      uv: [[0, 1], [1, 1], [1, 0], [0, 0]] },
    { n: [0, 0, -1], v: [[w, -h, -p], [-w, -h, -p], [-w, h, -p], [w, h, -p]] },
    { n: [-1, 0, 0], v: [[-w, -h, -p], [-w, -h, p], [-w, h, p], [-w, h, -p]] },
    { n: [1, 0, 0],  v: [[w, -h, p], [w, -h, -p], [w, h, -p], [w, h, p]] },
    { n: [0, 1, 0],  v: [[-w, h, p], [w, h, p], [w, h, -p], [-w, h, -p]] },
    { n: [0, -1, 0], v: [[-w, -h, -p], [w, -h, -p], [w, -h, p], [-w, -h, p]] },
  ];
}

const ALIGNER = (n) => (n + 3) & ~3;

/**
 * @param {File|Blob} fichier  la photo
 * @param {number} largeurM    largeur voulue de la toile, en mètres
 * @returns {Promise<Blob>}    un GLB prêt pour model-viewer
 */
export async function construireTableau(fichier, largeurM = 0.6) {
  const image = await normaliser(fichier);
  // Une toile ne se déforme pas : la hauteur découle du rapport de la photo.
  const hauteurM = largeurM * (image.h / image.l);

  const faces = boite(largeurM / 2, hauteurM / 2, EPAISSEUR / 2);
  const positions = [], normales = [], uvs = [];
  for (const f of faces) {
    for (let i = 0; i < 4; i++) {
      positions.push(...f.v[i]);
      normales.push(...f.n);
      uvs.push(...(f.uv ? f.uv[i] : [0, 0]));
    }
  }
  // Face avant seule d'un côté, les cinq autres de l'autre.
  const avant = [0, 1, 2, 0, 2, 3];
  const reste = [];
  for (let f = 1; f < 6; f++) {
    const d = f * 4;
    reste.push(d, d + 1, d + 2, d, d + 2, d + 3);
  }

  const pos = new Float32Array(positions);
  const nrm = new Float32Array(normales);
  const uv = new Float32Array(uvs);
  const iAvant = new Uint16Array(avant);
  const iReste = new Uint16Array(reste);

  /* Chaque vue doit commencer sur un multiple de 4 : glTF exige un décalage
     aligné sur la taille du composant, et 4 satisfait flottants comme entiers. */
  const blocs = [pos, nrm, uv, iAvant, iReste, image.octets];
  const vues = [];
  let curseur = 0;
  for (const b of blocs) {
    vues.push({ byteOffset: curseur, byteLength: b.byteLength });
    curseur = ALIGNER(curseur + b.byteLength);
  }
  const binaire = new Uint8Array(curseur);
  blocs.forEach((b, i) => binaire.set(
    new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength), vues[i].byteOffset));

  const min = [-largeurM / 2, -hauteurM / 2, -EPAISSEUR / 2];
  const max = [largeurM / 2, hauteurM / 2, EPAISSEUR / 2];
  const TABLEAU = 34962, INDICES = 34963;

  const json = {
    asset: { version: "2.0", generator: "Ça rentre ?" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "Tableau" }],
    meshes: [{
      name: "Toile",
      primitives: [
        { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 },
        { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 4, material: 1 },
      ],
    }],
    materials: [
      { name: "Photo",
        pbrMetallicRoughness: { baseColorTexture: { index: 0 },
          metallicFactor: 0, roughnessFactor: 0.82 } },
      // doubleSided par sécurité : une face mal orientée disparaîtrait, et un
      // bord manquant sur une toile de 2 cm serait pénible à diagnostiquer.
      { name: "Chant", doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [0.07, 0.07, 0.08, 1],
          metallicFactor: 0, roughnessFactor: 0.85 } },
    ],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: 5, mimeType: "image/jpeg" }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 24, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: avant.length, type: "SCALAR" },
      { bufferView: 4, componentType: 5123, count: reste.length, type: "SCALAR" },
    ],
    bufferViews: vues.map((v, i) => i === 5
      ? { buffer: 0, ...v }
      : { buffer: 0, ...v, target: i >= 3 ? INDICES : TABLEAU }),
    buffers: [{ byteLength: binaire.byteLength }],
  };

  /* Assemblage GLB : en-tête, morceau JSON complété d'espaces, morceau binaire
     complété de zéros. Les deux doivent finir sur un multiple de 4. */
  const texte = new TextEncoder().encode(JSON.stringify(json));
  const jsonRembourre = new Uint8Array(ALIGNER(texte.length)).fill(0x20);
  jsonRembourre.set(texte);

  const total = 12 + 8 + jsonRembourre.length + 8 + binaire.length;
  const glb = new Uint8Array(total);
  const vue = new DataView(glb.buffer);
  vue.setUint32(0, 0x46546C67, true);          // « glTF »
  vue.setUint32(4, 2, true);
  vue.setUint32(8, total, true);
  vue.setUint32(12, jsonRembourre.length, true);
  vue.setUint32(16, 0x4E4F534A, true);         // « JSON »
  glb.set(jsonRembourre, 20);
  const apres = 20 + jsonRembourre.length;
  vue.setUint32(apres, binaire.length, true);
  vue.setUint32(apres + 4, 0x004E4942, true);  // « BIN »
  glb.set(binaire, apres + 8);

  return new Blob([glb], { type: "model/gltf-binary" });
}
