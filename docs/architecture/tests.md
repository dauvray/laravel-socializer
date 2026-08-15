# Tests

> **À quoi ça sert :** où vivent les tests, comment les lancer, et la stratégie commune.
> **Quand le lire :** avant d'écrire le premier test d'un module.

---

## Une seule suite, et elle tourne côté hôte

Le package **n'a ni `package.json` ni `node_modules`** : il est développé directement dans
`vendor/` du projet hôte, qui porte tout l'outillage front.

```bash
cd /var/www/estarter-test      # ← la racine du projet HÔTE, pas le package
npm run test:run               # une passe
npm run test                   # mode watch
npm run test:ui                # interface Vitest
npm run test:coverage
```

Configuration : `/var/www/estarter-test/vitest.config.js`. Points à connaître :

- `include` cible **uniquement** le package :
  `vendor/dauvray/laravel-socializer/src/resources/js/**/__tests__/**/*.test.{js,ts}`
- environnement **happy-dom**, `globals: true`, `testTimeout: 10_000`
- alias `~` · `~socializer` · `~estarter` · `~formdesigner` · `~eblogger` — les mêmes que
  `vite.config.js`, et **`peerjs` est redirigé vers le mock** du module WebRTC2
- `setupFiles` pointe sur `components/WebRTC2/__tests__/setup.js` — donc les mocks globaux
  (`mediaDevices`, `RTCPeerConnection`, `crypto`, Pinia fraîche) s'appliquent à **tous** les tests du
  package, pas seulement à WebRTC2
- ⚠️ **pas de `clearMocks`** : les `vi.fn()` globaux de `setup.js` ne sont pas réinitialisés entre les
  tests. Faire ses `mockReset()` en `beforeEach`.

**Aucun test PHP.** Pas de `tests/`, pas de `phpunit.xml`, pas de `require-dev` dans le
`composer.json`. Un chantier backend qui demande des tests doit d'abord poser cette infrastructure.

---

## Le filet automatique

`hooks/pre-push` refuse de pousser une suite rouge. Activation, une fois, dans le dépôt du package :

```bash
cd /var/www/estarter-test/vendor/dauvray/laravel-socializer
git config core.hooksPath hooks
```

Le hook remonte l'arborescence jusqu'au `vitest.config.js` du projet hôte avant de lancer le runner,
et dégrade proprement (push autorisé) si le projet hôte ou `node_modules` est introuvable.
Contournement : `git push --no-verify`.

CI côté hôte : `.github/workflows/webrtc2-tests.yml`.

**Rien ne se pousse en rouge.** La raison est historique : plusieurs régressions ont été introduites
*le jour même* par le correctif précédent, faute de filet automatique entre les deux.

---

## Stratégie : trois étages

C'est le découpage validé sur WebRTC2, et le modèle à reprendre.

| Étage | Rôle |
|---|---|
| **Unitaire** | une couche, dépendances injectées mockées. C'est tout l'intérêt de l'injection descendante : les couches extraites se testent avec des `vi.fn()`. |
| **Conformité** | le mock ne ment ni par omission ni par invention — comparaison **mécanique** de sa surface à celle du vrai store. |
| **Bout en bout** | deux acteurs **réels** qui se parlent, assertés sur le fait métier. |

L'étage bout en bout est celui qui manque toujours et sans lequel les vrais symptômes ne sont pas
observables : ils ne sont vrais ou faux que **vus de l'autre côté**.

### Quatre règles

1. **Un bug vécu s'écrit d'abord en repro, rouge avant le fix.** C'est le seul protocole qui n'a
   jamais produit de régression derrière lui.
2. **Asserter le fait métier, jamais l'implémentation.** Un test vert **d'emblée** est un mauvais
   signe : il ne teste pas ce qu'on croit.
3. **Un mock qui ment est pire qu'un test manquant** — il rend vert pour la mauvaise raison.
4. **Contrôle de harnais** : neutraliser la ligne de production censée porter le correctif et
   vérifier que les tests rougissent. Quand deux mécanismes indépendants tiennent la même propriété,
   il faut les neutraliser tous les deux — et c'est à écrire dans le docblock du test.

⚠️ **Aucun décompte de tests dans `docs/`.** Ce chiffre a divergé du réel dans trois documents à la
fois, tous datés du même jour. Il se relit dans la sortie du runner.

---

## `withSetup` : obligatoire ou interdit

Un composable qui enregistre un hook de lifecycle (`onMounted`, `onUnmounted`, `onBeforeMount`) ou
qui `inject` **doit** être monté par `withSetup`. Un composable qui n'en enregistre aucun s'appelle
**directement** — le passer dans `withSetup` masque le fait qu'il est pur.

C'est un critère de conception autant qu'un détail de test : une couche qui perd ses hooks devient
testable directement, et ça se voit.

---

## Ce qui est couvert aujourd'hui

- **WebRTC2** — les trois étages, ~30 fichiers. Harnais, invariants et pièges de mock :
  [modules/webrtc2/tests.md](../modules/webrtc2/tests.md). Ce qui reste :
  [`work/webrtc2-tests-plan.md`](../../work/webrtc2-tests-plan.md).
- **Chat** — un seul fichier (`dateSeparatorRender.test.js`). Plan en 5 couches, non démarré :
  [`work/chat-tests-plan.md`](../../work/chat-tests-plan.md), avec une décision en attente (helpers
  dédiés vs partagés — `mockEcho`, `mockRoute`, `seedChatStore`).
- **Rien** pour Feed, Comment, Server, User, System, Application, Page, Whiteboard, les stores Pinia
  hors `peers2`, ni les services PHP.

Les invariants d'une doc de module (`docs/modules/*`) sont des **points de test**, pas des choses à
contourner : quand une doc dit « ne pas optimiser ceci », le test correspondant est ce qui l'épingle.
