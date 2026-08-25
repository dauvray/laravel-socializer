<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Dauvray\Socializer\app\Exceptions\NebulaGraphException;
use Dauvray\Socializer\app\Http\Resources\UserCollection;

class Users
{
    public $nebula = null;
    public $user = null;
    public $onlineService = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->user = Auth::user();
        $this->onlineService = app('onlineUsers');
    }

    public function getGraphUser($user)
    {
        $me = Auth::user();

        $is_me = $me->vertexid === $user->vertexid;

        // Verdict de la règle de relation (C2), calculé AVANT que `$user` ne soit écrasé plus
        // bas par la réponse du graphe. C'est le prédicat que les 5 routes de signalisation
        // appliquent déjà : le profil ne fait que le rendre visible, pour que le bouton
        // d'appel cesse de proposer un appel qui partira en 403.
        //
        // ⚠️ UX seulement — le serveur reste l'autorité. Masquer le bouton n'est PAS un
        // contrôle : la route refuse de toute façon.
        $may_reach = $me->mayReach($user);

        // recupere le user et le nombre de followers
        $query = "
            MATCH (u:user {active: 1}) where id(u) == '$user->vertexid' 
            OPTIONAL MATCH (u)<-[:owned_by]-(w:wall)-[nbf:followed_by]->(:user)
            ";

        // si ce n'est pas moi, on verifie si je le suis
        if(!$is_me) {
            $query .= "
            MATCH (current_user:user) where id(current_user) == '$me->vertexid'
            OPTIONAL MATCH (w)-[f:followed_by]->(current_user)
            ";
        }

        $query .= "
            RETURN u AS user, COUNT(nbf) as nb_followers
            ";

        if(!$is_me) {
            $query .= "
            , CASE WHEN f IS NULL THEN NULL ELSE 'followed' END AS follow_status
            ";
        }

        $user = app('nebulaGraph')->execute($query);

        // format
        $user[0]['user']['nb_followers'] = $user[0]['nb_followers'];
        $user[0]['user']['may_reach'] = $may_reach;

        if(!$is_me) {
            $user[0]['user']['follow_status'] = $user[0]['follow_status'];
        }

        return $user[0]['user'];
    }

    public function getUsersList($route_name = '')
    {
        $paginator = makePaginationCollection(collect($this->visibleUsers()), route($route_name));

        return new UserCollection($paginator);
    }

    /**
     * Les utilisateurs que l'appelant a le droit de voir listés, avant pagination.
     *
     * **Périmètre tranché le 25/08/2026 (E3)** : `list_users` voit tout le monde, les autres ne
     * voient que les JOIGNABLES au sens de `mayReach` — la règle même que les 5 routes de
     * signalisation appliquent. Jusqu'ici la route rendait tous les utilisateurs actifs à tout
     * authentifié, son contrôle de permission étant commenté : une énumération plus directe que
     * le sondage de slugs, fermé par C2.
     *
     * ⚠️ Le périmètre se décide ICI et non dans le contrôleur : la permission ne refuse pas la
     * route, elle en change l'étendue. `UserController::getUsersList` n'a donc rien à trancher.
     *
     * ⚠️ Publique et séparée de `getUsersList` pour une raison de harnais, pas de style :
     * `makePaginationCollection()` est un helper d'`innovation/laravel-estarter`, paquet absent
     * de la suite PHP d'ici (cf. `tests/TestCase`) — appeler `getUsersList()` en test lèverait
     * « undefined function », alors que c'est le périmètre qu'il faut épingler.
     *
     * @return array<int, object>
     */
    public function visibleUsers(): array
    {
        $formated = [];

        $results = app('nebulaGraph')->execute("
            MATCH (u:user {active: 1})
            MATCH (current_user:user) where id(current_user) == '".$this->user->vertexid."'
            OPTIONAL MATCH (u)<-[:owned_by]-(:wall)-[f:followed_by]->(current_user)
            OPTIONAL MATCH (u)<-[:owned_by]-(:wall)-[nbf:followed_by]->(:user)
            RETURN u AS user, CASE WHEN f IS NULL THEN NULL ELSE 'followed' END AS follow_status, COUNT(nbf) as nb_followers
        ");

        // `execute()` rend un JsonResponse — un objet, donc truthy — quand nGQL échoue sur une
        // LECTURE (cf. E4.1). Sans ce garde, le `foreach` ci-dessous itère le seul attribut
        // PUBLIC de la réponse Symfony (`$headers`) et `$res['user']` lève « Cannot use object
        // of type ResponseHeaderBag as array » : une panne du graphe rendait donc un 500 opaque,
        // ce qu'E4.1 a fermé partout ailleurs. Elle rend désormais une liste vide et une ligne
        // de journal. ⚠️ Constaté en retirant le garde, pas déduit : la lecture seule concluait
        // « il itère zéro propriété, donc liste vide ».
        if (! is_array($results)) {
            Log::warning('getUsersList : le graphe n\'a pas répondu, liste vide', [
                'user_vertexid' => $this->user->vertexid,
            ]);

            return [];
        }

        // `null` = aucun filtre. Calculé AVANT la boucle et une seule fois : deux requêtes pour
        // toute la liste, là où `mayReach` par candidat en coûterait deux par ligne. Et pas
        // calculé du tout pour un privilégié, qui ne paie donc pas le prédicat.
        $reachable = $this->user->can('list_users') ? null : $this->user->reachableVertexIds();

        foreach ($results as $res) {
            $user = $res['user'];

            // Sur le vertexid, avant que la ligne suivante ne l'écrase par l'id MySQL : c'est la
            // clé que le graphe et `reachableVertexIds` ont en commun.
            if ($reachable !== null && ! isset($reachable[$user['id']])) {
                continue;
            }

            $user['id'] = getRealIdFromVertexId($user['id']);
            $user['follow_status'] = $res['follow_status'];
            $user['nb_followers'] = $res['nb_followers'];
            $formated[] = (object) $user;
        }

        return $formated;
    }

    /**
     * @return bool `false` si le graphe a refusé l'écriture — `UserController` en fait un 500.
     *
     * Le `if (count($result) === 0)` d'avant E7 ne testait rien d'utile : une écriture RÉUSSIE
     * rend `[]`, donc `count()` valait 0 et la méthode rendait `true` ; la branche `return false`
     * n'était jamais prise. Et sur un refus, `$result` valait un `JsonResponse` — `count()` sur un
     * objet lève un `TypeError`, soit un 500 opaque au lieu d'un refus lisible.
     */
    public function followUser($user_tofollow): bool
    {
        $wall_id = $user_tofollow->wall();

        try {
            setFollowedByRelation($wall_id, $this->user->vertexid);
        } catch (NebulaGraphException $e) {
            Log::warning('followUser : le graphe a refusé l\'arête de suivi', $e->context() + [
                'wall_vertexid' => $wall_id,
                'user_vertexid' => $this->user->vertexid,
            ]);

            return false;
        }

        // Seulement après une écriture confirmée : invalider un verdict que le graphe n'a pas
        // changé ferait recalculer la même réponse au prix d'un aller-retour de plus.
        $this->forgetRelationVerdict($user_tofollow);

        return true;
    }

    /** @return bool Cf. `followUser` pour le contrat. */
    public function unfollowUser($user_followed): bool
    {
        $wall_id = $user_followed->wall();

        try {
            $this->nebula->deleteEdge(
                config('socializer.nebulagraph.edges.followed_by.name'),
                [
                    $wall_id.'->'.$this->user->vertexid
                ]
            );
        } catch (NebulaGraphException $e) {
            Log::warning('unfollowUser : le graphe a refusé le retrait de l\'arête de suivi', $e->context() + [
                'wall_vertexid' => $wall_id,
                'user_vertexid' => $this->user->vertexid,
            ]);

            return false;
        }

        $this->forgetRelationVerdict($user_followed);

        return true;
    }

    /**
     * Oublie le verdict mémorisé par `Socializable::mayReach` pour cette paire.
     *
     * Un follow qui ne l'invaliderait pas ne débloquerait l'appel qu'au bout du TTL. C'est
     * le sens qui compte : une AUTORISATION périmée n'est qu'une fenêtre bornée, un REFUS
     * périmé est un bouton qui échoue juste après qu'on s'est abonné.
     */
    private function forgetRelationVerdict($other): void
    {
        Cache::forget(
            config('estarter.models.user')::relationCacheKey($this->user->getKey(), $other->getKey())
        );
    }

    /**
     * Le sommet d'un groupe, son rattachement à son parent, et son créateur.
     *
     * Le sommet porte un id DÉRIVÉ (`group12`), donc `INSERT VERTEX IF NOT EXISTS` rend l'appel
     * idempotent : le reposer rafraîchit ses propriétés sans jamais en créer un second. Les arêtes
     * le sont aussi, NebulaGraph les clefant sur (source, type, rang, destination).
     *
     * ⚠️ `$owner` est nullable pour que la PROJECTION puisse jouer cette étape en console, où
     * `Auth::user()` rend `null` — le propriétaire y est résolu depuis MySQL
     * (`GraphProjection::resolveGroupOwner`). Sans propriétaire, le sommet et le rattachement au
     * parent sont posés quand même et seul `has_creator` est sauté : les arêtes `registered_in` des
     * utilisateurs visent déjà ce sommet, ne pas le poser coûterait plus que de le laisser sans
     * créateur. Le refus est journalisé, jamais silencieux.
     *
     * @param  mixed  $group  le modèle de `config('estarter.models.group')`
     * @param  mixed|null  $owner  à défaut, l'utilisateur authentifié
     * @return string le vertexid du groupe
     */
    public function createGroup($group, $owner = null)
    {
        if (!$owner) {
            $owner = $this->user;
        }

        $group_id = getVertexId($group);

        $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.group.name'),
            array_merge(
                $this->nebula->populatePropsFromPattern(
                    $group,
                    config('socializer.nebulagraph.vertices.group')
                ),
                [
                    'identifier' => hideIdentifier($group),
                    'id' => $group_id
                ]
            )
        );

        // groupe / parent groupe relation
        setGroupHasParentRelation($group);

        // groupe / creator relation
        if ($owner) {
            setHasCreatorRelation($group_id, $owner->vertexid);
        } else {
            Log::warning('createGroup : aucun propriétaire résolu, groupe projeté sans créateur', [
                'group_id' => $group->id,
                'group_vertexid' => $group_id,
            ]);
        }

        return $group_id;
    }

    public function deleteGroup($group) {
        return app('nebulaGraph')->deleteVertex([getVertexId($group)], true);
    }
}