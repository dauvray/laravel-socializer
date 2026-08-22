<?php

use Dauvray\Socializer\app\Helpers\ContentFormater;
use Illuminate\Support\Facades\Auth;
use \Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Log;

if (!function_exists('formatTextToContent')) {
    function formatTextToContent($text) {
        $helper = new ContentFormater($text);
        $content = str_replace(["\r\n", "\r", "\n"], "", $helper->getContent());
        return [
            'src' => $text,
            'content' => $content,
            'hashtags' => $helper->getHashtags(),
            'mentions' => $helper->getMentions(),
            'thumbnails' => $helper->getThumbnails(),
        ];
    }
}

/*
 * `filterSensibleDataUserRessource()` a vécu ici jusqu'à E9 (22/08/2026). C'était une LISTE NOIRE
 * sur `Resources\User`, et elle laissait passer `groups` (avec `server_id`) et
 * `unreadNotifications` vers tous les membres d'un chat. Les charges utiles d'auteur passent
 * désormais par `Resources\MessageAuthor`, une liste blanche.
 */

if (!function_exists('broadcastEventbusNotification')) {
    function broadcastEventbusNotification($user_id, $payload = []) {
        try {
            Broadcast::private('App.Models.User.'.$user_id)
            ->as('EventBusNotification')
            ->with([
                'type' => 'prompt_request_completed',
                'payload' => $payload,
            ])
            ->sendNow();
        }
            catch (\Exception $ex) {
            return $ex;
        }
    }
}

/*---------------------------
| NEBULAGRAPH
|----------------------------*/

if (!function_exists('makeNebulaPagination')) {
    function makeNebulaPagination(
        string $matchQuery,    // ton MATCH ... WHERE ...
        string $returnClause,  // ton RETURN ...
        string $orderBy = '',  // ORDER BY ...
        string $path = '',
        int $defaultPage = 1,
        ?int $perPage = null
    ) {
        $page    = request('page', $defaultPage);
        $perPage = $perPage ?? config('settings.items_by_pages');

        // 1️⃣ Query pour compter le total
        $countQuery = "
            $matchQuery
            RETURN count(*) AS total
        ";

        $totalResult = app('nebulaGraph')->execute($countQuery);

        // 2️⃣ Query paginée
        $pagedQuery = "
            $matchQuery
            $returnClause
            " . ($orderBy ? "ORDER BY $orderBy" : "") . "
            LIMIT $perPage
        ";

        $pagedResult = app('nebulaGraph')->execute($pagedQuery);
        $results = collect($pagedResult);

        // 3️⃣ Retour paginator
        return new LengthAwarePaginator(
            $results,
            $totalResult[0],
            $perPage,
            $page,
            ['path' => $path]
        );
    }
}

if (!function_exists('getVertexId')) {
    function getVertexId($item)
    {
        $exists = property_exists((object)$item->getAttributes(), 'vertexid');
        if($exists) {
            return $item->getAttributes()['vertexid'];
        }

        $class_name = getClassNameFromNamespace($item);
        return config('socializer.nebulagraph.tags.'. strtolower($class_name) .'.name') . $item->id;
    }
}

if (!function_exists('getNextPositionItem')) {
    function getNextPublishedPosition($vertex_id)
    {
        if(!$vertex_id) {
            return 0;
        }
        $result = app('nebulaGraph')->execute("MATCH (s)<-[:published_in]-(r) WHERE id(s) == '$vertex_id' RETURN COUNT(r)");
        return $result[0];
    }
}

if (!function_exists('getVertexIdFromInsert')) {
    function getVertexIdFromInsert($result)
    {
        $item = explode(':', $result[0]);
        return str_replace('"', '', $item[0]);
    }
}

if (!function_exists('getRealIdFromVertexId')) {
    function getRealIdFromVertexId($vertex_id, $tag ='user')
    {
        $tag = config('socializer.nebulagraph.tags.' . $tag . '.name');
        if(strpos($vertex_id, $tag) === 0) {
            return str_replace($tag, '', $vertex_id);
        }

        return null;
    }
}

