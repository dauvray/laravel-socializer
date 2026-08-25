<?php

namespace Dauvray\Socializer\app\Helpers\ModelTraits;

use Cviebrock\EloquentSluggable\Sluggable;
use Cviebrock\EloquentSluggable\SluggableScopeHelpers;
use Dauvray\Socializer\app\Notifications\CommentReplyOf;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Dauvray\Socializer\app\Models\Post;

trait Socializable
{
    use Sluggable, SluggableScopeHelpers;


    public function initializeSocializable()
    {
        $this->fillable = array_merge($this->fillable, ['is_bot']);
    }

    /*
    |--------------------------------------------------------------------------
    | GLOBAL VARIABLES
    |--------------------------------------------------------------------------
    */



    /**
     * Return the sluggable configuration array for this model.
     *
     * @return array
     */
    public function sluggable(): array
    {
        return [
            'slug' => [
                'source' => 'name',
            ],
        ];
    }

    public function setCoverImage($value = null)
    {

        $extras = $this->extras;

        if(!isset($extras['cover'])) {
            $extras['cover'] = null;
        }

        $isReset = $this->resethumnbnail($value, $extras['cover'], $this->disk);

        // clear image ?
        if ($isReset) {
            // set null in the database column
            $extras['cover'] = null;
        }

        $isSame = $this->isSameImage($value, $extras['cover']);

        // no modification
        if($isSame) {
            return;
        }

        $this->setThumbnails($value,$extras['cover'], $this->disk);

        $extras['cover'] = $this->setThumbnails($value, $this->image, $this->disk);

        $this->extras = $extras;

    }

    /*
    |--------------------------------------------------------------------------
    | NOTIFICATIONS && VARIABLES
    |--------------------------------------------------------------------------
    */

    public function sendCommentReplyOfNotification($token)
    {
        $this->notify(new CommentReplyOf($token));
    }

    /*
    |--------------------------------------------------------------------------
    | FUNCTIONS
    |--------------------------------------------------------------------------
    */

    /*
    |--------------------------------------------------------------------------
    | GARDES DE CANAL REVERB
    |--------------------------------------------------------------------------
    |
    | Consommés par src/routes/socializer/channels.php. Deux règles, load-bearing toutes
    | les deux :
    |
    | 1. En LECTURE, `execute()` ne lève JAMAIS : sur erreur nGQL il rend un JsonResponse —
    |    un OBJET, donc truthy (cf. NebulaGraphConnection::responseJson). Un
    |    `if($result) return true` transforme donc une panne de graphe en autorisation, et un
    |    `count($result)` sur ce même objet lève un TypeError, soit un 500 à la place d'un
    |    refus. D'où le verdict commun de `_checkCanJoin` / `_checkIsOwner` : ce qui n'est
    |    pas une réponse exploitable est un refus. Même motif que `followsMutually` plus bas,
    |    écrit là en premier.
    |    ⚠️ Vrai du chemin LECTURE seulement. Les 6 méthodes d'écriture DML, elles, LÈVENT une
    |    `NebulaGraphException` depuis E7 (22/08/2026) — asymétrie délibérée : faire lever les
    |    lectures rendrait ces branches inatteignables, donc un 500 à la place d'un 403.
    | 2. `canJoinRoom` n'est PAS un prédicat d'appartenance : sur `privacy == 0` sa clause est
    |    vraie pour n'importe quel couple, et une room publique VIDE refuse jusqu'à son
    |    propriétaire. Constat assumé — docs/modules/webrtc2/securite.md, piège 1.
    |    ⚠️ Ne PAS généraliser depuis ses sœurs : `canJoinchatRoom` est un prédicat
    |    d'appartenance depuis le 21/08/2026, `canJoinServer` depuis le 24/08/2026.
    | 3. `canJoinServer` lit l'appartenance dans MariaDB, les deux autres dans le graphe — et
    |    ce n'est pas une incohérence, c'est la règle : chaque donnée se lit chez son maître.
    |    L'appartenance à un GROUPE a MySQL pour maître, le graphe n'en est qu'un réplica ;
    |    l'inscription à un CHAT ou à un SALON n'existe que dans le graphe, qui en est le
    |    maître (il n'y a ni table `rooms` ni table `servers`). L'arête `registered_in` porte
    |    les deux sémantiques, la source de vérité n'est pas la même — E4.2, securite.md.
    |
    | Épinglé par tests/Feature/Channels/ChannelGuardTest.php.
    |
    */

