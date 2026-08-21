<?php

namespace Dauvray\Socializer\app\Helpers\ModelTraits;

use Cviebrock\EloquentSluggable\Sluggable;
use Cviebrock\EloquentSluggable\SluggableScopeHelpers;
use Dauvray\Socializer\app\Notifications\CommentReplyOf;
use Illuminate\Database\Eloquent\Relations\MorphMany;
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
    | 1. `execute()` ne lève JAMAIS : sur erreur nGQL il rend un JsonResponse — un OBJET,
    |    donc truthy (cf. NebulaGraphConnection::responseJson). Un `if($result) return true`
    |    transforme donc une panne de graphe en autorisation, et un `count($result)` sur ce
    |    même objet lève un TypeError, soit un 500 à la place d'un refus. D'où le verdict
    |    commun de `_checkCanJoin` / `_checkIsOwner` : ce qui n'est pas une réponse
    |    exploitable est un refus. Même motif que `followsMutually` plus bas, écrit là en
    |    premier.
    | 2. `canJoinRoom` / `canJoinServer` ne sont PAS des prédicats d'appartenance : sur
    |    `privacy == 0` la clause est vraie pour n'importe quel couple. Constat assumé, hors
    |    périmètre du correctif du 21/08/2026 — docs/modules/webrtc2/securite.md, piège 1.
    |    `canJoinchatRoom`, elle, l'est depuis cette date.
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

    public function canJoinServer($vertex_id): bool
    {
       $result = app('nebulaGraph')->execute("
            MATCH (u:user)-[:registered_in]->(g:group)<-[:owned_by]-(s:server)
            WHERE id(s) == '$vertex_id' AND (s.server.privacy == 0 OR (s.server.privacy == 1 AND id(u) == '$this->vertexid'))
            RETURN id(u)
        ");

        return $this->_checkCanJoin($result, 'canJoinServer', $vertex_id);
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
            Log::warning($guard.' : le graphe n\'a pas répondu, refus par défaut', [
                'guard' => $guard,
                'vertex_id' => $vertex_id,
                'user_vertexid' => $this->vertexid,
            ]);

            return false;
        }

        return array_filter($result, static fn ($vertexid) => $vertexid !== null) !== [];
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
     * ⚠️ Pourquoi pas le graphe, alors que `canJoinServer` y lit la même notion : MariaDB est le
     * maître, le graphe un réplica — synchronisé à l'attachement et au détachement, mais pas par
     * la cascade SQL de `group_user`, qui laisse l'arête. Détail et conséquences :
     * docs/modules/webrtc2/securite.md, piège 2. Décision du 15/08/2026, tenue depuis.
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