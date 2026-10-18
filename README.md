# Château de sable (WebGPU)

Ce projet est un jeu bac à sable en vue isométrique : un diorama de plage, avec un lagon, des dunes, des rochers et un ponton. On y construit des châteaux de sable avec une pelle, des moules et une truelle, et on décore la scène, pendant que la marée et les vagues font leur œuvre. Tout est calculé sur le GPU en WebGPU : compute shaders en WGSL, sans moteur 3D.

## Lancer

```bash
npm install
npm run dev        # puis ouvrir l'URL affichée dans Chrome, Edge ou Safari (macOS 26+)
```

Le paramètre d'URL `?grid=256|384|512|768` fixe la résolution de la simulation. La valeur par défaut est 512, soit des cellules de 3,1 cm sur un plateau de 16 m × 16 m.

## Outils

| Touche | Outil | Clic | Maj + clic | Alt + clic |
| --- | --- | --- | --- | --- |
| `1` | Pelle | creuser (une fois pleine, la pelle rejette les déblais autour du trou) | vider | tasser |
| `2` | Seau | remplir (sable, ou eau en visant la mer) | retourner (tour) ou verser l'eau | — |
| `3` | Seau crénelé | remplir | retourner : tour à créneaux | — |
| `4` | Moule à muraille | remplir | retourner : rempart crénelé (`F` pour tourner) | — |
| `5` | Truelle | sculpter finement | lisser | aplanir à la hauteur visée (terrasses, escaliers) |
| `6` | Décor | poser l'objet choisi | retirer l'objet le plus proche | — |

Les objets de décor se choisissent dans la palette du panneau ou avec `C` (objet suivant) : drapeaux de quatre couleurs, coquillages, étoiles de mer, rochers, coraux, algues, oyats, buissons, bouteille et bouée. Ils suivent le relief du sable, et la bouteille comme la bouée flottent sur l'eau.

Un clic bref, ou un tap sur le trackpad, fait un geste complet : une pelletée, un seau rempli ou un coup de truelle. Les outils sont sonorisés (WebAudio, sons générés) et projettent du sable.

## Caméra et autres commandes

- Clic droit ou clic milieu glissé pour se déplacer, molette pour le zoom.
- `Q`/`E` (`A`/`E` en AZERTY) font pivoter la vue par quarts de tour, `ZQSD`/`WASD` déplacent la caméra.
- Marée : `T` met en pause, `+`/`-` changent la vitesse.
- `R` réinitialise et `H` affiche ou masque l'aide.

## Physique

- **Eau** : modèle d'eau peu profonde à « tuyaux virtuels ». La conductance dépend de la profondeur, si bien que les vagues avancent à √(g·h), ralentissent et se raidissent à l'approche du rivage. Une zone de génération et d'absorption de houle borde le large. La marée est sinusoïdale.
- **Sable** : une colonne par cellule, décrite par le socle, l'épaisseur de sable, l'humidité et la compaction. Le sable s'éboule au-delà de l'angle de repos, qui dépend de l'humidité et du tassement :
  - sec : environ 34° ;
  - humide : jusqu'à 85° s'il est tassé, grâce aux ponts capillaires ;
  - saturé : environ 17°, car le sable se liquéfie.
- **Couplage sable–eau** :
  - érosion et dépôt selon la capacité de transport ;
  - sédiment transporté de façon conservative par les flux d'eau ;
  - humidité gérée par la nappe, la capillarité, le drainage, l'évaporation et l'infiltration ;
  - suintement : un trou creusé sous le niveau de la nappe se remplit d'eau.
- **Outils** : un seul workgroup par action. Le volume échangé entre le terrain et l'outil (pelle, moules, truelle) est donc conservé exactement. Les moules déposent un corps tassé, surmonté de créneaux pour les moules crénelés, qui ne tient que si le sable est assez humide.

## Rendu

Le rendu est stylisé, façon diorama :
- le plateau est découpé, avec ses tranches de sable, de socle et d'eau, et projette son ombre sur un fond gris ;
- le sable est crème, moucheté de galets ;
- l'eau du lagon est turquoise et vire au bleu profond dans les fosses, avec des caustiques sur le fond, des lignes de lumière en surface et de l'écume au rivage ;
- le décor est low-poly et animé : les herbes, les algues et les drapeaux bougent au vent et au courant ;
- en post-traitement, des ombres douces, un bloom, un tonemapping ACES et un FXAA.

Pour le diagnostic, taper `window.waterDebug = N` dans la console isole un élément du rendu : 1 à 7 pour l'eau, 8 à 10 pour le sable.
