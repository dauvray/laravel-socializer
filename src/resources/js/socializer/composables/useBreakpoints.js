/**
 * 
  Par défaut, observe la largeur de l’écran (window.innerWidth).
  Si on lui passe un HTMLElement (le conteneur parent), observe sa largeur (element.clientWidth) à la place.
 */
import { ref, onMounted, onBeforeUnmount, computed, watch, reactive } from 'vue'

export function useBreakpoints(elementRef = null) {
  const width = ref(0)
  const breakpoints = {
    xs: 0,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
    xxl: 1400
  }

  let resizeObserver = null
  let currentElement = null

  const updateWidth = () => {
    if (currentElement instanceof HTMLElement) {
      width.value = currentElement.clientWidth
    } else {
      width.value = window.innerWidth
    }
  }

  const observeElement = (el) => {
    if (!el) return
    unobserveElement()
    resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(el)
    currentElement = el
    updateWidth()
  }

  const unobserveElement = () => {
    if (resizeObserver && currentElement) {
      resizeObserver.unobserve(currentElement)
      resizeObserver.disconnect()
      resizeObserver = null
      currentElement = null
    }
  }

  onMounted(() => {
    if (elementRef && typeof elementRef === 'object') {
      watch(
        () => elementRef.value,
        (newEl, oldEl) => {
          if (newEl instanceof HTMLElement) {
            observeElement(newEl)
          } else {
            unobserveElement()
            window.addEventListener('resize', updateWidth)
            updateWidth()
          }
        },
        { immediate: true, flush: 'post' } // pour capter dès que ref devient dispo
      )
    } else {
      window.addEventListener('resize', updateWidth)
      updateWidth()
    }
  })

  onBeforeUnmount(() => {
    if (resizeObserver) {
      unobserveElement()
    } else {
      window.removeEventListener('resize', updateWidth)
    }
  })

  return {
    width,

    isXs: computed(() => width.value < breakpoints.sm),
    isSm: computed(() => width.value >= breakpoints.sm && width.value < breakpoints.md),
    isMd: computed(() => width.value >= breakpoints.md && width.value < breakpoints.lg),
    isLg: computed(() => width.value >= breakpoints.lg && width.value < breakpoints.xl),
    isXl: computed(() => width.value >= breakpoints.xl && width.value < breakpoints.xxl),
    isXxl: computed(() => width.value >= breakpoints.xxl),

    up: reactive({
      sm: computed(() => width.value >= breakpoints.sm),
      md: computed(() => width.value >= breakpoints.md),
      lg: computed(() => width.value >= breakpoints.lg),
      xl: computed(() => width.value >= breakpoints.xl),
      xxl: computed(() => width.value >= breakpoints.xxl),
    }),

    down: reactive({
      sm: computed(() => width.value < breakpoints.sm),
      md: computed(() => width.value < breakpoints.md),
      lg: computed(() => width.value < breakpoints.lg),
      xl: computed(() => width.value < breakpoints.xl),
      xxl: computed(() => width.value < breakpoints.xxl),
    })
  }
}
