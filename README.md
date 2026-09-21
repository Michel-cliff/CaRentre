# Ça rentre ?

Pose un meuble en 3D dans ta pièce, à sa taille réelle, depuis ton iPhone.
Une page. Aucun build, aucun serveur, aucun compte.

## Le principe

Safari iOS ne supporte pas WebXR : aucune page web ne peut ouvrir une vue AR
sur iPhone. La seule route est **AR Quick Look**, le visualiseur natif d'iOS.
On lui sert un fichier USDZ et il fait le reste — détection du sol, tap pour
poser, glisser pour déplacer, deux doigts pour pivoter, et l'ancrage qui tient
quand la caméra regarde ailleurs.

Le USDZ est fabriqué **dans le navigateur** par `model-viewer`, à partir du GLB
chargé. Pas de conversion côté serveur, donc pas de serveur.

## Le champ « largeur réelle »

C'est la seule vraie idée de l'outil. Un GLB trouvé sur le web ment une fois
sur deux sur ses dimensions : le glTF est censé être en mètres, beaucoup
d'exports sont en centimètres, et le canapé arrive 100× trop grand. Le champ
rattrape ça en une frappe, et le facteur est inscrit dans le `xformOp:transform`
du USDZ — Quick Look pose donc le meuble à sa taille métrique corrigée.

La taille est verrouillée en AR (`ar-scale="fixed"`). Un meuble a une taille
réelle ; pouvoir la changer du bout des doigts viderait l'outil de son sens.

## Limites, honnêtement

- **Un meuble à la fois.** Quick Look n'affiche qu'un objet. Pour meubler une
  pièce entière, il faut y aller morceau par morceau.
- **Rien n'est sauvegardé.** Aucune disposition n'est mémorisée d'une session
  à l'autre — ça demanderait ARKit et donc une vraie app.
- **Pas d'occlusion sans LiDAR.** Sur un iPhone non-Pro, le meuble se dessine
  par-dessus le mur qui devrait le cacher.

## Développement

```sh
python -m http.server 8080   # dans ce dossier
node verifier.mjs            # le banc
```

`verifier.mjs` charge la page dans un Chrome headless et vérifie le chargement
du modèle, sa mesure, et le calcul d'échelle. L'AR elle-même ne se teste pas
ainsi : elle se juge sur l'iPhone.

### model-viewer est figé à 4.1.0

Ce n'est pas de la frilosité. À partir de 4.2.0, écrire `scale` hors session AR
lève une exception dans model-viewer même : `arRenderer.onUpdateScene()` appelle
`presentedScene.add(...)` alors que `presentedScene` est nul. Comme la page
redimensionne à chaque frappe, ça ferait une exception par touche. Versions
passées au banc : 3.5.0, 4.0.0, 4.1.0 saines ; 4.2.0 et 4.3.1 non.

Ne remonte pas la version sans relancer `verifier.mjs`.

## Crédits

La chaise d'exemple est [Sheen Chair](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SheenChair)
des glTF Sample Assets de Khronos, en CC0-1.0.