    /**
     * L'utilisateur courant peut-il rejoindre ce chat ?
     *
     * ⚠️ `MATCH` et NON `OPTIONAL MATCH` : NebulaGraph 3.8 REFUSE un `OPTIONAL MATCH` porteur
     * d'un `WHERE` (« SyntaxError: Where clause in optional match is not supported »). Cette
     * requête ne s'exécutait donc jamais — et comme `execute()` rend un JsonResponse truthy sur
     * erreur, l'ancien `if($result)` en faisait une autorisation permanente. `channels.php`
     * n'autorisant le canal `chat.{chatId}` que par ce garde, tout authentifié s'abonnait à
     * n'importe quelle conversation privée. Forme désormais alignée sur celle de ses deux
     * jumelles ci-dessous, et contre-vérifiée contre un vrai graphe le 21/08/2026.
     *
     * Contrairement à elles, celui-ci EST un prédicat d'appartenance sur un chat privé. Sur
     * `privacy == 0` il reste ouvert à tous : c'est voulu, le chat d'un salon public l'est aussi.
     */
    public function canJoinchatRoom($vertex_id): bool
    {
       $result = app('nebulaGraph')->execute("
            MATCH (c:chat)<-[:registered_in]-(u:user)
            WHERE id(c) == '$vertex_id' AND (c.chat.privacy == 0 OR (c.chat.privacy == 1 AND id(u) == '$this->vertexid'))
            RETURN id(u)
        ");

        return $this->_checkCanJoin($result, 'canJoinchatRoom', $vertex_id);
    }

    /**
     * L'utilisateur courant peut-il rejoindre ce serveur ?
     *
     * ⚠️ **Chaque donnée est lue chez son maître, et c'est tout le correctif d'E4.2.** Le graphe
     * ne répond que de ce dont il est maître — la confidentialité du sommet serveur, et quel
     * groupe le possède. L'APPARTENANCE, elle, se lit dans MariaDB : le graphe n'en est qu'un
     * réplica, et chacun de ses trous de synchronisation y laisse une arête `registered_in` EN
     * TROP, jamais en moins. La dérive accordait, donc personne ne la signalait. Même décision que
     * `sharesGroupWith` le 15/08/2026, étendue ici le 24/08/2026 au dernier garde concerné.
     *
     * ⚠️ **DEUX colonnes, jamais une.** `NebulaGraphConnection::formatValues` effondre une ligne
     * d'une SEULE colonne sur sa valeur : alléger ce `RETURN` rendrait une liste plate de chaînes,
     * sur laquelle `$result[0]['privacy']` vaut `null` en silence. Le piège a déjà coûté un
     * serveur en double (`Services\Server::findGroupServerVertexId`).
     *
     * ⚠️ Un serveur SANS groupe — ceux de `createUserServer` — ne correspond à aucune ligne et
     * reste refusé, comme avant ce correctif : le motif `owned_by` manquait déjà.
     */
    public function canJoinServer($vertex_id): bool
    {
       $result = app('nebulaGraph')->execute("
            MATCH (s:server)-[:owned_by]->(g:group)
            WHERE id(s) == '$vertex_id'
            RETURN s.server.privacy AS privacy, id(g) AS group_vertexid
        ");

        if (! is_array($result)) {
            return $this->_refusSansReponse('canJoinServer', $vertex_id);
        }

        // Zéro ligne : le graphe a répondu « ce serveur n'existe pas, ou n'appartient à aucun
        // groupe ». C'est un refus légitime, pas une panne — donc pas de warning, même motif
        // que `_checkCanJoin`.
        if (! isset($result[0]['privacy'])) {
            return false;
        }

        // La confidentialité est une propriété du sommet : elle ne dépend d'aucune appartenance.
        // L'exiger était l'effet miroir du piège 1 — un serveur public VIDE refusait tout le
        // monde, son propriétaire compris.
        if ((int) $result[0]['privacy'] === 0) {
            return true;
        }

        $group_id = getRealIdFromVertexId($result[0]['group_vertexid'] ?? '', 'group');

        // Un vid né sous `uniqidReal()`, avant l'id dérivé, n'est pas reconstituable : il n'y a
        // aucune ligne MariaDB à interroger. Anomalie de réplica, donc journalisée — et refus,
        // parce qu'un identifiant illisible ne peut rien accorder.
        if (! $group_id) {
            return $this->_refusSansReponse('canJoinServer', $vertex_id);
        }

        return $this->isMemberOfGroup($group_id);
    }

    /**
     * Appartenance à UN groupe, lue dans MariaDB — la version à un seul utilisateur de
     * `sharesGroupWith`, dont elle reprend l'idiome et la clé de config.
     *
     * ⚠️ Requête directe et non `$this->groups()` : cette relation vit sur `EstarterUser`, d'un
     * paquet que le harnais de tests remplace par un stub qui lève.
     */
    private function isMemberOfGroup($group_id): bool
    {
        $table = config('socializer.signaling.relation.group_user_table', 'group_user');

        return DB::table($table)
            ->where('user_id', $this->getKey())
            ->where('group_id', $group_id)
            ->exists();
    }

    public function canJoinRoom($vertex_id): bool
    {
       $result = app('nebulaGraph')->execute("
            MATCH (r:room)<-[:registered_in]-(u:user)
            WHERE id(r) == '$vertex_id' AND (r.room.privacy == 0 OR (r.room.privacy == 1 AND id(u) == '$this->vertexid'))
            RETURN id(u)
        ");

        return $this->_checkCanJoin($result, 'canJoinRoom', $vertex_id);
    }

    /**
     * Verdict commun aux trois gardes `canJoin*`. Trois cas, à ne surtout pas confondre.
     *
     *  - Non-tableau ⇒ `execute()` a rendu un JsonResponse : le graphe est tombé. Refus ET
     *    `Log::warning`, parce qu'une panne d'infrastructure doit se voir. C'est ce cas qui a
     *    effectivement fermé la fuite de `canJoinchatRoom`, dont la requête n'était même pas
     *    valide.
     *  - Aucune ligne exploitable ⇒ le graphe a répondu « personne ne correspond ». Refus SANS
     *    warning : c'est un refus légitime, et journaliser chaque refus normal ferait crier le
     *    journal en continu, donc ne signalerait plus rien. (L'inverse de `followsMutually`,
     *    dont le `RETURN count(*) > 0` rend toujours une ligne — là, zéro ligne EST une panne.)
     *  - Au moins une ligne exploitable ⇒ accès accordé.
     *
     * ⚠️ Le verdict porte sur les lignes EXPLOITABLES et non sur leur nombre : une ligne à
     * `null` est le résidu d'un `OPTIONAL MATCH`, jamais une appartenance. C'est ce qui rend la
     * garde robuste à la réintroduction d'un `OPTIONAL MATCH` ici ou dans un garde futur.
     *
     * ⚠️ Mais il ne porte pas sur la VALEUR des lignes : filtrer sur `$this->vertexid` fermerait
     * tous les chats et salons publics, dont la clause `privacy == 0` fait remonter n'importe
     * quel inscrit.
     *
     * ⚠️ `$vertex_id` reste non typé : `Chat::addContactToConversation` lui passe un
     * `$request->get('chat')`, et un TypeError là serait un 500 au lieu d'un refus.
     */
    private function _checkCanJoin($result, string $guard, $vertex_id): bool
    {
        if (! is_array($result)) {
            return $this->_refusSansReponse($guard, $vertex_id);
        }

        return array_filter($result, static fn ($vertexid) => $vertexid !== null) !== [];
    }

    /**
     * Le refus par défaut, et son journal — partagé par les trois `canJoin*`.
     *
     * Extrait de `_checkCanJoin` le 24/08/2026 : `canJoinServer` a cessé de passer par ce verdict
     * commun (sa requête ne rend plus des vids mais deux colonnes), et le message comme le
     * contexte doivent rester identiques d'un garde à l'autre — c'est ce que le journal
     * d'exploitation attend, et ce que `ChannelGuardTest` épingle sur les trois gardes à la fois.
     */
    private function _refusSansReponse(string $guard, $vertex_id): bool
    {
        Log::warning($guard.' : le graphe n\'a pas répondu, refus par défaut', [
            'guard' => $guard,
            'vertex_id' => $vertex_id,
            'user_vertexid' => $this->vertexid,
        ]);

        return false;
    }

    public function isCreator($vertex_id)
    {
        $result = app('nebulaGraph')->execute("MATCH (s)-[:has_creator]->(u:user) WHERE id(s) == '$vertex_id' RETURN id(u)");
        return $this->_checkIsOwner($result); 
    }

    public function isServerOwner($server_id)
    {
        $result = app('nebulaGraph')->execute("MATCH (s:server)-[:owned_by]->(:group)-[:has_creator]->(u:user) WHERE id(s) == '$server_id' RETURN id(u)");
        return $this->_checkIsOwner($result); 
    }

    public function isWallOwner($vertex_id)
    {
        $result = app('nebulaGraph')->execute("MATCH (w:wall)-[:owned_by]->(u:user) WHERE id(w) == '$vertex_id' RETURN id(u)");
        return $this->_checkIsOwner($result); 
    }

    public function isFeedOwner($vertex_id)
    {
        $result = app('nebulaGraph')->execute("MATCH (f:feed)-[:owned_by]->(u:user) WHERE id(f) == '$vertex_id' RETURN id(u)");
        return $this->_checkIsOwner($result); 
    }

    public function isRoomOwner($vertex_id)
    {
        $result = app('nebulaGraph')->execute("MATCH (r:room)-[:has_creator]->(u:user) WHERE id(r) == '$vertex_id' RETURN id(u)");
        return $this->_checkIsOwner($result); 
    }

    /**
     * Verdict commun aux cinq gardes de propriété ci-dessus.
     *
     * ⚠️ `is_array()` AVANT tout accès : `count()` sur le JsonResponse que rend `execute()` en
     * cas d'erreur nGQL lève un TypeError — donc un 500 là où un refus était attendu. Ce n'était
     * pas atteignable tant que `canJoinRoom` était fail-open : sur les canaux `room.` et
     * `questionnaire.`, `isCreator` est le SECOND terme d'un `||` qui ne s'évaluait jamais sur
     * panne. Rendre `canJoinRoom` fail-closed sans durcir ceci aurait donc simplement échangé un
     * accès accordé à tort contre une erreur 500.
     *
     * ⚠️ `isset($result[0])` et non `count($result)` : `phpunit.xml` porte `failOnWarning`, et un
     * « Undefined array key 0 » suffit à faire sortir la suite en erreur.
     *
     * Comparaison lâche conservée telle quelle : les vids sont des chaînes rendues par le graphe,
     * la resserrer serait un changement de comportement déguisé en durcissement.
     */
    private function _checkIsOwner($result): bool
    {
        if (! is_array($result)) {
            Log::warning('Garde de propriété : le graphe n\'a pas répondu, refus par défaut', [
                'guard' => '_checkIsOwner',
                'user_vertexid' => $this->vertexid,
            ]);

            return false;
        }

        if (! isset($result[0])) {
            return false;
        }

        return $result[0] == $this->vertexid;
    }

    /*
    |--------------------------------------------------------------------------
    | GARDE DE RELATION (C2)
    |--------------------------------------------------------------------------
    |
    | Qui a le droit de signaler qui. Posé sur les 5 routes de signalisation WebRTC2 —
    | c'est la version AUTORITATIVE du garde sortant `isAuthorizedPeer` du client, et la
    | seule fermeture possible de l'usurpation intra-room : côté navigateur, le cas
    | nominal et l'attaque ont la même signature locale.
    |
    | Règle produit tranchée le 15/08/2026 : « follow mutuel OU contexte partagé ».
    |
    | ⚠️ Ne PAS confondre avec `canJoinRoom` / `canJoinServer` ci-dessus : ce sont des gardes
    | de canal Reverb, pas des prédicats d'appartenance (sur `privacy == 0` ils répondent
    | `true` à tout le monde). Les réutiliser ici rendrait le garde contournable en nommant
    | une room publique. Le pourquoi : docs/modules/webrtc2/securite.md, « Deux pièges du
    | graphe que ce garde contourne ». `canJoinchatRoom`, elle, exige l'appartenance depuis
    | le 21/08/2026.
    |
    */

    /**
     * L'utilisateur courant a-t-il le droit de signaler `$other` ?
     *
     * Symétrique — ses deux jambes le sont. C'est ce qui règle la route de réponse sans
     * traitement particulier : l'invitation d'appel est un broadcast fire-and-forget, rien
     * n'est persisté côté serveur, donc `responseToPeerAuthorization` n'a rien contre quoi
     * se valider. Avec une relation asymétrique il aurait fallu l'inverser (« mon
     * interlocuteur aurait-il eu le droit de m'appeler ? ») — une seconde règle à tenir juste.
     */
    public function mayReach($other): bool
    {
        if (! $other) {
            return false;
        }

        // Multi-onglet : un même utilisateur se signale d'un onglet à l'autre.
        if ((string) $this->getKey() === (string) $other->getKey()) {
            return true;
        }

        return Cache::remember(
            static::relationCacheKey($this->getKey(), $other->getKey()),
            config('socializer.signaling.relation.cache_ttl', 60),
            // Le groupe d'abord : une requête SQL indexée sur une connexion déjà ouverte,
            // là où le graphe coûte un aller-retour Thrift synchrone.
            fn () => $this->sharesGroupWith($other) || $this->followsMutually($other)
        );
    }

    /**
     * Clé de mémorisation d'une PAIRE, pas d'un sens : `mayReach` étant symétrique, les
     * deux sens partagent une entrée. Publique et statique parce que `Users::followUser`
     * doit pouvoir l'oublier sans dupliquer sa construction.
     */
    public static function relationCacheKey($a, $b): string
    {
        $ids = [(string) $a, (string) $b];
        sort($ids);

        return 'socializer:may-reach:'.$ids[0].':'.$ids[1];
    }

    /**
     * Appartenance à un même groupe, lue dans MariaDB.
     *
     * ⚠️ Pourquoi pas le graphe : MariaDB est le maître, le graphe un réplica — synchronisé à
     * l'attachement et au détachement, mais pas par les chemins qui n'émettent aucun événement
     * Eloquent, ni quand l'écriture de réplica échoue (`ToleratesGraphFailure` la tolère par
     * décision). Chacun de ces trous laisse une arête EN TROP, donc la dérive ACCORDE. Détail et
     * conséquences : docs/modules/webrtc2/securite.md, piège 2. Décision du 15/08/2026, tenue
     * depuis — et **`canJoinServer` l'a rejointe le 24/08/2026 (E4.2)** : plus aucun garde ne lit
     * l'appartenance à un groupe dans le graphe.
     *
     * ⚠️ Deux `GroupUserCreatedListener` homonymes sont abonnés à l'événement ; celui d'estarter
     * est mort, celui de ce paquet écrit l'arête. Lire le premier fait conclure à tort que rien ne
     * se propage — l'erreur a déjà coûté une tâche de plan entière (16 → 18/08/2026).
     *
     * ⚠️ Requête directe et non `$this->groups()` : cette relation vit sur `EstarterUser`,
     * d'un paquet que le harnais de tests remplace par un stub qui lève.
     */
    private function sharesGroupWith($other): bool
    {
        $table = config('socializer.signaling.relation.group_user_table', 'group_user');

        return DB::table($table.' as a')
            ->join($table.' as b', 'a.group_id', '=', 'b.group_id')
            ->where('a.user_id', $this->getKey())
            ->where('b.user_id', $other->getKey())
            ->exists();
    }

    /**
     * Follow réciproque, lu dans le graphe — seule source de l'arête `followed_by`.
     *
     * Direction : `followUser` écrit `wall_de_la_cible -> suiveur`, donc
     * `wa -[:followed_by]-> b` se lit « b suit a ». Les deux motifs sont donc les deux sens.
     *
     * N'emploie que des constructions attestées en production — `MATCH` multi-motifs séparés
     * par virgule (`Feed.php`) et `RETURN count(*) > 0 AS x` (`isFollowedBy`). Évite
     * délibérément `wall()`, qui fait `return $wall[0]` et plante sur un utilisateur sans mur.
     */
    private function followsMutually($other): bool
    {
        $from = $this->vertexid;
        $to = $other->vertexid;

        $result = app('nebulaGraph')->execute("
            MATCH (wa:wall)-[:owned_by]->(a:user), (wa)-[:followed_by]->(b:user),
                  (wb:wall)-[:owned_by]->(b), (wb)-[:followed_by]->(a)
            WHERE id(a) == '$from' AND id(b) == '$to'
            RETURN count(*) > 0 AS mutual
        ");

        // `execute()` renvoie un JsonResponse — un OBJET, donc truthy — quand nGQL échoue
        // (cf. NebulaGraphConnection::responseJson, qui ne lève pas). Sur un chemin
        // d'autorisation, tout ce qui n'est pas une réponse exploitable est un refus.
        if (! is_array($result) || ! isset($result[0])) {
            Log::warning('mayReach : le graphe n\'a pas répondu, refus par défaut', [
                'from_vertexid' => $from,
                'to_vertexid' => $to,
            ]);

            return false;
        }

        return (bool) $result[0];
    }

    /**
     * Version EN LOT de `mayReach` : les vertexids de tous ceux que cet utilisateur peut
     * atteindre. Sert la liste de contacts (`Users::visibleUsers`), qui filtre N candidats — N
     * appels à `mayReach` coûteraient N allers-retours Thrift sur cache froid, un par jambe
     * follow.
     *
     * ⚠️ MÊME RÈGLE, MÊMES SOURCES QUE `mayReach`, et c'est l'invariant à tenir : groupe commun
     * dans MariaDB OU follow réciproque dans le graphe, plus soi-même (multi-onglet). Une
     * divergence entre le lot et l'unitaire referait ce que C5 puis E5 ont corrigé ailleurs —
     * une interface qui propose ce que le serveur refuse, ou qui cache ce qu'il accorde.
     * `UserListScopeTest::le_lot_dit_la_meme_chose_que_le_predicat_unitaire` la surveille.
     *
     * ⚠️ N'utilise PAS le cache de `mayReach` et ne l'alimente pas : ses entrées sont des
     * verdicts de PAIRE, oubliés à l'unité par `Users::followUser`. Y verser un lot obligerait
     * à savoir quelles paires invalider quand une seule relation change.
     *
     * @return array<string, true> indexé par vertexid — la liste se lit à l'`isset`.
     */
    public function reachableVertexIds(): array
    {
        $reachable = [$this->vertexid => true];

        foreach ($this->groupPeers() as $peer) {
            $reachable[$peer->vertexid] = true;
        }

        foreach ($this->mutualFollowVertexIds() as $vertexid) {
            $reachable[$vertexid] = true;
        }

        return $reachable;
    }

    /**
     * Jambe MariaDB en lot : les utilisateurs partageant au moins un groupe.
     *
     * ⚠️ Deux requêtes et non une, parce que **le vertexid ne se déduit pas d'un `user_id`** :
     * `getVertexId()` rend la colonne `vertexid` quand elle existe et retombe sinon sur
     * `<tag><id>`. La production n'a pas cette colonne, le stub du harnais l'a — reconstruire
     * `'user'.$id` à la main marcherait donc en production et mentirait en test. Passer par le
     * modèle prend le même chemin que partout ailleurs.
     *
     * Requête directe sur le pivot pour la même raison que `sharesGroupWith` : `groups()` vit
     * sur `EstarterUser`, d'un paquet que le harnais remplace par un stub qui lève.
     *
     * @return Collection<int, static>
     */
    private function groupPeers(): Collection
    {
        $table = config('socializer.signaling.relation.group_user_table', 'group_user');

        $peer_ids = DB::table($table.' as a')
            ->join($table.' as b', 'a.group_id', '=', 'b.group_id')
            ->where('a.user_id', $this->getKey())
            ->where('b.user_id', '!=', $this->getKey())
            ->distinct()
            ->pluck('b.user_id');

        if ($peer_ids->isEmpty()) {
            return collect();
        }

        return static::query()->whereIn($this->getKeyName(), $peer_ids)->get();
    }

    /**
     * Jambe graphe en lot : les follows réciproques, en une requête.
     *
     * Même motif que `followsMutually`, la contrainte sur `b` en moins — donc la même direction
     * d'arête, décrite dans son docblock. Pas de `RETURN DISTINCT` : seul `count(DISTINCT x)`
     * est attesté en production, et l'indexation par vertexid de `reachableVertexIds` dédoublonne
     * de toute façon.
     *
     * ⚠️ Une requête nGQL à UNE colonne rend une liste PLATE de valeurs, pas des lignes
     * associatives (`NebulaGraphConnection::formatValues`). Le confondre a déjà créé un serveur
     * en trop sur le dev, suite verte : la doublure rend la forme qu'on lui script, cf.
     * `docs/architecture/tests.md`, « la doublure rend la FORME qu'on lui script ».
     *
     * Refus par défaut identique à `followsMutually` : une réponse inexploitable ne rend aucun
     * joignable — la liste se resserre, elle ne s'ouvre pas. La jambe groupe, elle, tient encore.
     *
     * @return array<int, string>
     */
    private function mutualFollowVertexIds(): array
    {
        $from = $this->vertexid;

        $result = app('nebulaGraph')->execute("
            MATCH (wa:wall)-[:owned_by]->(a:user), (wa)-[:followed_by]->(b:user),
                  (wb:wall)-[:owned_by]->(b), (wb)-[:followed_by]->(a)
            WHERE id(a) == '$from'
            RETURN id(b) AS reachable_vertexid
        ");

        if (! is_array($result)) {
            Log::warning('reachableVertexIds : le graphe n\'a pas répondu, jambe follow ignorée', [
                'from_vertexid' => $from,
            ]);

            return [];
        }

        return array_filter($result, 'is_string');
    }

    /*
    |--------------------------------------------------------------------------
    | RELATIONS
    |--------------------------------------------------------------------------
    */

    public function posts(): MorphMany
    {
        return $this->morphMany(Post::class, 'model_type', 'model_id');
    }

    public function wall()
    {
        $wall = app('nebulaGraph')->execute("
            MATCH (w:wall)-[:owned_by]->(u:user) 
            WHERE id(u) == '$this->vertexid' 
            RETURN id(w)
        ");

        return $wall[0];
    }

    public function feed()
    {
        $feed = app('nebulaGraph')->execute("
            MATCH (f:feed)-[:owned_by]->(u:user) 
            WHERE id(u) == '$this->vertexid' 
            RETURN id(f)
        ");

        return $feed[0];
    }

    public function conversations($type = 'contacts')
    {
        $is_bot = $type == 'contacts' ? 0 : 1;
        
        $conversations = app('nebulaGraph')->execute("
            MATCH (u:user)-[:registered_in]->(c:chat)
            WHERE id(u) == '$this->vertexid' AND c.chat.is_bot == $is_bot
            OPTIONAL MATCH (c)-[:published_in]->(v)
            WITH c, collect(v) AS other_targets, c.chat.created_at AS created_at 
            WHERE size(other_targets) == 0
            WITH c, other_targets, created_at
            ORDER BY created_at DESC 
            RETURN c
        ");

        return $conversations;
    }

    public function servers()
    {
        $servers = app('nebulaGraph')->execute("
            MATCH (s:server)<-[:registered_in]-(u:user) WHERE id(u)=='$this->vertexid' RETURN s
        ");

        return $servers;
    }

    
    public function ownedServers()
    {
        $servers = app('nebulaGraph')->execute("
            MATCH (s:server)-[:has_creator]-(u:user) WHERE id(u)=='$this->vertexid' RETURN s
        ");

        return $servers;
    }

    /*
    |--------------------------------------------------------------------------
    | SCOPES
    |--------------------------------------------------------------------------
    */


    /*
    |--------------------------------------------------------------------------
    | ACCESORS
    |--------------------------------------------------------------------------
    */

    /**
     * Nebulagraph vertex ID
     */
    public function getVertexIdAttribute()
    {
        return getVertexId($this);
    }

    /*
    |--------------------------------------------------------------------------
    | MUTATORS
    |--------------------------------------------------------------------------
    */


}