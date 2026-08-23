# Projection MySQL → NebulaGraph

**MySQL est la source de vérité, le graphe en est un réplica.** Ce document dit qui écrit ce
réplica, quel invariant il respecte, et pourquoi rejouer une projection est sans danger.

À lire avec [package.md](package.md#tri-persistance) pour la tri-persistance, et
[tests.md](tests.md) pour le harnais qui épingle tout ça.

---

## L'invariant

> **Un utilisateur = un sommet `user`, un sommet `feed`, un sommet `wall`.**
> **Un groupe = un sommet `group`, un serveur, une page.**
> Quel que soit le nombre de projections.

Le mur porte une arête `followed_by` vers son propre propriétaire — **c'est voulu** : la
distribution d'un post remonte les `followed_by` (`getFeedFollowers`), sans cette arête l'auteur ne
verrait pas ses propres publications. Conséquence assumée : le `COUNT(nbf)` de `Services\Users`
compte le propriétaire, et le front l'ôte (`ThumbnailWidget.vue`, `Cover.vue`). Un mur en trop
décale donc ce compteur — c'est le symptôme visible, pas le vrai risque, qui est
`Socializable::wall()` : il rend `$wall[0]` **sans `ORDER BY`**, donc sur deux murs un follow, une
publication et sa distribution peuvent atterrir sur des sommets différents du même utilisateur.

## Comment l'invariant tient

`createUserAndNetwork()` (`app/Helpers/Socializer.php`) et `Server::createGroupServer()` sont
**idempotentes**, par deux verrous dont aucun ne suffit seul :

| Verrou | Ce qu'il couvre | Ce qu'il ne couvre pas |
|---|---|---|
| **relecture** de ce qui est déjà projeté | les sommets nés sous `uniqidReal()`, dont l'id n'est pas reconstituable | deux appels concurrents qui ont tous deux lu « pas de mur » |
| **id dérivé** du modèle (`feed12`, `wall12`, `server12`) + `INSERT VERTEX IF NOT EXISTS` | la concurrence, au niveau de la base ; et la **panne de relecture**, qui conclut « rien » | un mur déjà là sous un id aléatoire — il en poserait un second |

Les **arêtes** n'ont jamais eu besoin de garde : NebulaGraph les clefe sur
(source, type, rang, destination), un second `INSERT EDGE` réécrit la même. Elles sont donc reposées
**sans condition**, y compris sur des sommets retrouvés par relecture : c'est ce qui rattrape une
projection interrompue entre un sommet et son arête.

Les adresses stables, toutes recalculables depuis MySQL :

| Sommet | id dérivé | Relecture |
|---|---|---|
| `user` | l'accesseur `vertexId` de `Socializable` | — |
| `feed`, `wall` | `feed{user_id}`, `wall{user_id}` | `getUserNetworkVertexIds()` |
| `group` | `group{id}` | inutile : l'id suffit |
| `server` d'un groupe | `server{group_id}` | `(s:server)-[:owned_by]->(g:group)` |
| `page` d'un serveur | `page{server_vid}` — l'espace de noms est le serveur, les salons ont aussi des pages | `(p:page)-[:published_in]-(s:server)` |

⚠️ **Une relecture ne dit jamais « déjà projeté » quand elle échoue.** `execute()` ne lève pas sur une
erreur de lecture : il rend un `JsonResponse`, un objet — et `$result[0]['x'] ?? null` sur un objet est
une **`Error` fatale**, le `??` ne couvrant que l'index absent. Toute relecture porte donc un garde
`is_array`, journalise, et conclut « rien de projeté ». Le repli est sûr **parce que** l'id est
dérivé : le graphe refuse le doublon lui-même.

⚠️ **Le piège général, dont ceci n'est qu'un cas.**
`NebulaGraphConnection::insertVertex` fait `$vid = $values['id'] ?? uniqidReal()`. **Tout sommet
créé sans `id` explicite est donc dupliqué à chaque passage.** L'`id` peut venir de
`populatePropsFromPattern`, mais uniquement si le modèle expose `vertexId` — l'accesseur des traits
`Socializable` / `Commentable`. Un modèle sans ces traits, comme l'`Article` d'eblogger, exige que
**chacun** de ses écrivains pose l'`id` lui-même. Ils sont quatre — `ArticleCreatedListener`,
`ArticleRestoredListener`, `ArticleDeletedListener`, `projectArticles()` — et l'`id` ne se construit
plus qu'à **un** endroit, le trait `Helpers\GraphTraits\BuildsArticleVertexValues` : c'est la
divergence de deux copies qui avait fait viser `"1"` à la suppression là où les autres visaient
`"article1"`. `ArticleVertexTest` épingle qu'ils visent bien le même sommet.
Avant de projeter un nouveau type de sommet, répondre à : *quel est son id stable ?*

Un id dérivé n'est pas qu'une garantie d'unicité : c'est **la seule adresse qu'un autre écrivain
puisse recalculer**. Un sommet né sous `uniqidReal()` ne peut plus être ni mis à jour ni supprimé par
un chemin qui ne l'a pas vu naître, et la suppression manquée est silencieuse — un `DELETE VERTEX`
qui ne trouve rien n'est pas une erreur pour NebulaGraph.

## Qui écrit le réplica

| Écrivain | Quand | Portée |
|---|---|---|
| les **listeners** (`UserCreatedListener`, `ArticleCreatedListener`, …) | à chaque écriture MySQL | un enregistrement |
| `Services\GraphProjection` | à l'installation et à la demande | la base entière |

Les listeners **tolèrent l'échec** (`ToleratesGraphFailure`) : MySQL ne doit pas échouer parce
qu'une copie n'a pas pu être écrite. Le réplica peut donc dériver — et c'est `GraphProjection` qui
le rattrape.

### Un événement de suppression peut être réversible — l'article l'est

`Article::booted` (eblogger) dispatche `ArticleDeleted` sur **`static::deleting`**, et le modèle
utilise `SoftDeletes` : ce que le listener traite comme une suppression est une mise à la corbeille,
que `restore()` défait. **Le sens de l'événement se lit sur le hook Eloquent, pas sur son nom.**

Le sommet est donc **reposé** à la restauration, par un listener dont le corps est celui de la
création — et c'est le trait partagé qui garantit cette identité au lieu de l'espérer. Le rejeu est
inoffensif : `insertVertex` émet un `INSERT VERTEX IF NOT EXISTS`, qui laisse intact un sommet encore
présent, `created_at` compris.

Une nuance sans conséquence, mais qui surprend à la lecture : `hideIdentifier()` chiffre
`{model, id}`, et le chiffré varie d'un appel à l'autre. Un sommet reposé après une vraie suppression
porte donc un `identifier` **différent de l'original, qui désigne le même enregistrement** — la
propriété n'est pas une clé, l'`id` du sommet l'est.

⚠️ La restauration ne repose **pas** l'arête d'auteur, que la suppression a pourtant emportée
(`DELETE VERTEX … WITH EDGE`). C'est voulu : la création en ligne ne l'a jamais posée non plus, seul
`projectArticleAuthors()` l'écrit. Le trou est celui de la **création** ; le combler côté restauration
seule ferait diverger deux chemins d'écriture, exactement le motif que ce document raconte.
Cf. [`work/projection-graphe-todo.md`](../../work/projection-graphe-todo.md).

⚠️ **Les trois événements d'article ont deux abonnés homonymes**, un par paquet : eblogger enregistre
`ArticleCreatedListener`, `ArticleDeletedListener` et `ArticleRestoredListener` dont les `handle()`
sont **vides** (`// task to do`), et socializer les siens, de même nom, qui écrivent le graphe. Un
`grep` sur l'un de ces noms rend donc deux classes, dont une inerte : le câblage se lit avec
`artisan event:list`, jamais sur le premier fichier trouvé. Même piège que les deux
`GroupUserCreatedListener` — cf. [securite.md](../modules/webrtc2/securite.md).

**Décision du 23/08/2026 — pas de listener sur `ArticleUpdated`.** Le sommet ne porte qu'`identifier`,
dérivé de la classe et de l'`id` : rien qu'une mise à jour puisse changer. À rouvrir si le patron
`vertices.article` s'enrichit d'une propriété mutable — le titre, par exemple.

### `GraphProjection`, un propriétaire pour deux entrées

Ce DML a eu **deux copies** — la migration `create_nebula` et `socializer:nebula-populate` —, elles
ont dérivé (la commande avait perdu le `marketplace` et les parents de groupes), et le déroulé
prévu, *installer puis rattraper*, jouait deux fois un peuplement non idempotent. D'où les 2 murs
par utilisateur observés en dev.

Il n'en reste qu'une implémentation. Les deux entrées sont conservées — elles répondent à deux
besoins distincts — et n'apportent plus que leur **politique d'erreur** :

```
migration create_nebula          DDL (space, 18 tags, 11 arêtes, 6 index)
                                 + projectAll()           ───→ journalise, puis LÈVE
                                                                (donc n'est pas enregistrée)

socializer:nebula-populate       projectAll()             ───→ écrit sur la sortie,
                                                                puis code de sortie non nul
```

`projectAll()` porte **toutes** les étapes, et l'ordre ne compte qu'à un endroit : **les groupes avant
leurs serveurs.** Une arête vers un sommet jamais posé ne fait pas exister ce sommet — dans
NebulaGraph un sommet n'existe que s'il porte un tag —, donc `owned_by` pendrait dans le vide. Le
reste est insensible à l'ordre : une arête tolère que sa cible arrive après elle.

`projectAll()` compte les écritures refusées et rapporte chacune par un `callable` ; **il ne décide
pas**. Le rattrapage est **par item** : une seule ligne bancale ne doit pas emporter tout ce qui a
déjà été projeté. Et seule `NebulaGraphException` est rattrapée — une `TypeError` ici est un bug de
projection, pas une panne de réplica, elle doit remonter.

Une **relance est désormais sans danger**, y compris celle de `migrate` : c'est ce que la migration
interdisait explicitement avant E9.

### Qui possède ce qu'une projection écrit

Deux écritures exigent un acteur, et `Auth::user()` rend `null` en console : le `model_id` /
`model_type` du document Mongo de la **page** d'un serveur, et l'arête `has_creator` du **groupe** —
celle que `Socializable::isServerOwner` traverse pour dire qui administre le serveur.

**La projection résout donc le propriétaire depuis MySQL : le leader du groupe
(`group_user.is_leader`), sinon son membre attaché le plus tôt.** C'est la seule réponse que MySQL
sache donner sans rien inventer. Les services concernés prennent un `$owner` nullable **en queue de
signature**, replié sur `Auth::user()` — la forme d'`OnlineUsersService`, la seule du paquet.

Un groupe **sans aucun membre** n'a pas de propriétaire résoluble. Son sommet et son rattachement au
parent sont posés quand même — les arêtes `registered_in` des utilisateurs le visent déjà —, mais ni
son `has_creator` ni son serveur : **refus journalisé, qui ne compte pas comme un échec.** Une étape
qui *ne peut pas* s'exécuter n'est pas une écriture refusée par le graphe, et la compter comme telle
ferait échouer `migrate` sur toute base ayant un groupe vide.

### `extras['socializer_server_vid']` : écrit, jamais relu

C'est la poignée par laquelle le front entre dans le serveur d'un groupe (`Resources\User`) et par
laquelle `GroupDeletedListener` le supprime. **La projection l'écrit** — sans quoi ce qu'elle crée est
un orphelin invisible —, et l'écrit **dans le rattrapage**, comme `GroupCreatedListener` met son
`save()` dans `syncToGraph` : mémoriser un vid dont l'écriture graphe a échoué donnerait au front
l'adresse d'un sommet inexistant.

Elle ne le **relit** jamais : `extras` peut désigner un sommet supprimé, le graphe non. La relecture
d'idempotence interroge donc le graphe (voir le tableau des adresses stables plus haut).

## Réparer un réplica qui a divergé

1. **Constater**, sans rien supposer :
   ```
   MATCH (u:user)<-[:owned_by]-(w:wall) RETURN id(u) AS uid, COUNT(w) AS murs
   ```
   Plus de 1 ⇒ des doublons d'avant E9 subsistent : la projection ne les crée plus, mais ne les
   supprime pas.
2. **Dédoublonner** en gardant le `created_at` le plus ancien de chaque utilisateur, et supprimer
   avec `WITH EDGE` pour emporter `owned_by` et `followed_by`.
3. **Puis** relancer `socializer:nebula-populate` — deux fois d'affilée, c'est le test qui compte :
   les décomptes ne doivent plus bouger.

⚠️ **`migrate:rollback` n'est pas une réparation.** Son `down()` fait un `dropSpace` : il détruit
aussi tout ce que la projection ne sait PAS recréer — serveurs, salons, chats, messages, pages,
commentaires —, et les documents MongoDB correspondants restent en pointant sur des sommets
disparus.
