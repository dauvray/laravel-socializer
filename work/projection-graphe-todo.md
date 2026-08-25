# Projection NebulaGraph — les suites du correctif « un mur + un feed »

Le durable est dans
[`docs/architecture/projection-graphe.md`](../docs/architecture/projection-graphe.md) ; ici, ce qui
a été **vu et laissé de côté**, avec de quoi le reprendre.

> ## ⏸️ Chantier suspendu — il ne passe pas devant les autres
>
> **§1, §3 et §7 sont livrés.** Ce qui reste est 🟢/🟠, **ne bloque rien**, et ne se prend qu'**au
> besoin** : quand un chantier prioritaire le croise, ou sur demande explicite.
>
> ⚠️ **Y déposer un constat sans rouvrir le chantier est l'usage prévu** — c'est ainsi que §11 et
> §12 sont arrivés. Et le piège à ne pas retomber dedans : chaque item d'ici *paraît* petit et
> adjacent au précédent. C'est exactement comme la dérive s'est produite.

---

## 1. Les serveurs de groupes ne sont pas projetables en console ✅

Livré. Le propriétaire est résolu depuis MySQL (le leader du groupe), l'étape est idempotente par
relecture + id dérivé, et le vid est mémorisé dans `extras` — sans quoi un serveur projeté restait
invisible du front et non supprimable. Le durable est dans `projection-graphe.md` ; la leçon de
harnais — la doublure rend la forme qu'on lui script — dans `architecture/tests.md`.

⚠️ Un rattrapage peut sortir en code 1 sur `Session not existed!` : expiration de session Thrift,
pas un défaut de projection. Écrit dans `projection-graphe.md`, « réparer un réplica ».

## 2. Aucune commande ne dédoublonne une base déjà divergente 🟠

Le correctif empêche de créer un doublon ; il n'en supprime aucun. Le dev a été réparé à la main
(garder le `created_at` le plus ancien, supprimer avec `WITH EDGE`).

- [ ] Décider si une commande `socializer:nebula-dedupe` est nécessaire — la réponse dépend de
      l'existence d'une base de production ayant subi les deux passages
- [ ] Si oui : refuser de tourner sur un mur qui porte du contenu, et rapporter au lieu de
      supprimer par défaut (`--dry-run` comme mode normal)

## 3. `ArticleDeletedListener` supprimait le mauvais sommet ✅

Livré. La création souffrait du défaut symétrique — un sommet né sous `uniqidReal()` qu'aucune
suppression ne pouvait viser — d'où la leçon remontée dans `projection-graphe.md` : **un id dérivé
n'est pas qu'une garantie d'unicité, c'est la seule adresse qu'un autre écrivain puisse recalculer.**

Reste dehors, et relève du §2 : les sommets d'article déjà nés sous un id aléatoire.

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

## 6. Le réplica a déjà divergé de Mongo 🟠

Constaté le 22/08 sur le dev : 3 posts Mongo pointent sur un mur `e1d5c82dc5951` **qui n'existe
plus** (probablement un `dropSpace` du 28/05), et le graphe compte 0 sommet `post` pour 3 documents.
34 messages et 14 pages Mongo n'ont pas été audités.

