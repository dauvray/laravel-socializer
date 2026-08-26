# Serveurs et salons — navigation

> **À quoi ça sert :** comprendre qui décide de la route courante entre `Server.vue`, `Room.vue` et
> la barre latérale des salons, et pourquoi les gardes y sont écrites comme elles le sont.
> **Quand le lire :** avant de toucher à une garde de navigation, au `<router-view>` de `Server.vue`,
> au fil d'Ariane d'un salon, ou dès qu'un clic dans la liste des salons « ne fait rien ».

Le module lui-même (fichiers, presets de salons) est situé dans
[autres-modules.md](autres-modules.md). Ce fichier ne traite que la **navigation**, parce que c'est
là que sont les pièges.

---

## L'arbre de routes, et ce qu'il implique

Trois niveaux imbriqués, déclarés dans `routes/application.js` :

```
server   /app/server/:serverId?          Server.vue
└── room     room/:roomId                Room.vue
    └── <contenu>  chat|wall|page|audio|form|data|admin|whiteboard|classroom|application /:vertexId
```

Un salon **n'affiche jamais rien par lui-même** : il ouvre son contenu par défaut,
`currentRoom.content[0]`, dont le champ `content_type` **est** le nom de la route à pousser. Le
projet hôte peut ajouter des types de salon en injectant des enfants dans la route `room`
(`resources/js/socializer_custom_elements/rooms/config.js` côté hôte) : toute règle écrite ici doit
donc tenir pour des routes que le paquet ne connaît pas.

> ### ⚠️ Le `:key="$route.params.roomId"` du `<router-view>` de `Server.vue` est porteur.
> C'est lui qui **remonte** `Room.vue` à chaque changement de salon, donc ce qui garantit que
> `initRoom()` recharge le salon visé puis ouvre son contenu. Le retirer — il a tout l'air d'une
> optimisation de rendu — casse le changement de salon sans casser l'entrée dans un salon : le
> symptôme apparaît deux clics plus loin que la modification.

---

## Les deux règles de la garde `beforeRouteUpdate` de `Room.vue`

Elles ont chacune été payées par un bug, et aucune des deux ne se devine à la lecture du code.

### 1. On **retourne** la cible, on ne la pousse pas

Un `router.push()` depuis une garde n'ajoute pas une navigation : il **annule celle en vol**.
`pushWithRedirect()` écrit `pendingLocation` avant même son test de doublon, si bien que le
`checkCanceledNavigation` de la navigation d'origine la solde en `NAVIGATION_CANCELLED`. Et
`RouterLink` avale cet échec (`.catch(noop)` dans son `navigate`).

**Le clic ne fait donc rien, et ne laisse aucune trace** : pas d'exception, pas de log, pas de
`console.error`. C'est le mode de panne le plus coûteux du routeur, parce qu'il ressemble à un
problème de CSS ou de z-index. Retourner la cible produit une redirection propre, avec le bon
`redirectedFrom` et une seule entrée d'historique.

### 2. Un salon **différent** passe sans redirection

Tant que la navigation n'est pas confirmée, le store porte encore l'**ancien** salon : `currentRoom`
ne bascule que dans le `initRoom()` du composant remonté. Calculer une cible depuis `currentRoom`
dans la garde, c'est donc renvoyer vers le contenu du salon **qu'on quitte**.

Le symptôme vécu : on entrait bien dans le premier salon, puis plus aucun autre salon n'était
accessible — seul le lien vers l'accueil du serveur répondait encore, parce que sortir du record
`room` ne déclenche pas de garde `beforeRouteUpdate` (le record est *leaving*, pas *updating*). Le
contournement que l'usage finit par trouver — repasser par l'accueil du serveur entre deux salons —
est la signature de ce bug.

La garde ne garde donc **qu'un seul cas** : même salon, URL sans contenu (on reclique le salon déjà
ouvert) ⇒ rouvrir `content[0]`.

Non-régression : `components/Server/__tests__/roomNavigation.test.js`, qui monte le vrai `Room.vue`
sous l'arbre de routes réel — la hiérarchie des `matched` records est ce qui décide de *leaving* vs
*updating*, donc la reconstruire à la main testerait une fiction.

---

## Le fil d'Ariane d'un salon

Le tableau vient de `meta.breadcrumb` de la route ; deux entrées y sont déclarées à `null` et
renseignées à l'exécution :

| `id` | Renseignée par |
|---|---|
| `server_name` | `Server.vue`, dans son `watch(route)` |
| `content` | `Room.vue`, dans son `watch(route)` |

**Les deux écrivent depuis un `watch(route)`, jamais depuis une garde, et c'est obligatoire** : à
chaque navigation confirmée, l'`App.vue` du projet hôte **reconstruit le tableau entier** depuis
`route.meta.breadcrumb`. Le mécanisme complet, l'ordre entre le remplacement et les mises à jour, et
le fait qu'`updateBreadcrumb` ne fait rien sur un `id` inconnu appartiennent au socle, qui **possède
le service** : `innovation/laravel-estarter`, `docs/reference/services-front.md`, section
[`BreadcrumbService`](../../../../innovation/laravel-estarter/docs/reference/services-front.md#breadcrumbservice--qui-écrit-le-fil-dariane-et-quand)
(chemin relatif valable dans un `vendor/` d'installation standard).

> ### Le symptôme qui trahit une écriture faite trop tôt
> « Il faut cliquer deux fois pour que le nom apparaisse dans le fil d'Ariane. » Le second clic ne
> navigue pas — il est annulé par la règle 1 ci-dessus — donc plus rien ne vient écraser ce que la
> garde a écrit. Le fil d'Ariane semble se réparer alors que la navigation, elle, vient d'échouer.
> Deux bugs qui se déguisent l'un en correctif de l'autre.

⚠️ Les routes `data`/`viewer` et `questionnaire-manager` déclarent un `meta.breadcrumb` **sans `id`**
sur leurs entrées. Aucun composant ne peut donc y renseigner quoi que ce soit : `updateBreadcrumb`
n'ajoute rien et ne signale rien. C'est un défaut de déclaration, pas de composant.

---

## Ce qui reste ouvert

La navigation multi-pages d'un salon est en attente : le `<Teleport>` de `Room.vue` qui listait les
contenus d'un salon dans la barre latérale est commenté, et `getCurrentRoomContent` (qui saute
`content[0]`) n'a plus de consommateur. Le `TODO` du template dit la même chose.
