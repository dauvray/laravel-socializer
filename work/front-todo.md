# TODO — Front transverse (hors module)

> **Chantier ouvert, non démarré.** Petits items de lisibilité qui ne relèvent d'aucun module.
> Les faits durables correspondants sont déjà dans `docs/` — ce fichier ne porte que ce qui reste
> à faire.

## Nommage des directives de resize

Le suffixe décrit l'**orientation de la poignée**, pas l'axe redimensionné : `resizable_horizontal`
(poignée horizontale, `ns-resize`) redimensionne la **hauteur**, `resizable_vertical` (poignée
verticale, `ew-resize`) redimensionne la **largeur**. Contre-intuitif au point d'avoir fait conclure
à tort à un bug d'import dans `ChatComponent.vue` (27/05/2026) — il n'y en avait pas.

Le fait est consigné dans
[`docs/modules/chat.md`](../docs/modules/chat.md#composables-en-place-carte-rapide) ; reste à lever
l'ambiguïté à la source.

- [ ] Renommer `resizable_horizontal.js` → `resizable_height.js` et `resizable_vertical.js` →
      `resizable_width.js` dans `src/resources/js/socializer/directives/`.
      Impacte les imports de `ChatComponent.vue` (le messenger, via `--messenger-height`) et de
      `Server.vue` (la sidebar, via `el.style.width`).
- [ ] Alternative plus légère si le renommage est jugé trop invasif : un commentaire d'en-tête
      « poignée horizontale ⇒ resize vertical » dans chacun des deux fichiers.