⚠️ **Ce n'est plus un sujet de sécurité, et le volet sécurité a été arbitré dans l'autre sens.**
E4.2 a tranché le 24/08 : plutôt que de re-synchroniser le réplica, les gardes ont **cessé de le
lire** ([`securite.md`, piège 2](../docs/modules/webrtc2/securite.md#deux-pièges-du-graphe-que-ce-garde-contourne)).
Ne pas rouvrir la question de la re-synchronisation en s'appuyant sur ce §6 : ce qui reste ici est
une divergence de **données** — des documents Mongo sans sommet — et une projection idempotente
reste ce qui rendrait un rattrapage rejouable, si un besoin réel le demande.

## 7. Restaurer un article ne recrée pas son sommet ✅

Livré. `ArticleRestoredListener` repose le sommet, et le corps « poser le sommet d'un article » vit
désormais dans un trait unique — ce que le test asserte en comparant la requête **entière** de la
restauration à celle de la création. `ArticleUpdated` reste sans listener, par décision datée dans
`projection-graphe.md`.

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
      `$article->author` — voir le ⚠️ ci-dessous), ou l'arête d'auteur d'article est assumée comme
      une donnée de projection seulement

**Exploration faite le 23/08 avant de suspendre — quatre faits vérifiés, à ne pas re-chercher :**

- **Personne ne lit cette arête, et c'est mesuré** : `has_creator` a **20 sites de lecture** dans le
  paquet, aucun ne traverse `(a:article)-[:has_creator]->(u:user)`. Le seul lecteur qui l'accepterait
  techniquement, `Socializable::isCreator` (source non typée), ne reçoit que des vids de **salon** de
  ses trois appelants. Le sommet `article` n'a qu'un autre voisin : `reply_of`, depuis les
  commentaires — son rôle est d'être l'ancre d'un fil, rien de plus.
- **La réserve technique du `sleep` est levée : c'est du folklore.** « Sommet puis arête dans la même
  requête » est déjà le motif de **12 sites de production**, dont 8 avec `has_creator`, et
  `createUserAndNetwork()` le fait **à l'intérieur de la projection batch** (`projectUsers`). Les
  deux `sleep()` de `create_nebula` encadrent du **DDL**, dont l'asynchronie est réelle ; celui de
  `projectAll():68` sépare deux DML, et le docblock de la méthode dit lui-même que « les arêtes
  tolèrent que leur cible arrive après elles ». Les 20 s sont donc à retirer, que l'arbitrage aille
  dans un sens ou dans l'autre.
- **L'auteur est déjà atteignable sans arête** : le sommet porte `identifier`, et
  `revealIdentifier(…)->author` est le motif que `Comments::notifyCommentReplyOfAuthor` emploie déjà.
- ⚠️ **`author_id` n'est PAS nullable** — `create_articles_table.php:19`, `integer unsigned` sans
  NULL, `'author_id' => 'required'` en validation. La ligne ci-dessus se trompait. La garde reste
  nécessaire, pour une **autre** raison : pas de clé étrangère, et `EstarterUser` est en
  `SoftDeletes`, donc `$article->author` rend `null` dès que l'auteur est en corbeille (rien ne
  nettoie ces `author_id` orphelins — `UserDeletedListener` d'eblogger est intégralement commenté).
  **C'est un défaut actif**, indépendant de l'arbitrage : `projectArticleAuthors()` déréférence
  `$article->author->id` sans garde, et l'`Error` n'est pas rattrapée par `tentative()`, qui ne capte
  que `NebulaGraphException` — **un seul auteur en corbeille fait donc échouer `migrate` et
  `nebula-populate` en entier**, alors que le docblock de la classe cite précisément ce cas comme
  exemple de ce que le rattrapage par item protège.

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

## 10. Les salons ne sont pas projetables — assumé 🟢

**Décision : pas de maître MySQL pour les salons, les chats et les messages** — il n'existe aucune
table `rooms` ni `servers`, ni ici ni dans le socle. Le graphe est leur source de vérité. Les trois
conséquences sont écrites dans
[`docs/architecture/projection-graphe.md`](../docs/architecture/projection-graphe.md#ce-que-la-projection-ne-recréera-jamais),
la ligne de partage dans
[`docs/architecture/package.md`](../docs/architecture/package.md#trois-bases-de-données).

Corollaire sans enjeu **tant que la décision tient** : les `insertVertex` de `Services\Server` ne
posent aucun `id` explicite. Ils ne coûtent rien puisque personne ne rejoue leur création — ils
redeviendraient une dette le jour où un gabarit, un import ou un installeur créerait des salons en
lot, c'est-à-dire le déroulé « installer puis rattraper » qui avait donné deux murs par utilisateur.

- [ ] **La sauvegarde du space NebulaGraph** — exigence d'exploitation qui découle directement de la
      décision, au même rang que le dump MySQL. Rien ici ne la fait et rien ici ne peut la faire :
      c'est une tâche d'infra du projet hôte, à porter là où vivent les sauvegardes MySQL et Mongo.
- [ ] Retirer le `setGroupHasParentRelation($event->group)` de `GroupCreatedListener` :
      `Users::createGroup()` le fait déjà, l'arête est posée deux fois. Inoffensif — les arêtes sont
      clefées — mais c'est une copie de plus.

---

## 11. Aucun listener n'est abonné à `UserDeleted` — le sommet d'un compte supprimé survit

- [ ] **Trouvé le 24/08/2026** en instruisant l'arbitrage d'E4.2, hors de son périmètre.

`EstarterUser::booted` dispatche bien `UserDeleted` sur `static::deleting` — soft delete **et**
`forceDelete`. Mais `SocializerEventServiceProvider` n'y abonne **rien** : le seul abonné est le
listener d'estarter, qui ne supprime que la vignette et la `location`. **Le sommet `user` du graphe
n'est donc jamais retiré, ni ses arêtes** — alors que la cascade SQL de `group_user` a, elle, effacé
les lignes pivot.

Le pendant existe pourtant pour le groupe : `GroupDeletedListener` → `Users::deleteGroup` →
`deleteVertex(…, WITH EDGE)`. C'est un trou d'écrivain, pas une décision.

⚠️ **Ce n'est pas un défaut de sécurité, et il ne faut pas le vendre comme tel** : le compte est
supprimé, il ne s'authentifie plus, aucun garde ne peut donc être trompé par ses arêtes — d'autant
que depuis E4.2 l'appartenance ne se lit plus dans le graphe. Ce que ça fausse, ce sont les
**décomptes et les listings** : `Server::getServers`, `nb_users`, `Socializable::servers()`.

- Symétrique de `GroupDeletedListener`, `ToleratesGraphFailure` compris.
- ⚠️ Le hook est `deleting`, qui **ne distingue pas** le soft delete du `forceDelete` : supprimer le
  sommet sur une mise à la corbeille rendrait `restore()` incohérent. C'est le motif déjà rencontré
  sur l'article (§7) — le sens de l'événement se lit sur le hook, pas sur son nom —, et c'est la
  seule vraie difficulté de la tâche.

**Tests :** un compte détruit ne laisse ni sommet ni arête · un compte mis à la corbeille les garde.

---

## 12. `checkServerAccess` : le helper global n'a plus qu'un appelant, et il est douteux

- [ ] **Trouvé le 24/08/2026** en livrant E4.2, qui a débranché son usage `server`.

`Services\Server::checkServerAccess` passe désormais par `Socializable::canJoinServer`. Le helper
global `checkServerAccess()` de `Helpers/Socializer.php` n'est donc plus appelé que par
`ServerController::getAdminpanelList:265`, avec le tag `room` :

```php
if(!checkServerAccess($options['roomId'], $user->vertex_id, 'room')) { abort(403); }
```

Or son motif est `(creator:user)<-[:has_creator]-(g:group)<-[:owned_by]-(s:<tag>)` : il attend un
sommet **possédé par un groupe**. Les salons ne le sont pas — ils sont `published_in` un serveur.
Cette garde ne peut donc rien rendre d'autre que « refusé », sur toute donnée réelle.

À trancher sur pièces : la remplacer par le garde de salon (`canJoinRoom || isRoomOwner`), ou
constater qu'elle protège une route morte. **Ne pas supprimer le helper avant d'avoir tranché ce
point** — c'est son dernier appelant.
