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

## 3. `ArticleDeletedListener` supprimait le mauvais sommet ✅ 22/08

- [x] Clé corrigée (`tags.article.name`). Le balayage du motif `vertices.*.id` sur tout `src/` ne
      rendait que cette occurrence.
- [x] `ArticleCreatedListener` pose l'`id` dérivé et l'`identifier`, comme `projectArticles()`.

`vertices.article` ne contient qu'`identifier` : la clé `.id` n'existait pas, l'expression valait
`''.$article->id`, soit `"1"` au lieu de `"article1"`, et la suppression ne touchait rien en silence.

**Ce qui n'était pas au plan, et sans quoi corriger la clé n'aurait rien corrigé** : la création
souffrait du défaut symétrique. `ArticleCreatedListener` appelait `insertVertex()` sans `id`
explicite, et `Article` n'a ni `Socializable` ni `Commentable` — donc pas de `vertexId` à tirer de
`populatePropsFromPattern`. Le sommet naissait sous `uniqidReal()`. Une suppression corrigée aurait
atteint les sommets nés d'une projection et serait restée sans effet sur tout article créé en ligne.
D'où la forme du test central de `tests/Feature/Graph/ArticleVertexTest.php` : la suppression vise
**ce que la création a posé** — aucune des deux moitiés du défaut ne peut satisfaire cette assertion
seule. Le durable est remonté dans
[`docs/architecture/projection-graphe.md`](../docs/architecture/projection-graphe.md).

Reste dehors, et relève du §2 : les sommets d'article déjà nés sous un id aléatoire en dev.

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

## 7. Restaurer un article ne recrée pas son sommet ✅ 23/08

Ouvert le 22/08 **en fermant le §3** : c'est ce correctif qui rend le trou conséquent.

`ArticleDeleted` part sur `static::deleting` (`Article::booted`, eblogger), donc sur un **soft
delete**. Tant que la suppression était un no-op, restaurer un article était sans conséquence par
accident ; maintenant le sommet part vraiment. Or `ArticleRestored` est bien émis
(`static::restored`) et **aucun listener de socializer ne l'écoutait** — celui d'eblogger est un
`handle()` vide (`// task to do`) : l'article revenait en base, son sommet non.

- [x] `ArticleRestoredListener` rejoue l'insertion de la création. Le rejeu est inoffensif sur un
      sommet encore présent (`INSERT VERTEX IF NOT EXISTS`), donc aucune garde de plus n'est
      nécessaire.
- [x] `ArticleUpdated` : **pas de listener**, décision datée du 23/08 dans
      [`docs/architecture/projection-graphe.md`](../docs/architecture/projection-graphe.md).
      `identifier` ne dépend que de la classe et de l'`id` — rien qu'une mise à jour puisse changer.
      À rouvrir si `vertices.article` s'enrichit d'une propriété mutable.

**Ce qui n'était pas au plan.** Le corps « poser le sommet d'un article » existait en deux copies
(listener de création, `projectArticles()`) et la restauration en aurait fait une troisième — dans un
fichier dont le §3 vient de montrer ce que coûtent deux copies qui dérivent. Les valeurs vivent
désormais dans `Helpers\GraphTraits\BuildsArticleVertexValues`, partagé par les trois écrivains :
c'est ce partage que le nouveau test asserte, en comparant la requête **entière** de la restauration
à celle de la création, et pas seulement leur vid.

Deux sujets en sont sortis, ci-dessous : §8 (l'arête d'auteur) et §9 (le trou de couverture).

## 8. La création en ligne d'un article ne pose pas son arête d'auteur 🟢

Vu le 23/08 en fermant le §7, et **délibérément laissé ouvert** : `has_creator` n'est écrit que par
`GraphProjection::projectArticleAuthors()`. Un article créé dans l'application n'a donc pas d'arête
d'auteur jusqu'à la prochaine projection, alors que la suppression, elle, l'emporte (`WITH EDGE`).

La restauration ne la repose pas non plus — **parité stricte avec la création**, décidée le 23/08 : la
combler côté restauration seule ferait diverger deux chemins d'écriture, le motif même du §3.

Priorité basse, et c'est mesuré : **personne ne lit cette arête**. Aucun `MATCH` ni `GO FROM` sur le
sommet `article` dans socializer ni dans eblogger — la projection de l'article est aujourd'hui en
écriture seule.

- [ ] Trancher : les listeners posent `has_creator` (création **et** restauration, avec une garde sur
      `$article->author` — `author_id` est nullable et l'auteur peut être supprimé), ou l'arête
      d'auteur d'article est assumée comme une donnée de projection seulement
- [ ] Si on la pose : vérifier d'abord la réserve technique. `projectAll()` intercale un
      `sleep(config('…sleeping_duration'))` — 20 s par défaut — **entre** les sommets d'article et
      leurs arêtes, en jugeant le schéma NebulaGraph asynchrone. Un listener qui pose les deux dans
      la même requête HTTP n'a pas cette latence : soit la pause est du folklore, soit l'arête peut
      échouer, et c'est à savoir avant, pas après

## 9. `projectArticles()` n'est exercé par aucun test 🟢

`GraphProjectionTest` n'en couvre que le cas « eblogger absent » (aucune requête `article` ne part).
L'étape est sautée dans le harnais faute de `config('eblogger.models.article')`, donc son nGQL n'est
épinglé par rien — les listeners, eux, le sont au caractère près.

Depuis le trait partagé (§7), ce qui est vérifié du chemin listener vaut pour la projection **par
construction** : c'est le même code qui construit les valeurs. Ce qui reste non couvert est
l'assemblage — la boucle, le garde de config, l'arête d'auteur.

- [ ] Ce que ça coûterait : un modèle stub exposant un `all()` statique et un `author` (le code ne
      fait que `$model::all()` et `$article->author->id`, aucun Eloquent requis), puis
      `config()->set('eblogger.models.article', …)` sur le modèle de
      `les_parents_de_groupes_sont_projetes_quand_le_modele_est_declare`. ⚠️ Ne pas donner de
      `vertexId` à ce stub : `tests/Stubs/Eblogger/app/Models/Article.php` explique pourquoi ça
      masquerait le défaut que le fichier épingle
