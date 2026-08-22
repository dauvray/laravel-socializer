# Projection MySQL → NebulaGraph

**MySQL est la source de vérité, le graphe en est un réplica.** Ce document dit qui écrit ce
réplica, quel invariant il respecte, et pourquoi rejouer une projection est sans danger.

À lire avec [package.md](package.md#tri-persistance) pour la tri-persistance, et
[tests.md](tests.md) pour le harnais qui épingle tout ça.

---

## L'invariant

> **Un utilisateur = un sommet `user`, un sommet `feed`, un sommet `wall`.**
> Quel que soit le nombre de projections.

Le mur porte une arête `followed_by` vers son propre propriétaire — **c'est voulu** : la
distribution d'un post remonte les `followed_by` (`getFeedFollowers`), sans cette arête l'auteur ne
verrait pas ses propres publications. Conséquence assumée : le `COUNT(nbf)` de `Services\Users`
compte le propriétaire, et le front l'ôte (`ThumbnailWidget.vue`, `Cover.vue`). Un mur en trop
décale donc ce compteur — c'est le symptôme visible, pas le vrai risque, qui est
`Socializable::wall()` : il rend `$wall[0]` **sans `ORDER BY`**, donc sur deux murs un follow, une
publication et sa distribution peuvent atterrir sur des sommets différents du même utilisateur.

## Comment l'invariant tient

`createUserAndNetwork()` (`app/Helpers/Socializer.php`) est **idempotente**, par deux verrous dont
aucun ne suffit seul :

| Verrou | Ce qu'il couvre | Ce qu'il ne couvre pas |
|---|---|---|
| **relecture** du réseau existant avant création | les sommets nés avant E9, dont l'`uniqidReal()` n'est pas reconstituable | deux appels concurrents qui ont tous deux lu « pas de mur » |
| **id dérivé** du modèle (`feed12`, `wall12`) + `INSERT VERTEX IF NOT EXISTS` | la concurrence, au niveau de la base | un mur déjà là sous un id aléatoire — il en poserait un second |

Les **arêtes** n'ont jamais eu besoin de garde : NebulaGraph les clefe sur
(source, type, rang, destination), un second `INSERT EDGE` réécrit la même.

⚠️ **Le piège général, dont ceci n'est qu'un cas.**
`NebulaGraphConnection::insertVertex` fait `$vid = $values['id'] ?? uniqidReal()`. **Tout sommet
créé sans `id` explicite est donc dupliqué à chaque passage.** L'`id` peut venir de
`populatePropsFromPattern`, mais uniquement si le modèle expose `vertexId` — l'accesseur des traits
`Socializable` / `Commentable`. Un modèle sans ces traits, comme l'`Article` d'eblogger, exige que
**chacun** de ses écrivains pose l'`id` lui-même : les trois le font — `ArticleCreatedListener`,
`ArticleDeletedListener`, `projectArticles()` —, et `ArticleVertexTest` épingle qu'ils visent bien le
même sommet. Avant de projeter un nouveau type de sommet, répondre à : *quel est son id stable ?*

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

### `GraphProjection`, un propriétaire pour deux entrées

Ce DML a eu **deux copies** — la migration `create_nebula` et `socializer:nebula-populate` —, elles
ont dérivé (la commande avait perdu le `marketplace` et les parents de groupes), et le déroulé
prévu, *installer puis rattraper*, jouait deux fois un peuplement non idempotent. D'où les 2 murs
par utilisateur observés en dev.

Il n'en reste qu'une implémentation. Les deux entrées sont conservées — elles répondent à deux
besoins distincts — et n'apportent plus que leur **politique d'erreur** :

```
migration create_nebula          DDL (space, 18 tags, 11 arêtes, 6 index)
                                 + projectGroupServers()  ─┐
                                 + projectAll()           ─┴─→ journalise, puis LÈVE
                                                                (donc n'est pas enregistrée)

socializer:nebula-populate       projectAll()             ───→ écrit sur la sortie,
                                                                puis code de sortie non nul
```

`projectAll()` compte les écritures refusées et rapporte chacune par un `callable` ; **il ne décide
pas**. Le rattrapage est **par item** : une seule ligne bancale ne doit pas emporter tout ce qui a
déjà été projeté. Et seule `NebulaGraphException` est rattrapée — une `TypeError` ici est un bug de
projection, pas une panne de réplica, elle doit remonter.

Une **relance est désormais sans danger**, y compris celle de `migrate` : c'est ce que la migration
interdisait explicitement avant E9.

### La seule étape qui n'est pas dans `projectAll()`

`projectGroupServers()` — parce que `Server::createGroupServer` **exige un utilisateur
authentifié** : sa chaîne descend jusqu'à `Page::createPageVertice`, qui lit `Auth::user()`. En
console il n'y en a pas.

Appelée sans acteur, elle **se refuse, journalise, et ne compte pas comme un échec** : une étape qui
*ne peut pas* tourner là où elle est appelée n'est pas une écriture refusée par le graphe, et la
compter comme telle ferait échouer `migrate` sur toute base ayant des groupes. Elle n'est donc pas
non plus idempotente — le sommet `server` et sa page naissent sous un `uniqidReal()`.

La rendre jouable en console (propriétaire passé explicitement) est un chantier ouvert :
[`work/README.md`](../../work/README.md).

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
