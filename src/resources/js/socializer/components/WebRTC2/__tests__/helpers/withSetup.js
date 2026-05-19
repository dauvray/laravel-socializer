/**
 * withSetup.js — Exécute un composable dans un vrai contexte Vue
 *
 * Les composables qui utilisent inject(), onBeforeMount(), onUnmounted(),
 * watch(), etc. doivent être appelés depuis le setup() d'un composant.
 * Ce helper crée un composant minimal pour satisfaire cette contrainte.
 *
 * Usage :
 *   const [result, app] = withSetup(() => useMyComposable(ctx), {
 *       provides: { eventBus: mockEventBus() }
 *   })
 *   // ... assertions ...
 *   app.unmount()
 *
 * @param {Function} composable  La fonction composable à exécuter
 * @param {Object}   options
 * @param {Object}   [options.provides]  Valeurs à injecter via app.provide()
 * @param {Array}    [options.plugins]   Plugins Vue (ex: pinia instance)
 * @returns {[any, import('vue').App]}   [résultat du composable, instance app]
 */
import { createApp, defineComponent, h } from 'vue'

export function withSetup(composable, { provides = {}, plugins = [] } = {}) {
    let result

    const TestComponent = defineComponent({
        setup() {
            result = composable()
            // setup() doit retourner quelque chose pour éviter le warning Vue
            return {}
        },
        render() {
            return h('div')
        },
    })

    const app = createApp(TestComponent)

    plugins.forEach((plugin) => app.use(plugin))

    Object.entries(provides).forEach(([key, value]) => {
        app.provide(key, value)
    })

    app.mount(document.createElement('div'))

    return [result, app]
}