if (!function_exists('getFeedFollowers')) {
    function getFeedFollowers($feedVertexId, $except_me = false) {
        if(!$except_me) {
            $followers = app('nebulaGraph')->execute("
                MATCH (feed_dest:feed)-[:owned_by]->(u:user)<-[:followed_by]-(w:wall) 
                WHERE id(w) == '$feedVertexId' 
                RETURN feed_dest, u as user
            ");
        } else {
            $user = Auth::user();
            $followers = app('nebulaGraph')->execute("
                MATCH (feed_dest:feed)-[:owned_by]->(u:user)<-[:followed_by]-(w:wall) 
                WHERE id(w) == '$feedVertexId' AND id(u) != '$user->vertexid'
                RETURN feed_dest, u as user
            ");
        }

        return $followers;
    }
}

if (!function_exists('getUserNetworkVertexIds')) {
    /**
     * Les sommets `feed` et `wall` DÉJÀ projetés pour cet utilisateur.
     *
     * nGQL exige un `MATCH` avant tout `OPTIONAL MATCH`, d'où l'ancrage sur `(u:user)` : la requête
     * ne rend donc rien tant que le sommet utilisateur n'existe pas — ce qui est le bon sens de
     * lecture, `createUserAndNetwork` le posant en premier.
     *
     * Le mur et le feed d'un utilisateur sont uniques par construction (cf. `createUserAndNetwork`).
     * Sur une base d'avant E9 qui en porterait plusieurs, la première ligne rendue par le graphe
     * gagne : c'est ce qu'il faut pour que le rattrapage n'en crée pas un de plus.
     *
     * @return array{feed: ?string, wall: ?string} `null` pour ce qui reste à créer
     */
    function getUserNetworkVertexIds($user_vertex_id): array
    {
        $result = app('nebulaGraph')->execute("
            MATCH (u:user) WHERE id(u) == '$user_vertex_id'
            OPTIONAL MATCH (f:feed)-[:owned_by]->(u)
            OPTIONAL MATCH (w:wall)-[:owned_by]->(u)
            RETURN id(f) AS feed, id(w) AS wall
        ");

        return [
            'feed' => $result[0]['feed'] ?? null,
            'wall' => $result[0]['wall'] ?? null,
        ];
    }
}

if (!function_exists('createUserAndNetwork')) {
    /**
     * Projette l'utilisateur et son réseau (feed, mur, arêtes) dans le graphe.
     *
     * **Idempotente depuis E9 : un utilisateur a UN feed et UN mur, quel que soit le nombre
     * d'appels.** Deux verrous, et il faut les deux :
     *
     *  1. le réseau déjà projeté est RELU et réutilisé. Seul verrou qui rattrape les sommets nés
     *     avant E9, dont l'`uniqidReal()` n'est pas reconstituable ;
     *  2. les sommets neufs portent un id DÉRIVÉ de l'utilisateur (`feed12`, `wall12`), donc
     *     `INSERT VERTEX IF NOT EXISTS` refuse d'en poser un second — y compris quand deux appels
     *     concurrents ont tous deux lu « pas de mur » avant que l'autre n'écrive, ce que le verrou
     *     1, un lire-puis-écrire, ne peut pas garantir seul.
     *
     * Le verrou 2 SEUL serait pire que rien : il poserait `wall12` à côté du mur aléatoire existant.
     *
     * Les arêtes n'ont jamais eu besoin de garde : NebulaGraph les clefe sur
     * (source, type, rang, destination), un second `INSERT EDGE` réécrit la même.
     *
     * CE QUE ÇA RÉPARE. `insertVertex('feed', [])` tirait un `uniqidReal()` neuf à chaque passage,
     * donc les deux appelants qui projettent une base entière — la migration `create_nebula` et
     * `socializer:nebula-populate`, dont le déroulé prévu est « installer puis rattraper » —
     * donnaient 2 murs et 2 feeds par utilisateur. Un mur de trop n'est pas qu'un compteur faux
     * (l'auto-abonnement ci-dessous est compté deux fois par le `COUNT(nbf)` de `Services\Users`,
     * que le front corrige d'un `- 1` en dur) : c'est surtout `Socializable::wall()` qui rend
     * `$wall[0]` sur deux lignes SANS `ORDER BY`, donc un follow, une publication et sa
     * distribution qui peuvent atterrir sur deux murs du même utilisateur.
     */
    function createUserAndNetwork($user) {
        $nebula = app('nebulaGraph');
        $userVertexId = $user->vertexid;

        /*
        | VERTEX
        */

        // create user vertex
        $nebula->insertVertex(
            config('socializer.nebulagraph.tags.user.name'),
            array_merge(
                $nebula->populatePropsFromPattern(
                    $user,
                    config('socializer.nebulagraph.vertices.user')
                ),
                [
                    'identifier' => hideIdentifier($user)
                ]
            )
        );

        $existing = getUserNetworkVertexIds($userVertexId);

        // create user feed vertex
        $feedVertexId = $existing['feed'] ?? getVertexIdFromInsert($nebula->insertVertex(
            config('socializer.nebulagraph.tags.feed.name'),
            [
                'id' => config('socializer.nebulagraph.tags.feed.name').$user->id,
            ]
        ));

        // create user wall vertex
        $wallVertexId = $existing['wall'] ?? getVertexIdFromInsert($nebula->insertVertex(
            config('socializer.nebulagraph.tags.wall.name'),
                [
                    'id' => config('socializer.nebulagraph.tags.wall.name').$user->id,
                    'questionnaire_id' => config('socializer.posts.classic_form'),
                ]
        ));

        /*
        | RELATIONSHIP
        */

        // create user feed
        setOwnedByRelation($feedVertexId, $userVertexId);

        // create user wall
        setOwnedByRelation($wallVertexId, $userVertexId);

        // user follow his wall
        setFollowedByRelation($wallVertexId, $userVertexId);

        // user registered in his groups
        foreach ($user->groups as $group) {
            setRegisteredRelation($userVertexId, getVertexId($group));
        }
    }
}

// 26/04/2026 : deplacé dans le service Server pour etre utilisé aussi à la création de groupe
// if(!function_exists('createGroupInNebula')) {
//     function createGroupInNebula($group) {
//         $nebula = app('nebulaGraph');

//         return $nebula->insertVertex(
//             config('socializer.nebulagraph.tags.group.name'), 
//             array_merge(
//                 $nebula->populatePropsFromPattern(
//                     $group, 
//                     config('socializer.nebulagraph.vertices.group')
//                 ),
//                 [
//                     'identifier' => hideIdentifier($group),
//                     'id' => getVertexId($group)
//                 ]
//             )
//         );
//     }
// }

if(!function_exists('setGroupHasParentRelation')) {
    function setGroupHasParentRelation($group) {
        if (!empty($group->parent_id)) {
            setRegisteredRelation(
                config('socializer.nebulagraph.tags.group.name').$group->id,
                config('socializer.nebulagraph.tags.group.name').$group->parent_id
            );
        } else {
            $nebula = app('nebulaGraph');
            // if parent_id is empty, we need to delete the relation with the previous parent if exists
            $query = "
                MATCH (g:group)-[r:registered_in]->(parent:group)
                WHERE id(g) == '".getVertexId($group)."'
                RETURN id(g) AS src, id(parent) AS dst;
            ";
            $result = $nebula->execute($query);

            // `execute()` ne lève pas : sur panne il rend un `JsonResponse`, et un `foreach`
            // dessus fait zéro tour en silence — le détachement du parent passait donc pour
            // effectué.
            if (!is_array($result)) {
                Log::warning('setGroupHasParentRelation : parent non détaché, le graphe n\'a pas répondu', [
                    'group_vertexid' => getVertexId($group),
                ]);

                return;
            }

            foreach ($result as $row) {
                // Passe par la méthode DML plutôt que par un `DELETE EDGE` en nGQL brut :
                // `getEdgeDirection` régénère exactement la même requête, et le site devient
                // levant comme les autres écritures. C'était le seul du paquet à ne pas l'être.
                $nebula->deleteEdge(
                    config('socializer.nebulagraph.edges.registered_in.name'),
                    [$row['src'].'->'.$row['dst']]
                );
            }
        }
    } 
}

// SERVER HELPERS
if (!function_exists('checkServerAccess')) {
    function checkServerAccess($vertex_id, $user_vertexid, $tag='server') {
        $nebula = app('nebulaGraph');
        $query = "
            MATCH (creator:user)<-[:has_creator]-(g:group)<-[:owned_by]-(s:".$tag."), (u:user)-[:registered_in]->(g)
            WHERE id(s) == '$vertex_id' AND (s.".$tag.".privacy == 0 OR (s.".$tag.".privacy == 1 AND id(u) == '$user_vertexid') OR (s.".$tag.".privacy == 2 AND id(creator) == '$user_vertexid')) 
            RETURN id(s) as server_id
        ";
        $result = $nebula->execute($query);
        return isset($result[0]);
    }
}

if (!function_exists('getServerAdmin')) {
    function getServerAdmin($server_vertexid)
    {
        $nebula = app('nebulaGraph');
        $query = "
            MATCH (o:user)<-[:has_creator]-(s:server)
            WHERE id(s) == '$server_vertexid'
            RETURN id(o)
        ";
        $result = $nebula->execute($query);
        return getRealIdFromVertexId($result[0]);
    }
}

/*---------------------------
| Vertices & Edges Helpers
|----------------------------*/

// SET RELATIONS
if (!function_exists('setRegisteredRelation')) {
    function setRegisteredRelation($user_vid, $vid)
    {
         app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.registered_in.name'), 
            [
                $user_vid .'->'. $vid => config('socializer.nebulagraph.edges.registered_in.props')
            ]
        );
    }
}

if (!function_exists('setHasCreatorRelation')) {
    function setHasCreatorRelation($vid, $creator_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.has_creator.name'), 
            [
                $vid .'->'. $creator_vid => config('socializer.nebulagraph.edges.has_creator.props')
            ]
        );
    }
}

if (!function_exists('setPublishedInRelation')) {
    function setPublishedInRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.published_in.name'), 
            [
                $from_vid .'->'. $to_vid => config('socializer.nebulagraph.edges.published_in.props')
            ]
        );
    }
}

