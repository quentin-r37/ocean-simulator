# Château de sable (WebGPU)

Ce projet est un jeu bac à sable en vue isométrique : un diorama de plage, avec un lagon, des dunes, des rochers et un ponton. On y construit des châteaux de sable avec une pelle, des moules et une truelle, et on décore la scène, pendant que la marée et les vagues font leur œuvre. Tout est calculé sur le GPU en WebGPU : compute shaders en WGSL, sans moteur 3D.

## Lancer

```bash
npm install
npm run dev        # puis ouvrir l'URL affichée dans Chrome, Edge ou Safari (macOS 26+)
```

Le paramètre d'URL `?grid=256|384|512|768` fixe la résolution de la simulation. La valeur par défaut est 512, soit des cellules de 3,1 cm sur un plateau de 16 m × 16 m.

L'interface existe en français et en anglais. La langue suit celle du navigateur ; le bouton en haut du panneau (ou « Langue » dans les réglages) la change à la volée, et le choix est mémorisé. `?lang=fr` ou `?lang=en` force une langue.

## Plages et ambiances

- **Plage aléatoire** : `N`, ou le bouton du panneau « Plage et ambiance », génère une nouvelle plage à partir d'une graine. Selon la graine, on obtient une baie ou un cap, des dunes plus ou moins hautes, un lagon relié ou non à la mer, des mares, une barre de sable au large, des amas de rochers et parfois un ponton. La graine s'affiche dans le panneau et dans l'URL (`?seed=1234`), pour retrouver une plage ; `0` ramène la plage d'origine.
- **Ambiances** : `B` passe à la suivante, ou on la choisit dans la liste. Au choix : Après-midi, Matin, Midi, Soir, Ciel couvert, Tempête, Mer d'huile, Grande marée. Chaque ambiance règle le soleil, les nuages, le vent, la houle, la marée et le séchage, avec une transition de quelques secondes.

## Outils

| Touche | Outil | Clic | Maj + clic | Alt + clic |
| --- | --- | --- | --- | --- |
| `1` | Pelle | creuser d'un niveau : fond plat, jusqu'à une profondeur fixée au début du clic (en traînant, on trace un fossé de niveau) ; une fois pleine, la pelle jette les déblais derrière le trou | vider | tasser |
| `2` | Seau | remplir (sable, ou eau en visant la mer) | retourner (tour) ou verser l'eau | — |
| `3` | Seau crénelé | remplir | retourner : tour à créneaux | — |
| `4` | Moule à muraille | remplir | retourner : rempart crénelé (`F` pour tourner) | — |
| `5` | Truelle | sculpter finement | lisser | aplanir à la hauteur visée (terrasses, escaliers) |
| `6` | Décor | poser l'objet choisi | retirer l'objet le plus proche | — |
| `7` | Seau géant | ramasser jusqu'à 4 m³ de sable (ou d'eau) sur une large zone | retourner : énorme tour, ou verser l'eau | — |

Les objets de décor se choisissent dans la palette du panneau ou avec `C` (objet suivant) : drapeaux de quatre couleurs, coquillages, étoiles de mer, rochers, coraux, algues, oyats, buissons, bouteille et bouée. Ils suivent le relief du sable, et la bouteille comme la bouée flottent sur l'eau.

Un clic bref, ou un tap sur le trackpad, fait un geste complet : une pelletée, un seau rempli ou un coup de truelle. Les outils sont sonorisés (WebAudio, sons générés) et projettent du sable.

## Caméra et autres commandes

- Clic droit ou clic milieu glissé pour se déplacer, molette pour le zoom.
- `Q`/`E` (`A`/`E` en AZERTY) font pivoter la vue par quarts de tour, `ZQSD`/`WASD` déplacent la caméra.
- Marée : `T` met en pause, `+`/`-` changent la vitesse.
- `R` réinitialise et `H` affiche ou masque l'aide.
- `N` génère une plage aléatoire, `B` change d'ambiance.
- `Y`, ou le bouton 🌊 du panneau, envoie un tsunami : une longue onde solitaire arrive du large et submerge la plage. Sa hauteur se règle dans « Houle ».

## Manette (PlayStation / Xbox)

