/**
 * noInlinedTurnSecret.test.js — Aucun secret TURN ne doit revenir dans le bundle
 *
 * `import.meta.env.VITE_*` n'est pas une variable d'environnement : **Vite remplace l'expression
 * par sa valeur en texte au moment du build**. Une clé lue ainsi finit donc en clair dans
 * `public/build/assets/js/*.js`, servi à tout visiteur. C'est ce qui est arrivé aux identifiants
 * du conteneur coturn — le credential était présent DEUX fois dans le bundle, parce que deux
 * fichiers le lisaient (`WebRTC2/Composables/usePeerTransport.js`, vivant, et
 * `stores/peers/actions.js`, mort mais compilé quand même : Vite ne se soucie pas de savoir si le
 * code est atteignable).
 *
 * Ce test est un balai, pas une vérification de comportement. Il existe parce que la panne est
 * INVISIBLE : rien dans la suite, rien dans l'application, rien dans un `git diff` ne signale
 * qu'un `import.meta.env.VITE_COTURN_USERNAME` réintroduit publie un mot de passe. Seul un grep
 * sur le bundle construit le montrerait, et personne ne le fait.
 *
 * La configuration ICE se récupère désormais auprès du serveur —
 * `Composables/utils/fetchIceServers.js` → `GET /get-ice-servers` → `WebRTCController`.
 *
 * ── Périmètre : exactement ce que Vite compile ────────────────────────────────────────────────
 *
 * Les fichiers de test et les doublures sont EXCLUS, et ce n'est pas une commodité : ils ne sont
 * pas bundlés, donc un identifiant fictif dans une fixture ne fuit nulle part. Les commentaires
 * sont retirés avant analyse pour la même raison — `import.meta.env.VITE_X` cité dans un docblock
 * (celui-ci compris) n'est pas une expression que Vite substitue.
 */
import { describe, it, expect } from 'vitest'

/**
 * Toutes les sources du paquet. Le glob est relatif à CE fichier :
 * `components/WebRTC2/__tests__/` → trois niveaux au-dessus = `src/resources/js/socializer/`.
 */
const TOUTES_LES_SOURCES = import.meta.glob(
    ['../../../**/*.js', '../../../**/*.vue'],
    { query: '?raw', import: 'default', eager: true },
)

/**
 * Le glob résout les chemins RELATIVEMENT à ce fichier : tout ce qui vit sous
 * `components/WebRTC2/__tests__/` en ressort donc préfixé `./` (et non `__tests__/…`, qui
 * n'apparaît jamais dans la chaîne). C'est ce préfixe qui identifie le non-bundlé ; les deux
 * autres motifs sont une ceinture pour le jour où ce fichier sera déplacé.
 */
const estBundlé = (chemin) => !/^\.\/|__mocks__|\.test\.js$/.test(chemin)

/** Retire commentaires de bloc et de ligne — approximation suffisante ici, cf. en-tête. */
const sansCommentaires = (source) => String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const SOURCES = Object.entries(TOUTES_LES_SOURCES)
    .filter(([chemin]) => estBundlé(chemin))
    .map(([chemin, source]) => [chemin, sansCommentaires(source)])

describe('aucun secret TURN inliné dans le bundle', () => {
    it('le balai capture bien les sources bundlées (contrôle d\'inertie)', () => {
        // Sans ce contrôle, un glob cassé ou un filtre trop large rendrait les tests ci-dessous
        // verts en ne regardant rien — exactement le mode de panne que ce fichier ferme.
        expect(SOURCES.length).toBeGreaterThan(50)
    })

    it('le balai voit encore le code, pas seulement des coquilles vides (contrôle d\'inertie)', () => {
        // Le retrait des commentaires ne doit pas avoir tout emporté.
        const avecDuCode = SOURCES.filter(([, source]) => /import\s|export\s/.test(source))
        expect(avecDuCode.length).toBeGreaterThan(50)
    })

    it('aucune source bundlée ne lit un identifiant TURN depuis import.meta.env', () => {
        const coupables = SOURCES
            .filter(([, source]) => /VITE_COTURN/.test(source))
            .map(([chemin]) => chemin)

        expect(coupables).toEqual([])
    })

    it('aucune source bundlée ne porte de credential TURN en dur', () => {
        // Le second visage de la même erreur : recopier la valeur au lieu de lire l'env.
        const coupables = SOURCES
            .filter(([, source]) => /credential\s*:\s*['"`][^'"`$)\]]/.test(source))
            .map(([chemin]) => chemin)

        expect(coupables).toEqual([])
    })
})
