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

## 1. Les serveurs de groupes ne sont pas projetables en console ✅ 23/08

`Server::createGroupServer` → `createServer` → `Page::createPageVertice`, qui lit `$this->user->id`
et `get_class($this->user)`. Sans utilisateur authentifié : `TypeError`. La migration boucle
pourtant sur tous les groupes.

- [x] Garde posé : sans acteur, l'étape se refuse et journalise, elle ne lève plus (22/08)
- [x] Propriétaire passé **explicitement**, paramètre nullable en queue de signature replié sur
      `Auth::user()` (forme d'`OnlineUsersService`, la seule du paquet) : `createGroupServer`,
      `createServer`, `createPageVertice`, `Users::createGroup`. En projection il est **résolu depuis
      MySQL** — le leader du groupe (`group_user.is_leader`), sinon son membre attaché le plus tôt.
- [x] Idempotente, par les deux verrous de `createUserAndNetwork` : relecture du graphe, puis id
      dérivé (`server{group_id}`, `page{server_vid}`).
- [x] Remise dans `projectAll()` — et devenue **privée** : elle était publique avec son propre
      compteur, ce que la migration additionnait à la main.
- [x] Couverte par `tests/Feature/Graph/GroupServerProjectionTest.php`.

**Ce que l'avertissement « pas testable » cachait.** Il attribuait le trou au constructeur de
`Services\Server` (« `Chat`, `Page`, `ApplicationIA`, `Feed`, des services d'estarter absents du
harnais »). C'était faux sur les deux points : ces quatre services sont ceux de **ce** paquet et
n'ajoutent aucune dépendance — l'ensemble transitif de `new Server()` se réduit à `nebulaGraph`,
`onlineUsers` et `Auth::user()`, tous doublés depuis longtemps. Le seul vrai blocage était **Mongo**
(`mongodb/laravel-mongodb` n'est pas installé dans le paquet), contourné par `tests/Stubs/Page.php`.
Une raison plausible de ne pas tester se vérifie comme le reste.

### Deux défauts trouvés en chemin, et corrigés ici

- **Aucune étape ne créait le sommet `group`.** `projectGroupParents()` ne posait que l'arête
  parent ; le seul `insertVertex('group')` était sur le chemin événementiel. Sur une base projetée,
  `owned_by` et `registered_in` visaient donc un sommet **sans tag** — invisible d'un
  `MATCH (g:group)`, donc `isServerOwner` faux pour tout le monde. L'étape s'appelle désormais
  `projectGroups()` et délègue à `Users::createGroup()`, ce qui supprime au passage la double pose
  de l'arête parent.
- **Le vid du serveur était jeté.** `extras['socializer_server_vid']` est la poignée du front
  (`Resources\User`) et de `GroupDeletedListener` : un serveur projeté était invisible et non
  supprimable. La projection l'écrit maintenant, **dans le rattrapage** — jamais mémoriser un vid
  dont l'écriture graphe a échoué.

Plus un bug latent fermé : `createGroupServer` passait le `false` d'un `insertVertex` refusé à
`setOwnedByRelation`, qui émettait `INSERT EDGE owned_by VALUES "->group12"` en silence.

### La leçon, et elle a coûté un serveur en trop sur le dev

**Une requête nGQL à UNE colonne rend une liste PLATE de valeurs**, pas des lignes associatives :
`formatValues` effondre une ligne d'une seule colonne sur sa valeur. La relecture lisait
`$result[0]['server']` — un accès par clé sur une chaîne, silencieux sous `??` — donc `null`, donc un
second serveur à chaque projection. **La suite était verte** : `FakeNebulaGraph` rend la forme qu'on
lui script, et j'avais scripté des lignes associatives. C'est la contre-épreuve sur le dev qui l'a
vu. Consigné dans le docblock de la doublure et dans celui de la relecture.

Corollaire, corrigé dans la foulée : `getUserNetworkVertexIds` affirmait encaisser une panne de
lecture par `?? null`. Faux — `execute()` rend un `JsonResponse` et un accès tableau sur un objet est
une `Error` fatale que `??` ne rattrape pas. Garde `is_array` posé, et un test qui script
`grapheMuet()` l'épingle.

**Sur quelle base ça se voit :** le dev n'avait qu'un serveur, né de l'application. Il en a porté
deux le temps de la contre-épreuve — le surnuméraire (`server1`) et sa page Mongo ont été supprimés,
et `extras` pointe de nouveau sur le serveur applicatif. Trois passages de `nebula-populate`
d'affilée n'ajoutent plus rien.

> ⚠️ Un de ces passages est sorti en code 1 : `insertEdge` refusé pour
> `Session not existed!` — expiration de session Thrift pendant les arêtes d'auteur, pas un défaut de
> projection. Le rattrapage par item a journalisé et compté ; la relance a suffi. À savoir avant de
> soupçonner le code sur un échec isolé.

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

Le §1 a montré le chemin : `tests/Stubs/Page.php` double un modèle Mongo par un Eloquent sqlite, et
c'est ce qui a débloqué la couverture des serveurs de groupes. Le même motif s'applique ici.

## 10. Les salons ne sont pas projetables — assumé le 23/08 🟢

Ouvert le 23/08 en fermant le §1, **et refermé le même jour par un arbitrage**. Sa première rédaction
posait la mauvaise question : « quel est l'id stable de ces sommets ? » présuppose qu'une ligne MySQL
dise qu'ils existent. Vérifié : **il n'y a aucune table `rooms` ni `servers`**, ni ici ni dans le
socle. Un salon n'existe que comme sommet, créé par un contrôleur, avec son contenu dans Mongo indexé
sur le vid.

**Décision : pas de maître MySQL pour les salons, les chats et les messages.** Le graphe est leur
source de vérité. Les trois conséquences — non-projetables, perte définitive, sauvegarde du space
comme exigence d'exploitation — sont écrites dans
[`docs/architecture/projection-graphe.md`](../docs/architecture/projection-graphe.md#ce-que-la-projection-ne-recréera-jamais),
et la ligne de partage « qui est maître de quoi » dans
[`docs/architecture/package.md`](../docs/architecture/package.md#trois-bases-de-données).

Ce qui reste vrai et sans enjeu **tant que la décision tient** : six `insertVertex` ne posent aucun
`id`, donc autant de sommets nés sous `uniqidReal()`. Ils ne coûtent rien puisque personne ne rejoue
leur création ; ils redeviendraient une dette le jour où un gabarit, un import ou un installeur
créerait des salons en lot — c'est le déroulé « installer puis rattraper » qui avait donné 2 murs par
utilisateur.

| Site | Sommet |
|---|---|
| `Server::createRoomServer` | `room` |
| `Server::_createContentVertex` | le contenu d'un salon |
| `Server::createDataVertice` | `data` |
| `Server::createClassroomVertice` | `classroom` |
| `Server::createBoardVertice` | `board` |
| `Server::createFeedWallVertice` | le mur/feed d'un salon |

Ce qui reste ouvert, et qui n'appartient pas à ce dépôt :

- [ ] **La sauvegarde du space NebulaGraph** — exigence d'exploitation qui découle directement de la
      décision, au même rang que le dump MySQL. Rien ici ne la fait, et rien ici ne peut la faire :
      c'est une tâche d'infra du projet hôte, à porter là où vivent les sauvegardes MySQL et Mongo.

Et une broutille de ce dépôt, sans rapport avec la décision :

- [ ] Retirer le `setGroupHasParentRelation($event->group)` de `GroupCreatedListener:39` :
      `Users::createGroup()` le fait déjà, l'arête est posée deux fois. Inoffensif — les arêtes sont
      clefées — mais c'est une copie de plus.
