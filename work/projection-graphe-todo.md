# Projection NebulaGraph — ce qui reste après E9

Ouvert le 22/08/2026, en sortant du correctif « un utilisateur = un mur + un feed ». Le durable est
dans [`docs/architecture/projection-graphe.md`](../docs/architecture/projection-graphe.md) ; ici, ce
qui a été **vu et laissé de côté**, avec de quoi le reprendre.

Contexte du correctif, pour situer : `insertVertex` retombe sur `uniqidReal()` quand aucun `id`
n'est passé, et les deux entrées qui projettent une base entière — la migration `create_nebula` et
`socializer:nebula-populate` — jouaient ce DML en double copie. Résultat en dev : 2 murs et 2 feeds
par utilisateur (12 utilisateurs, deux salves à 47 s d'écart le 28/05/2026).
`createUserAndNetwork()` est désormais idempotente et le DML a un seul propriétaire,
`Services\GraphProjection`.

---

## 1. Les serveurs de groupes ne sont pas projetables en console 🔴

`Server::createGroupServer` → `createServer` → `Page::createPageVertice`, qui lit `$this->user->id`
et `get_class($this->user)`. Sans utilisateur authentifié : `TypeError`. La migration boucle
pourtant sur tous les groupes.

- [x] Garde posé : sans acteur, l'étape se refuse et journalise, elle ne lève plus (22/08)
- [ ] Passer le propriétaire **explicitement** à `createServer` / `createPageVertice`, défaut
      `Auth::user()`, pour que l'étape redevienne jouable depuis une commande
- [ ] La rendre **idempotente** au passage : le sommet `server` et sa page naissent sous un
      `uniqidReal()`, donc deux projections d'un même groupe donnent deux serveurs — exactement le
      défaut qu'on vient de corriger pour les murs, un étage plus haut
- [ ] Puis la remettre dans `projectAll()` et couvrir `projectGroupServers()` par un test : il
      n'est pas couvert aujourd'hui, le constructeur de `Services\Server` tirant `app('onlineUsers')`,
      `Chat`, `Page`, `ApplicationIA` et `Feed`, absents du harnais

**Sur quelle base ça se voit :** aucune pour l'instant. Le seul sommet `server` du dev vient de
l'application, pas d'une projection — la migration a tourné le 28/05 alors que la table `groups`
était vide.

## 2. Aucune commande ne dédoublonne une base déjà divergente 🟠

Le correctif empêche de créer un doublon ; il n'en supprime aucun. Le dev a été réparé à la main
(garder le `created_at` le plus ancien, supprimer avec `WITH EDGE`).

- [ ] Décider si une commande `socializer:nebula-dedupe` est nécessaire — la réponse dépend de
      l'existence d'une base de production ayant subi les deux passages
- [ ] Si oui : refuser de tourner sur un mur qui porte du contenu, et rapporter au lieu de
      supprimer par défaut (`--dry-run` comme mode normal)

## 3. `ArticleDeletedListener` supprime le mauvais sommet 🔴

```php
$nebula->deleteVertex([ config('socializer.nebulagraph.vertices.article.id').$event->article->id ], true)
```

`vertices.article` ne contient qu'`identifier` : la clé `.id` **n'existe pas**, donc l'expression
vaut `''.$article->id`, soit `"1"` au lieu de `"article1"`. La suppression ne touche rien, en
silence. Le sommet attendu est `config('...tags.article.name').$article->id` — c'est la forme
qu'utilisent `projectArticles()` et `projectArticleAuthors()`.

- [ ] Corriger la clé, et chercher les autres usages de `vertices.*.id` (motif suspect par nature)

## 4. Deux traces d'installation à nettoyer 🟢

- [ ] `SocializerInstall.php` ajoute `DB_GRAPH_SPACE=network` à `.env`, mais la config lit
      `DB_NEBULA_GRAPH_SPACE` (`config/database.php`, défaut `infrastructure`) : **la ligne écrit une
      variable que personne ne lit**. Attention en corrigeant : ajouter la vraie variable en fin de
      `.env` sur une installation qui la définit déjà se marcherait dessus.
- [ ] `SocializerInstall.php:373` appelle `createUserAndNetwork($chatbot)` alors que le
      `static::created` d'`EstarterUser` a déjà déclenché `UserCreatedListener` treize lignes plus
      haut. C'était une double projection ; l'idempotence la rend inoffensive, et elle vaut même
      rattrapage si le listener a échoué. **À garder**, mais à commenter sur place pour que
      personne ne la « nettoie » en croyant supprimer un doublon.

## 5. `getFeedFollowers($feedVertexId)` prend un id de MUR 🟢

Le paramètre s'appelle `feed`, la requête matche `(w:wall)`, et les appelants (`SendPostToFollowers`,
le `feed_id` des posts Mongo) lui passent bien un mur. Rien n'est cassé, mais le nom fait perdre du
temps à chaque lecture.

- [ ] Renommer le paramètre — et vérifier au passage ce que `feed_id` désigne vraiment dans la
      collection `posts` de Mongo

## 6. Le réplica a déjà divergé de Mongo (E4.2) 🟠

Constaté le 22/08 sur le dev : 3 posts Mongo pointent sur un mur `e1d5c82dc5951` **qui n'existe
plus** (probablement un `dropSpace` du 28/05), et le graphe compte 0 sommet `post` pour 3 documents.
34 messages et 14 pages Mongo n'ont pas été audités.

C'est le sujet **E4.2** de [webrtc2-securite-2026-08-14.md](webrtc2-securite-2026-08-14.md) —
arbitrer la re-synchronisation d'un réplica —, dont ce correctif est une brique : une projection
idempotente est ce qui rend une re-synchronisation rejouable. À traiter là-bas, pas ici.
