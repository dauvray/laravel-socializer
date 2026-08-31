/**
 * fakeFullscreen.js — le plein écran et le Picture-in-Picture, que happy-dom n'a pas
 *
 * ⚠️ Mesuré sur happy-dom 20.0.10 : `fullscreenElement`, `exitFullscreen`,
 * `pictureInPictureElement` et `exitPictureInPicture` sont **absents de `document`** au sens
 * `in` — et `requestFullscreen` / `requestPictureInPicture` n'existent pas sur les éléments.
 * Sans fabrication, `useMediaControls` ne peut être exercé sur aucun de ses deux chemins :
 * la lecture de `document.fullscreenElement` rend `undefined`, et l'appel lève.
 *
 * Ce que ce fichier NE fabrique pas, et c'est volontaire : `fullscreenEnabled`,
 * `pictureInPictureEnabled`, `onfullscreenchange`, `disablePictureInPicture`. La production
 * n'en lit aucun. Fabriquer un membre que personne ne lit, c'est inventer un DOM.
 *
 * ── L'invariant qui empêche ce double de mentir ──────────────────────────────────────────
 *
 * Un seul **emplacement** par fonctionnalité, détenu par la scène, et `document.*Element`
 * installés en **accesseurs** qui le lisent. Il n'y a donc pas deux vérités à synchroniser :
 * un faux `requestFullscreen` qui « oublierait » de mettre à jour ce que le code lit est
 * structurellement impossible. C'est le mode de panne à éviter ici — un DOM où un élément
 * serait en plein écran sans que `document.fullscreenElement` le dise n'existe pas.
 *
 * Trois fidélités qui en découlent, toutes reprises de la spec :
 *
 * 1. **Remplacement, pas empilement.** Demander le PiP sur B pendant que A y est déplace
 *    l'emplacement vers B (le navigateur sort A implicitement). Idem plein écran.
 * 2. **Les `exit*` sont des méthodes de `document`** : elles vident l'emplacement quel que
 *    soit l'appelant, et **rejettent sur un emplacement vide**. Ce dernier point est
 *    aujourd'hui inatteignable depuis la production — c'est un fil-piège pour un futur
 *    refactor qui inverserait l'ordre des branches, pas une invention.
 * 3. **`requestPictureInPicture` n'existe que sur un `<video>`**, `requestFullscreen` sur
 *    n'importe quel élément. Corollaire de harnais : équiper AUSSI le cadre quand un cas
 *    doit prouver *quel* élément est retenu, sinon c'est l'absence d'une méthode sur le
 *    concurrent qui décide, et non le code testé.
 *
 * Un refus (`refuseNext`) laisse l'emplacement **intact** et rejette une vraie
 * `DOMException` nommée, comme un navigateur qui refuse hors geste utilisateur.
 *
 * ⚠️ `installPresentationApis()` **lève** si une scène est déjà installée : une scène qui
 * fuit d'un test à l'autre est un mock qui mente à retardement. `restore()` fait un `delete`
 * (et non « remettre à `undefined` ») : les membres redeviennent absents, ce qui est l'état
 * dont dépendent les tests qui vérifient une dégradation.
 *
 * ⚠️ Ne PAS installer ça dans `setup.js`. Le motif `if (!globalThis.X)` y sert ce dont tous
 * les tests ont besoin ; poser le plein écran globalement détruirait la référence « absent
 * par défaut ».
 */

const FEATURES = {
    fullscreen: {
        holder: 'fullscreenElement',
        exit: 'exitFullscreen',
        request: 'requestFullscreen',
        videoOnly: false,
        emptyExit: () => new TypeError('Document not active'),
    },
    pip: {
        holder: 'pictureInPictureElement',
        exit: 'exitPictureInPicture',
        request: 'requestPictureInPicture',
        videoOnly: true,
        emptyExit: () => new DOMException('There is no Picture-in-Picture element', 'InvalidStateError'),
    },
}

let installed = false

/**
 * Installe le plein écran et le PiP sur `document`, et rend la scène qui les pilote.
 *
 * @returns {{
 *   equip: (el: Element) => Element,
 *   refuseNext: (feature: 'fullscreen'|'pip', name?: string) => void,
 *   restore: () => void,
 * }}
 */
export function installPresentationApis() {
    if (installed) {
        throw new Error(
            'installPresentationApis() : une scène est déjà installée. Appeler restore() en afterEach.',
        )
    }
    installed = true

    /** L'emplacement unique, par fonctionnalité : la seule vérité de la scène. */
    const holders = { fullscreen: null, pip: null }
    /** Refus armés, consommés au premier appel. */
    const refusals = { fullscreen: null, pip: null }
    const equipped = []

    const consumeRefusal = (feature) => {
        const refusal = refusals[feature]
        refusals[feature] = null
        return refusal
    }

    for (const [feature, spec] of Object.entries(FEATURES)) {
        Object.defineProperty(document, spec.holder, {
            get: () => holders[feature],
            configurable: true,
        })
        Object.defineProperty(document, spec.exit, {
            value: async () => {
                if (!holders[feature]) throw spec.emptyExit()
                holders[feature] = null
            },
            writable: true,
            configurable: true,
        })
    }

    return {
        /**
         * Donne à un élément les méthodes de demande que le navigateur lui donnerait.
         * Un élément non attaché au document est refusé : un vrai `requestFullscreen`
         * rejette dans ce cas, et fabriquer un scénario que le navigateur refuse ferait
         * passer le test pour la mauvaise raison.
         */
        equip(el) {
            if (!el?.isConnected) {
                throw new Error(
                    'equip() : élément non attaché au document. Attacher au body avant d\'équiper.',
                )
            }

            for (const [feature, spec] of Object.entries(FEATURES)) {
                if (spec.videoOnly && el.tagName !== 'VIDEO') continue

                el[spec.request] = async () => {
                    const refusal = consumeRefusal(feature)
                    if (refusal) throw refusal
                    holders[feature] = el // remplacement, jamais empilement
                }
            }

            equipped.push(el)
            return el
        },

        /** Arme un refus à usage unique sur la prochaine demande de cette fonctionnalité. */
        refuseNext(feature, name = 'NotAllowedError') {
            if (!FEATURES[feature]) throw new Error(`refuseNext() : fonctionnalité inconnue « ${feature} »`)
            refusals[feature] = new DOMException(`refus simulé (${feature})`, name)
        },

        /** Rend au DOM son état d'origine : les membres redeviennent ABSENTS. */
        restore() {
            for (const spec of Object.values(FEATURES)) {
                delete document[spec.holder]
                delete document[spec.exit]
            }
            for (const el of equipped) {
                for (const spec of Object.values(FEATURES)) delete el[spec.request]
            }
            equipped.length = 0
            installed = false
        },
    }
}