Une manette branchée est reconnue dès qu'on appuie sur un bouton. Tant qu'on s'en sert, on vise le centre de l'écran ; bouger la souris rend la main à la souris.

| Commande | Action |
| --- | --- |
| `L1` / `R1` (`LB` / `RB`) | outil précédent / suivant |
| `L2` (`LT`) | enlever : creuser, remplir le seau, sculpter, retirer un décor (= clic, ou Maj + clic en décor) |
| `R2` (`RT`) | poser : vider la pelle, retourner le seau ou verser l'eau, lisser, poser un décor (= Maj + clic, ou clic en décor) |
| `□` (`X`) maintenu | tasser (pelle), aplanir (truelle), comme `Alt` |
| `△` (`Y`) | tourner le moule à muraille |
| stick gauche | déplacer la caméra |
| stick droit | gauche / droite : pivoter d'un quart de tour ; haut / bas : zoom |
| croix ◀ / ▶ | objet de décor précédent / suivant |
| croix ▲ / ▼ | vitesse de la marée |
| `○` (`B`) | pause de la marée |
| `Create` (`View`) | ambiance suivante |
| `Options` (`Menu`) | aide |

## Physique

- **Eau** : modèle d'eau peu profonde à « tuyaux virtuels ». La conductance dépend de la profondeur, si bien que les vagues avancent à √(g·h), ralentissent et se raidissent à l'approche du rivage. Une zone de génération et d'absorption de houle borde le large. La marée est sinusoïdale.
- **Sable** : une colonne par cellule, décrite par le socle, l'épaisseur de sable, l'humidité et la compaction. Le sable s'éboule au-delà de l'angle de repos, qui dépend de l'humidité et du tassement :
  - sec : environ 34° ;
  - humide : jusqu'à 85° s'il est tassé, grâce aux ponts capillaires, et la cohésion lui permet en plus de tenir une paroi verticale (jusqu'à 1,2 m une fois bien tassé) : les tours démoulées restent droites tant qu'elles ne sèchent pas ;
  - saturé : environ 17°, car le sable se liquéfie.
- **Couplage sable–eau** :
  - érosion et dépôt selon la capacité de transport ;
  - sédiment transporté de façon conservative par les flux d'eau ;
  - humidité gérée par la nappe, la capillarité, le drainage, l'évaporation et l'infiltration ;
  - suintement : un trou creusé sous le niveau de la nappe se remplit d'eau ;
  - sape par les vagues : l'eau qui bat le pied d'un château (ou d'une falaise de dune) le détrempe et le détasse, non seulement en façade mais jusqu'à une trentaine de centimètres à l'intérieur. Le château s'affaisse donc par pans et perd de la hauteur, au lieu d'être grignoté sur le bord. Le sable qui s'éboule dans l'eau est détrempé et s'étale.
- **Élancement** : le sable tassé ne tient une paroi raide que s'il fait partie d'un massif. Une aiguille isolée ou un angle trop fin s'effrite, alors que les murs, les tours et les créneaux tiennent.
- **Outils** : un seul workgroup par action. Le volume échangé entre le terrain et l'outil (pelle, moules, truelle) est donc conservé exactement. Les moules déposent un corps tassé, surmonté de créneaux pour les moules crénelés, qui ne tient que si le sable est assez humide.

## Rendu

Le rendu est stylisé, façon diorama :
- le plateau est découpé, avec ses tranches de sable, de socle et d'eau, et projette son ombre sur un fond gris ;
- le sable est crème, moucheté de galets ;
- l'eau est turquoise sur les hauts-fonds et vire au bleu profond au large et dans les fosses, avec des caustiques discrets sur le fond peu profond ;
- l'écume naît là où les vagues déferlent (nombre de Froude élevé en eau peu profonde) et suit le jet de rive, à chaque vague ;
- le décor est low-poly et animé : les herbes, les algues et les drapeaux bougent au vent et au courant ;
- en post-traitement, des ombres douces, un bloom, un tonemapping ACES et un FXAA.

Pour le diagnostic, taper `window.waterDebug = N` dans la console isole un élément du rendu : 1 à 7 pour l'eau, 8 à 10 pour le sable.