if (!function_exists('setFollowedByRelation')) {
    function setFollowedByRelation($from_vid, $to_vid)
    {
        return app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.followed_by.name'), 
            [
                $from_vid .'->'. $to_vid => config('socializer.nebulagraph.edges.followed_by.props')
            ]
        );
    }
}

if (!function_exists('setOwnedByRelation')) {
    function setOwnedByRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.owned_by.name'), 
            [
                $from_vid .'->'. $to_vid => config('socializer.nebulagraph.edges.owned_by.props')
            ]
        );
    }
}

if (!function_exists('setReplyOfRelation')) {
    function setReplyOfRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.reply_of.name'), 
            [
                $from_vid.'->'.$to_vid => config('socializer.nebulagraph.edges.reply_of.props')
            ]
        );
    }
}

if (!function_exists('setSharingOfRelation')) {
    function setSharingOfRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.sharing_of.name'), 
            [
                $from_vid.'->'.$to_vid => config('socializer.nebulagraph.edges.sharing_of.props')
            ]
        );
    }
}

if (!function_exists('setSharedByRelation')) {
    function setSharedByRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
             config('socializer.nebulagraph.edges.shared_by.name'), 
            [
                $from_vid.'->'.$to_vid => config('socializer.nebulagraph.edges.shared_by.props')
            ]
        );
    }
}

if (!function_exists('setSharedInRelation')) {
    function setSharedInRelation($from_vid, $to_vid)
    {
        app('nebulaGraph')->insertEdge(
            config('socializer.nebulagraph.edges.shared_in.name'), 
            [
                $from_vid.'->'.$to_vid => config('socializer.nebulagraph.edges.shared_in.props')
            ]
        );
    }
}

// GET RELATIONS
if( !function_exists('isRegisteredIn')) {
    function isRegisteredIn($source_vid, $target_vid)
    {
        $nebula = app('nebulaGraph');
        $query = "
            MATCH (u)-[:registered_in]->(r)
            WHERE id(u) == '$source_vid' AND id(r) == '$target_vid'
            RETURN count(*) > 0 as is_registered
        ";
        $result = $nebula->execute($query);
        return $result[0];
    }
}

if( !function_exists('isFollowedBy')) {
    function isFollowedBy($source_vid, $target_vid)
    {
        $nebula = app('nebulaGraph');
        $query = "
            MATCH (u)-[:followed_by]->(r)
            WHERE id(u) == '$source_vid' AND id(r) == '$target_vid'
            RETURN count(*) > 0 as is_registered
        ";
        $result = $nebula->execute($query);
        return $result[0];
    }
}