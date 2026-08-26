/**
 * Pilote la dimension d'un élément redimensionnable via une variable CSS.
 *
 * Pensé pour collaborer avec la directive `resizable_height` : on lui fournit
 * l'objet `resizeOptions` prêt à brancher sur `v-resizable-height`, le callback
 * étant déjà câblé. Sans objet pour `resizable_width`, qui écrit `style.width`
 * en dur et n'a donc pas de variable CSS à piloter.
 *
 * Réutilisable par tout composant qui veut une dimension pilotée par variable
 * CSS avec clamp min/max + mise à jour programmatique (auto-grow, reset, etc.).
 *
 * @param {import('vue').Ref<HTMLElement|null>} elementRef  Ref de template de l'élément cible.
 * @param {Object}  config
 * @param {string}  config.cssVar    Nom de la variable CSS à écrire (ex: '--messenger-height').
 * @param {number}  config.min       Taille minimale (px).
 * @param {number}  config.max       Taille maximale (px).
 * @param {number} [config.initial]  Taille initiale (défaut: min).
 * @param {('top'|'bottom')} [config.position]  Côté de la poignée (transmis à la directive).
 */
import { ref } from 'vue'

export function useResizableElement(elementRef, {
  cssVar = '--resizable-size',
  min = 0,
  max = Infinity,
  initial = min,
  position = 'top',
} = {}) {
  const size = ref(initial)

  // Applique une taille (clampée) à l'élément via la variable CSS.
  // Sert à la fois de callback à la directive et de point d'entrée programmatique.
  function applySize(value) {
    const clamped = Math.min(Math.max(value, min), max)
    size.value = clamped

    const el = elementRef?.value
    if (el instanceof HTMLElement) {
      el.style.setProperty(cssVar, `${clamped}px`)
    }
    return clamped
  }

  function reset() {
    return applySize(initial)
  }

  // Objet à binder directement : v-resizable-height="resizeOptions"
  const resizeOptions = {
    min,
    max,
    position,
    cssVarName: cssVar,
    callback: applySize,
  }

  return { size, applySize, reset, resizeOptions }
}
