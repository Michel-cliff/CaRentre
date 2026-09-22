# Ça rentre ?

Pose un meuble en 3D dans ta pièce, à sa taille réelle, depuis ton téléphone.
Une page. Aucun build, aucun serveur, aucun compte.

**https://carentre.vercel.app**

## Le principe

Safari iOS ne supporte pas WebXR : aucune page web ne peut ouvrir une vue AR
sur iPhone. La seule route est **AR Quick Look**, le visualiseur natif d'iOS.
On lui sert un fichier USDZ et il fait le reste : détection du sol, tap pour
poser, glisser pour déplacer, deux doigts pour pivoter, et l'ancrage qui tient
quand la caméra regarde ailleurs.

Le USDZ est fabriqué **dans le navigateur** par `model-viewer`, à partir du GLB
chargé. Pas de conversion côté serveur, donc pas de serveur.

## Ce qu'on peut poser

- **Le rayon**, cinq objets des glTF Sample Assets de Khronos : canapé, chaise,
  plante, lampe, vase. Choisis pour couvrir toutes les échelles, du meuble de
  2,19 m à l'objet de bureau de 22 cm.
- **Ton propre `.glb`**, lu dans le navigateur, jamais envoyé.
- **Ta photo, en tableau**. Voir plus bas.

## Le champ « largeur réelle »

C'est la première idée de l'outil. Un GLB trouvé sur le web ment une fois sur
deux sur ses dimensions : le glTF est censé être en mètres, beaucoup d'exports
sont en centimètres, et le canapé arrive 100× trop grand. Le champ rattrape ça
en une frappe. Le facteur est inscrit dans le `xformOp:transform` du USDZ, si
bien que Quick Look pose le meuble à sa taille métrique corrigée.

La taille est verrouillée en AR (`ar-scale="fixed"`). Un meuble a une taille
réelle ; pouvoir la changer du bout des doigts viderait l'outil de son sens.

## Le tableau fabriqué à partir d'une photo

Aucune bibliothèque 3D libre ne propose de cadre accroché au mur, et de toute
façon un tableau n'a d'intérêt que si c'est le tien. [`tableau.js`](tableau.js)
assemble donc un GLB à la main : une boîte de 2 cm d'épaisseur, la photo sur la
face avant, un matériau sombre sur les cinq autres. La hauteur découle du
rapport de l'image, parce qu'une toile ne se déforme pas.

La photo est ré-encodée en JPEG borné à 2048 px avant d'entrer dans le fichier.
Ça règle trois choses d'un coup : le HEIC de l'iPhone que glTF n'accepte pas,
les 12 mégapixels qui feraient un USDZ de 40 Mo, et l'orientation EXIF.

## Sol et mur, et les deux plateformes

Le sélecteur bascule `ar-placement` entre `floor` et `wall`, mais il ne veut pas
dire la même chose des deux côtés.

**Sur iPhone**, Quick Look ne reçoit aucune consigne de mur. model-viewer
n'ajoute au lien que `allowsContentScaling=0`, et `ar-placement` ne change que
l'aperçu : l'ombre est projetée vers l'arrière au lieu du dessous. La détection
de surface verticale appartient entièrement à Quick Look.

**Sur Android**, c'est l'inverse. Le lien est une intention vers Scene Viewer,
et model-viewer y met `enable_vertical_placement=true` quand le mode mur est
actif, plus `resizable=false` pour le verrouillage de taille. Le mur y est donc
une vraie instruction.

En échange, Android perd les deux fonctions les plus intéressantes. Scene Viewer
est une application séparée à qui l'URL du modèle est transmise dans
l'intention, et une URL `blob:` n'existe que dans l'onglet qui l'a créée. **Ton
propre `.glb` et ton tableau ne peuvent donc pas être posés sur Android.** Les
objets du rayon, servis par des URL publiques, fonctionnent.

La page ne laisse pas ce cas échouer en silence : quand la réalité augmentée
est disponible mais que le modèle vient de l'appareil et que la route passe par
Scene Viewer, le bouton est remplacé par l'explication. La règle est une
fonction pure, `situation()`, parce qu'aucun banc headless ne peut se faire
passer pour un iPhone ou un Android, alors qu'une table de vérité se vérifie
très bien.

Le test porte sur **Android**, pas sur l'absence de Quick Look. La première
version cherchait `relList.supports("ar")`, ce qui paraissait équivalent et ne
l'est pas : sur iPhone, dans Chrome, Edge, Firefox, l'application Google ou
DuckDuckGo, ce test répond non alors que Quick Look fonctionne. model-viewer y
reconnaît ces navigateurs à leur user-agent. Le bouton disparaissait donc sur
un fichier ouvert depuis l'appareil, sur un téléphone parfaitement capable de
le poser. Le banc usurpe désormais cinq user-agents réels.

## Limites, honnêtement

- **Un objet à la fois.** Aucun des deux visualiseurs n'en affiche plus d'un.
  Pour meubler une pièce entière, il faut y aller morceau par morceau.
- **Rien n'est sauvegardé.** Aucune disposition n'est mémorisée d'une session à
  l'autre. Ça demanderait ARKit, donc une vraie app.
- **Pas d'occlusion sans LiDAR.** Sur un iPhone non-Pro, l'objet se dessine
  par-dessus le mur qui devrait le cacher.
- **Les modèles sont lourds**, 1,7 à 5,5 Mo, et le USDZ pèse environ le double.
  Comptez quelques secondes entre le tap et la caméra.

## Développement

```sh
python -m http.server 8080   # dans ce dossier
node verifier.mjs            # le banc
node vignettes.mjs           # régénère les vignettes du rayon
URL_PAGE=https://carentre.vercel.app/ node verifier.mjs
```

`verifier.mjs` charge la page dans un Chrome headless et vérifie dix-neuf
points : le chargement, le rayon et ses vignettes, la mesure des modèles, le
calcul d'échelle, la bascule sol/mur, la règle qui décide du bouton AR sur les
trois plateformes, et surtout que le GLB fabriqué à la main est accepté par
model-viewer aux dimensions demandées. L'AR elle-même ne se teste pas ainsi :
elle se juge sur l'appareil.

`vignettes.mjs` rend chaque objet du rayon avec `model-viewer.toBlob()`. Les
captures officielles de Khronos existent, mais elles sont cadrées pour une
fiche technique : rognées en vignette de 96 px, le canapé devient une bande
bleue indéchiffrable.

### model-viewer est figé à 4.1.0

Ce n'est pas de la frilosité. À partir de 4.2.0, écrire `scale` hors session AR
lève une exception dans model-viewer même : `arRenderer.onUpdateScene()` appelle
`presentedScene.add(...)` alors que `presentedScene` est nul. Comme la page
redimensionne à chaque frappe, ça ferait une exception par touche. Versions
passées au banc : 3.5.0, 4.0.0, 4.1.0 saines ; 4.2.0 et 4.3.1 non.

Ne remonte pas la version sans relancer `verifier.mjs`.

## Crédits

Les modèles du rayon sont d'**Eric Chadwick** pour Wayfair et le Darmstadt
Graphics Group, tirés des [glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets)
de Khronos. `SheenChair` et `GlassVaseFlowers` sont en CC0 1.0 ; `GlamVelvetSofa`,
`DiffuseTransmissionPlant` et `IridescenceLamp` en CC BY 4.0.
