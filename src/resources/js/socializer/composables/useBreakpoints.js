import { ref, onMounted, onBeforeUnmount, computed } from 'vue'

export function useBreakpoints() {
  const width = ref(window.innerWidth)

  const updateWidth = () => {
    width.value = window.innerWidth
  }

  onMounted(() => {
    window.addEventListener('resize', updateWidth)
    updateWidth()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', updateWidth)
  })

  // Bootstrap breakpoints (https://getbootstrap.com/docs/5.3/layout/breakpoints/)
  const breakpoints = {
    xs: 0,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
    xxl: 1400
  }

  return {
    width,

    // Exact match
    isXs: computed(() => width.value < breakpoints.sm),
    isSm: computed(() => width.value >= breakpoints.sm && width.value < breakpoints.md),
    isMd: computed(() => width.value >= breakpoints.md && width.value < breakpoints.lg),
    isLg: computed(() => width.value >= breakpoints.lg && width.value < breakpoints.xl),
    isXl: computed(() => width.value >= breakpoints.xl && width.value < breakpoints.xxl),
    isXxl: computed(() => width.value >= breakpoints.xxl),

    // Minimum width (e.g., like Bootstrap's `d-lg-*`)
    up: {
      sm: computed(() => width.value >= breakpoints.sm),
      md: computed(() => width.value >= breakpoints.md),
      lg: computed(() => width.value >= breakpoints.lg),
      xl: computed(() => width.value >= breakpoints.xl),
      xxl: computed(() => width.value >= breakpoints.xxl),
    },

    // Maximum width (opposite)
    down: {
      sm: computed(() => width.value < breakpoints.sm),
      md: computed(() => width.value < breakpoints.md),
      lg: computed(() => width.value < breakpoints.lg),
      xl: computed(() => width.value < breakpoints.xl),
      xxl: computed(() => width.value < breakpoints.xxl),
    }
  }
}
