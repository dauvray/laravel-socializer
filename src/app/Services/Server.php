<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Arr;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Log;
use Dauvray\Socializer\app\Exceptions\NebulaGraphException;
use Dauvray\Socializer\app\Services\Chat;
use Dauvray\Socializer\app\Services\Page;
use Dauvray\Socializer\app\Services\ApplicationIA;
use Dauvray\Socializer\app\Services\Feed;
use Dauvray\Estarter\app\Helpers\ModelTraits\Thumbnails;
use Dauvray\Socializer\app\Http\Resources\ServerCollection;
use Innovation\formdesigner\app\Services\QuestionnaireService;
use Dauvray\Socializer\app\Helpers\SocializerQuestionnaireHelper;
use Dauvray\Socializer\app\Events\QuestionnaireAnswered;
use Dauvray\Socializer\app\Notifications\serverAccessRequest;
use Dauvray\Socializer\app\Notifications\serverAccessResponse;

class Server
{
    use Thumbnails;

    public $nebula = null;
    public $user = null;
    public $serviceChat = null;
    public $servicePage = null;
    public $serviceFeed = null;
    public $serviceApplication = null;
    public $usersOnlineService = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->user = Auth::user();
        $this->serviceChat = new Chat();
        $this->servicePage = new Page();
        $this->serviceApplication = new ApplicationIA();
        $this->serviceFeed = new Feed();
        $this->usersOnlineService = app('onlineUsers');
    }
    /*-----------------------------------
    | SERVER
    |-----------------------------------*/

    public function checkServerAccess($vertex_id)
    {
        $user_vertexid = $this->user->vertexid;
        return checkServerAccess($vertex_id, $user_vertexid);
    }

    public function requestServerAccess(Request $request)
    {
        $server_vid = $request->get('serverId');
        $action = $request->get('model')['action'];
        $success = false;

        switch($action) {
            case 'administrateur':
                $admin_id = getServerAdmin($server_vid);
                $admin = config('estarter.models.user')::where('id', $admin_id)->first();
                    if($admin) {
                        $server = $this->getServer($server_vid, false);
                        $admin->notify(new serverAccessRequest($this->user, $server));
                    }
                    $success = true;
                break;
            case 'serial':
                break;
        }

        return $success;
    }

    public function responseServerAccess(Request $request)
    {
        $server_vid = $request->get('server_vid');
        $user_id = $request->get('user_id');
        $notification_id = $request->get('notification_id');
        $response = $request->get('response');

        if(!$this->user->isServerOwner($server_vid)) {
            return false;
        }

        $request_user = config('estarter.models.user')::where('id', $user_id)->first();
        $server = $this->getServer($server_vid, false);

        if($response) {
            // server / user relation
            setRegisteredRelation($request_user->vertexid, $server_vid);
        }

        $request_user->notify(new serverAccessResponse($this->user, $server, $response));
       
        deleteNotification($this->user, $notification_id);

        return true;
    }

    public function createServer(array $server_data = [])
    {
        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.server.name'),
            [
                'name' => $server_data['name'],
                'privacy' => (int)$server_data['privacy'],
            ]
        );

        $vid = getVertexIdFromInsert($vertex);

        if(!$vid) {
            return false;
        }

         // server page
        $page_vid = $this->servicePage->createPageVertice($vid);

        // page / server relation
        setPublishedInRelation($page_vid, $vid);

        return $vid;
    }

    // cette notion a été abandonnée au profit de serveurs liés à des groupes
    public function createUserServer(array $server_data = [])
    {
        $vid = $this->createServer($server_data);

        // server / user relation
        setRegisteredRelation($this->user->vertexid, $vid);

        // server / creator relation
        setHasCreatorRelation( $vid, $this->user->vertexid);

        return $vid;
    }

    /**
     * Le serveur d'un groupe, et sa relation d'appartenance au groupe.
     *
     * ⚠️ EXIGE UN UTILISATEUR AUTHENTIFIÉ, donc n'est pas jouable en console. La chaîne
     * `createServer` → `Page::createPageVertice` lit `$this->user->id` et `get_class($this->user)` :
     * sans acteur, c'est une `TypeError`, pas une panne de graphe — et `ToleratesGraphFailure`
     * rappelle qu'une `TypeError` doit remonter. Le garde ci-dessous la remplace par un refus
     * lisible, pour que la migration `create_nebula`, qui boucle sur les groupes, ne meure pas sur
     * une base qui en a.
     *
     * Rendre cette projection jouable en console — propriétaire passé explicitement plutôt que lu
     * dans `Auth::user()` — est un chantier à part : `work/README.md`.
     *
     * @return string|false le vertexid du serveur, ou `false` si rien n'a été tenté
     */
    public function createGroupServer(array $server_data = [], $group_vid = null)
    {
        if(!$this->user) {
            Log::warning('createGroupServer : aucun utilisateur authentifié, serveur de groupe non projeté', [
                'group_vertexid' => $group_vid,
                'server_name' => $server_data['name'] ?? null,
            ]);

            return false;
        }

        $vid = $this->createServer($server_data);

        // server / group relation
        setOwnedByRelation($vid, $group_vid);

        return $vid;
    }

    public function updateServer(Request $request)
    {
        $model = $request->get('model');
        $files = $request->get('files') ?? [];
        $trashes = $request->get('trash') ?? [];
        $vertexid = $model['id'];

        $result = $this->nebula->execute("
            MATCH (s:server)-[:has_creator]->(u:user) WHERE id(s) == '$vertexid'
            RETURN id(u) as owner, s as server
        ");

        if($result[0]['owner'] != $this->user->vertexid) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        $server_id = $result[0]['server']['id'];

        // image manager
        foreach($trashes as $trash) {
            $path = explode('/', $trash);
            $this->deleteAllThumbnails($path[1]);
        }

        foreach($files as $idx => $file) {
            $model['image'][$idx]['name'] = $this->createThumbnails($file, 'thumbnails', config('images.covers'), true);
            $model['image'][$idx]['new'] = false;
            $model['image'][$idx]['preview'] = 'thumbnails';
        }

        $model['image'] = json_encode($model['image']);

        // Le `if(count($update))` d'avant E7 était doublement faux : un UPDATE réussi rend `[]`,
        // donc `count()` valait 0 et la branche n'était JAMAIS prise ; et sur un refus, `$update`
        // valait un `JsonResponse`, sur lequel `count()` lève un `TypeError` — un 500 opaque au
        // lieu du 404 déjà rédigé ici. Le `catch` ressuscite la branche.
        try {
            $this->nebula->updateVertex(
                config('socializer.nebulagraph.tags.server.name'),
                $vertexid,
                $this->nebula->populatePropsFromPattern(
                    (object)$model,
                    config('socializer.nebulagraph.vertices.server')
                )
            );
        } catch (NebulaGraphException $e) {
            Log::warning('updateServer : le graphe a refusé la mise à jour', $e->context() + [
                'server_vertexid' => $vertexid,
            ]);

            return response()->json(['message' => 'Enregistrement impossible'], 404);
        }

        Broadcast::presence("server.$server_id")
        ->as('serverUpdated')
        ->with(['server' => $model])
        ->sendNow();

        return response()->json(['status' => 'success', 'message' => 'Modification enregistrées'], 200);
    }

    // general updates, for deep updates see $this->updateRoomServer()
    public function updateServerRooms(Request $request)
    {
        $server_id = $request->get('serverId');
        $rooms = $request->get('rooms');
        
        if(!$this->user->isServerOwner($server_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        // Cf. `updateServer` pour le motif. On sort au PREMIER échec, comme avant : les salons
        // déjà mis à jour le restent, c'est le comportement que le `return` d'origine décrivait.
        foreach($rooms as $room) {
            try {
                $this->nebula->updateVertex(
                    config('socializer.nebulagraph.tags.room.name'),
                    $room['id'],
                    $this->nebula->populatePropsFromPattern(
                        (object)$room,
                        config('socializer.nebulagraph.vertices.room')
                    )
                );
            } catch (NebulaGraphException $e) {
                Log::warning('updateServerRooms : le graphe a refusé la mise à jour d\'un salon', $e->context() + [
                    'room_vertexid' => $room['id'],
                ]);

                return response()->json(['message' => 'Enregistrement impossible'], 404);
            }
        }

        return response()->json(['message' => 'Modifications enregistrées'], 200);
    }

    public function deleteServer($server_id = null)
    {
        $result = $this->nebula->execute("
            MATCH (p:page)-[:published_in]-(s:server) WHERE id(s) == '$server_id' 
            OPTIONAL MATCH (s)-[:published_in]-(r:room)
            WITH id(p) as page_id, collect(r) as rooms
            RETURN page_id, rooms
        ");

        // delete server page
        $this->servicePage->deletePage($result[0]['page_id']);
        

        foreach( $result[0]['rooms'] as $room ) {
            $this->deleteRoom($room['id']);
        }

        $this->nebula->deleteVertex([$server_id], true);

        // delete mongo server answers
        Schema::connection('mongodb')->drop('server_'.$server_id);

        // delete all questionnaires
        DB::table('questionnaires')
        ->whereJsonContains('extras', ['collection' => 'server_'.$server_id])
        ->delete();

        // delete storage files
        Storage::deleteDirectory(storage_path('app/public/servers/' . $server_id));
        Storage::deleteDirectory(storage_path('app/servers/' . $server_id));

        return true;

    }

    public function deleteUserServer($server_id = null)
    {
        if(!$this->user->isServerOwner($server_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        if($this->deleteServer($server_id)) {
            return response()->json(['message' => 'Le serveur a été supprimé'], 200);
        }
    }

    public function deleteGroupServer($server_id = null)
    {
        if($this->deleteServer($server_id)) {
            return response()->json(['message' => 'Le serveur a été supprimé'], 200);
        }
    }

    public function getAllServers()
    {
        $result = app('nebulaGraph')->execute("
            MATCH (o:user{active: 1})-[:registered_in]->(g:group)<-[:owned_by]-(s:server) WHERE id(o) == '{$this->user->vertexid}' RETURN  DISTINCT s,o
        ");

        $paginator = makePaginationCollection(collect($result), route(Route::currentRouteName()));

        return new ServerCollection($paginator);
    }

    public function getRegisteredServers()
    {
        return $this->user->servers();
    }

    public function getServer($vertex_id = null, $with_relations = true)
    {
        $query = "MATCH (o:user)<-[:has_creator]-(g:group)<-[:owned_by]-(s:server), (u:user)-[:registered_in]->(g) WHERE id(s) == '$vertex_id' ";

            if($with_relations) {

                $user_vertexid = $this->user->vertexid;

                $query .= "AND (s.server.privacy == 0 OR (s.server.privacy == 1 AND id(u) == '$user_vertexid')) 
                    MATCH (s)<-[:published_in]-(p:page) 
                    OPTIONAL MATCH (s)<-[:published_in]-(r:room)
                    WITH s as server, properties(s) AS server_props, count(distinct u) as nb_users, collect(r) as rooms , o as owner, p as page
                    RETURN server, owner, nb_users, rooms, page
                ";
            } else {

                $query .= "RETURN s as server";

            }

        $result = $this->nebula->execute($query);

        if(!isset($result[0])) {
            return false;
        }

        // for notifications users
        if(!$with_relations) {
            return $result[0];
        }

        // decode image server
        $result[0]['server']['image'] = json_decode($result[0]['server']['image']);
        // decode image room
        $result[0]['rooms'] = $this->decodeImageRooms($result[0]['rooms']);
        // check rooms permissions
        $result[0]['rooms'] = $this->setRoomPrivacyPermissions($result[0]['rooms']);

        // set user in online server connections
        $this->usersOnlineService->addUserItem('server', $vertex_id);

        return $result[0];
    }

    public function getServerQuestionnaireList(Request $request)
    {
        $server_id = $request->get('server_id');
        $pagination = $request->per_page ?? $request->query('per_page') ?? null;

        if(!$this->user->isServerOwner($server_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }
        
        $questionnaires = SocializerQuestionnaireHelper::getAllQuestionnaires(true, $server_id);

        if($pagination) {
            $questionnaires = makePaginationCollection($questionnaires, route('server.get.questionnaires'), 1, $pagination);
        }
       
        return response()->json($questionnaires, 200);
    }

    public function updateServerQuestionnaires(Request $request)
    {
        $questionnaire_id = $request->get('questionnaire_id');
        $questionnaire = config('formdesigner.models.questionnaire')::find($questionnaire_id);

        if(!$this->user->isServerOwner($questionnaire->network_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        $service = new QuestionnaireService();
        $result = $service->saveQuestionnaire($request);

        return response()->json(['message' => $result['response']['message']], $result['code']);

    }

    public function deleteServerQuestionnaire(Request $request)
    {
        $questionnaire_id = $request->get('questionnaire_id');
        $questionnaire = config('formdesigner.models.questionnaire')::find($questionnaire_id);

        if(!$this->user->isServerOwner($questionnaire->network_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }
        
        if(config('formdesigner.models.questionnaire')::destroy($questionnaire_id)) {
            return true;
        }

        return false;
    }

    public function manageServerQuestionnaires(Request $request)
    {
        $server_id = $request->get('server_id');
        $questionnaire_id = $request->get('settings')['id'];

        if(!$this->user->isServerOwner($server_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        if(!$questionnaire_id) {

            // request will be added in event model
            // Because two different ways ( front or backpack )
            $settings = $request->get('settings');
            unset($settings['id']);
            $settings['config']['reportableOnline'] = true;
            $request->merge(['settings' => $settings]);

            $questionnaire = config('formdesigner.models.questionnaire')::create([
                'name' => $request->get('title'),
                'code' => 'server_'.$server_id,
                //'settings' => added in model event via request(),
                'extras' => [
                    "model" => "App\Models\User",
                    "collection" => "server_".$server_id,
                    "permission" => null
                ],
                'network_id' => $server_id,
                'active' => 1,
            ]);

        } else {
            $questionnaire = config('formdesigner.models.questionnaire')::find($questionnaire_id);
            $questionnaire->name = $request->get('title');
            // others data saved via model event
            $questionnaire->save();
        }

        return [
            'id' => $questionnaire->id,
            'model' => [
                'name' => $questionnaire->name,
            ]
        ];
    }

    /*-----------------------------------
    | ROOM
    |-----------------------------------*/

    private function decodeImageRooms(array $rooms = [])
    {
        foreach($rooms as $idx => $room) {
            $rooms[$idx]['image'] = json_decode($room['image']);
        }
        return $rooms;
    }

    private function setRoomPrivacyPermissions(array &$rooms = [])
    {
        foreach($rooms as $idx => $room) {
            // check if user is registered in room
            if($room['privacy'] == 1) {
                $room_id = $room['id'];
                $user_id = $this->user->vertexid;

                $query = "MATCH (r:room)<-[:registered_in]-(u:user) 
                        WHERE id(r) == '$room_id' AND id(u) == '$user_id'
                        RETURN id(u)";

                $result = $this->nebula->execute($query);
                $rooms[$idx]['registered_in'] = !isset($result[0]) ? false : true;
            }
        }

        // remove room if privacy is set to 2 and user is not the owner
        $rooms = array_filter($rooms, function($room) {
            return $room['privacy'] != 2 || $this->user->isRoomOwner($room['id']);
        });

        // recalculate indexes
        return array_values($rooms);
    }

    public function createRoomServer($server_id, $new_room)
    {

        if(!$this->user->isServerOwner($server_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        // todo 
        // voir plutot a merger $new_room et $values pour ne pas a avoir
        // a ajouter toutes les props à la main quand il y en a des nouvelles

        $values = [
            'name' => $new_room['name'],
            'image' => isset($new_room['image']) ? $new_room['image'] : null,
            'privacy' => (int)$new_room['privacy'],
            'content_type' => $new_room['content_type'],
            'questionnaire_id' => isset($new_room['questionnaire_id']) ? (int)$new_room['questionnaire_id'] : null,
            'module_id' => isset($new_room['module_id']) ? (int)$new_room['module_id'] : null,
            'save_board' => isset($new_room['save_board']) ? (int)$new_room['save_board'] : null,
            'is_bot' => isset($new_room['is_bot']) ? (int)$new_room['is_bot'] : null,
            'url_bot' => isset($new_room['url_bot']) ? $new_room['url_bot'] : null,
        ];

        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.room.name'),
            array_merge($values, ['position' => getNextPublishedPosition($server_id) ])
        );

        $vid = getVertexIdFromInsert($vertex);

        if(!$vid) {
            return response()->json(['message' => 'Erreur'], 404);
        }

        // room / server relation
        setPublishedInRelation($vid, $server_id);

        // room / creator relation
        setHasCreatorRelation($vid, $this->user->vertexid);

        // room / user relation
        setRegisteredRelation($this->user->vertexid, $vid);

        // create associated content
        $this->_createContent($values, $server_id, $vid);

        $final_values = array_merge(['id' => $vid], $values);

         // send to all server users
        Broadcast::presence("server.$server_id")
            ->as('roomCreated')
            ->with($final_values)
            ->sendNow();

        return $final_values;

    }

    public function createSubContent(Request $request)
    {
        $room_id = $request->get('roomId');
        $server_id = $request->get('serverId');
        $new_content = $request->get('content');

        if(!$this->user->isServerOwner($server_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        $values = [
            'name' => $new_content['name'],
            'image' => isset($new_content['image']) ? $new_content['image'] : null,
            'content_type' => $new_content['content_type'],
            'privacy' => (int)$new_content['privacy'],
            'position' => getNextPublishedPosition($room_id) 
        ];

        $new_vid = $this->_createContent($values, $server_id, $room_id);
        
        $final_values = array_merge([
            'id' => $new_vid,
            'parent_id' => $room_id,
            'questionnaire_id' => isset($new_room['questionnaire_id']) ? (int)$new_room['questionnaire_id'] : null
        ], $values);

        Broadcast::presence("server.$server_id")
        ->as('subRoomCreated')
        ->with($final_values)
        ->sendNow();

        return response()->json([
            'room' => $final_values, 
            'message' => "Salon crée"
        ], 200);
    }

    /**
     * Entonnoir de création de contenu — et le seul endroit où l'échec de graphe se rattrape.
     *
     * Les six constructeurs de vertex qu'il aiguille rendaient `false` sur échec, via un
     * `if(!is_array($vertex))` qui ne pouvait JAMAIS être vrai : avant E7, `insertVertex` rendait
     * la même valeur en succès et en échec. Ces gardes ont donc été retirés, et la levée les
     * remplace.
     *
     * Le rattrapage est ICI plutôt que dans chacun d'eux, pour deux raisons. D'abord un salon à
     * moitié bâti est pire qu'un refus : mieux vaut échouer une fois, en haut, que laisser six
     * chemins produire chacun un état partiel. Ensuite parce que c'est la frontière HTTP — hors
     * `UserController`, aucun contrôleur du paquet n'a de `try/catch`, donc laisser remonter
     * rendrait `{"message":"Server Error"}` : un toast anglais côté front, là où le corps 404
     * ci-dessous est déjà rédigé et déjà affiché (leçon E5 — un refus se suit jusqu'au pixel).
     */
    private function _createContent($new_content, $server_id, $room_id)
    {
        try {
            return $this->_createContentVertex($new_content, $server_id, $room_id);
        } catch (NebulaGraphException $e) {
            Log::warning('_createContent : le graphe a refusé la création du contenu', $e->context() + [
                'server_vertexid' => $server_id,
                'room_vertexid' => $room_id,
                'content_type' => $new_content['content_type'] ?? null,
            ]);

            return response()->json(['message' => "Création impossible"], 404);
        }
    }

    private function _createContentVertex($new_content, $server_id, $room_id)
    {
        switch($new_content['content_type']) {
            case 'chat':
                $new_vid = $this->serviceChat->getOrcreateChatVertice($room_id, $new_content);
                break;
            case 'data':
            case 'admin':
            case 'form':
                $new_vid = $this->createDataVertice($room_id, $new_content);
                break;
            case 'whiteboard':
                $new_vid = $this->createBoardVertice($room_id, $new_content);
                break;
            case 'classroom':
                $new_vid = $this->createClassroomVertice($room_id, $new_content);
                break;
            case 'application':
                $new_vid = $this->serviceApplication->createApplicationVertice($room_id, $new_content);
                break;
            case 'wall':
                $new_vid = $this->createFeedWallVertice($room_id, $new_content);
                break;
            // all others types are considered as page
            default:
                $new_vid = $this->servicePage->createPageVertice($server_id, $room_id, $new_content);
                if(!$new_vid) {
                    return response()->json(['message' => "Création impossible"], 404);
                }

                // page / room relation
                setPublishedInRelation($new_vid, $room_id);
                break;
        }

        return $new_vid;
    }

    public function getRoom($vertex_id = null, $with_subcontent = true)
    {
        $user_vertexid = $this->user->vertexid;

        $query = "
            MATCH (o:user)<-[:has_creator]-(r:room)<-[:registered_in]-(u:user) 
            WHERE id(r) == '$vertex_id' AND (r.room.privacy == 0 OR (r.room.privacy == 1 AND id(u) == '$user_vertexid') OR (r.room.privacy == 2 AND id(o) == '$user_vertexid')) 
            OPTIONAL MATCH (r)<-[:published_in]-(c)
            OPTIONAL MATCH (c)<-[:published_in]-(subc)
            WITH collect(r) as room, collect(distinct c) as content, id(o) as owner, collect(distinct subc) as subcontent
            RETURN room, owner, content, subcontent
        ";

        $result = $this->nebula->execute($query);

        if(!count($result)) {
           return [
            'content_type' => 'locked',
            'id' => $vertex_id,
           ];
        }

        $result = $result[0];

        $response = [
            'name' => $result['room'][0]['name'],
            'image' => json_decode($result['room'][0]['image']),
            'privacy' => $result['room'][0]['privacy'],
            'id' => $result['room'][0]['id'],
            'content' => $result['content'],
        ];

        // subcontent are posts for wall type, so do not need to send , they are fetched with feed service
        if($result['content'][0]['content_type'] == 'wall') {
            $with_subcontent = false;
        }

        if($with_subcontent) {
            $response['subcontent'] = count($result['subcontent']) ? $result['subcontent'] : null;
        }

         // set user in online server connections
        $this->usersOnlineService->addUserItem('room', $vertex_id);

        return $response;
    }

    public function updateRoomServer(Request $request)
    {
        $model = $request->get('model');
        $files = $request->get('files') ?? [];
        $trashes = $request->get('trash') ?? [];
        $vertexid = $model['id'];

        $result = $this->nebula->execute("
            MATCH (r:room)-[:has_creator]->(u:user) WHERE id(r) == '$vertexid'
            MATCH (s:server)<-[:published_in]-(r) 
            RETURN id(u) as owner, s as server
        ");

        if($result[0]['owner'] != $this->user->vertexid) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        $server_id = $result[0]['server']['id'];

        // image manager
        foreach($trashes as $trash) {
            $path = explode('/', $trash);
            $this->deleteAllThumbnails($path[1]);
        }

        foreach($files as $idx => $file) {
            $model['image'][$idx]['name'] = $this->createThumbnails($file, 'thumbnails', config('images.covers'), true);
            $model['image'][$idx]['new'] = false;
            $model['image'][$idx]['preview'] = 'thumbnails';
        }

        $model['image'] = json_encode($model['image']);

        // Cf. `updateServer` pour le motif du `count()` qui ne testait rien. Les DEUX mises à
        // jour sont ici dans le même `try` : la seconde n'avait, elle, aucune garde du tout.
        try {
            $this->nebula->updateVertex(
                config('socializer.nebulagraph.tags.room.name'),
                $vertexid,
                $this->nebula->populatePropsFromPattern(
                    (object)$model,
                    config('socializer.nebulagraph.vertices.room')
                )
            );

            // update content
            $content = $this->nebula->execute("MATCH (r:room)<-[:published_in]-(c)
            WHERE id(r) == '$vertexid'
            RETURN c as content, tags(c)[0] as type");

            $this->nebula->updateVertex(
                config('socializer.nebulagraph.tags.'.$content[0]['type'].'.name'),
                $content[0]['content']['id'],
                $this->nebula->populatePropsFromPattern(
                    (object)$model,
                    config('socializer.nebulagraph.vertices.'.$content[0]['type'])
                )
            );
        } catch (NebulaGraphException $e) {
            Log::warning('updateRoomServer : le graphe a refusé la mise à jour', $e->context() + [
                'room_vertexid' => $vertexid,
            ]);

            return response()->json(['message' => 'Enregistrement impossible'], 404);
        }

        Broadcast::presence("server.$server_id")
        ->as('roomUpdated')
        ->with(['room' => $this->getRoom($vertexid, false)])
        ->sendNow();

        return response()->json(['status' => 'success', 'message' => 'Modification enregistrées'], 200);
    }

    public function deleteRoom($room_id = null)
    {
        $result = $this->nebula->execute("
            MATCH (c)-[:published_in]->(r:room)-[:has_creator]->(u:user) WHERE id(r) == '$room_id' 
            MATCH (s:server)<-[:published_in]-(r)
            OPTIONAL MATCH (m)-[:published_in]->(c)
            RETURN id(u) as owner, id(s) as server, collect(c) as contents, collect(m) as messages
        ");

        if(!isset($result[0])) {
            return [
                'status' => false,
                'message' => 'Salon introuvable',
                'code_error' => 404,
            ];
        }

        $owner_id = $result[0]['owner'];
        $server_id = $result[0]['server'];
        $contents = Arr::pluck($result[0]['contents'], 'id');
        $messages = Arr::pluck($result[0]['messages'], 'id');

        if($owner_id != $this->user->vertexid) {
            return [
                'status' => false,
                'message' => 'Non autorisé',
                'code_error' => 401,
            ];
        }

        // delete contents
        $this->nebula->deleteVertex(array_merge([$room_id], $contents, $messages), true);

        // delete mongodb messages
        if(count($messages)) {
            config('socializer.models.message')::whereIn('vertexid', $messages)->delete();
        }
        // delete mongodb contents
        foreach($result[0]['contents'] as $content) {
            if(config('socializer.models.'.$content['content_type'])) {
                config('socializer.models.'.$content['content_type'])::where('vertexid',  $content['id'])->delete();
            }
            if($content['content_type'] == 'application') {
                config('socializer.models.page')::where('application_id',  $content['id'])->delete();
            }
        }

        Broadcast::presence("server.$server_id")
        ->as('roomDeleted')
        ->with(['room_id' => $room_id])
        ->sendNow();

        return [
            'status' => true,
            'message' => 'Le salon a été supprimé',
            'code_error' => 200,
        ];
    }

    /*------------------------------------------
    | Room content
    |------------------------------------------*/ 

    public function createDataVertice($vid, $new_content)
    {
        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.data.name'),
            [
                'questionnaire_id' => $new_content['questionnaire_id'],
                'content_type' => $new_content['content_type'],
                'position' => getNextPublishedPosition($vid),  
            ]
        );

        $new_vid = getVertexIdFromInsert($vertex);

        if(!$new_vid) {
            return false;
        }

        // data / room relation
        setPublishedInRelation($new_vid, $vid);

        return $new_vid;
    }

    public function createClassroomVertice($vid, $new_content)
    {
        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.classroom.name'),
            $new_content
        );

        $new_vid = getVertexIdFromInsert($vertex);

        if(!$new_vid) {
            return false;
        }

        // classroom / room relation
        setPublishedInRelation($new_vid, $vid);

        // classroom / creator relation
        setHasCreatorRelation( $new_vid, $this->user->vertexid);

        $this->serviceChat->getOrcreateChatVertice($new_vid, $new_content['privacy']);
        $this->createBoardVertice($new_vid, $new_content);

        return $new_vid;
    }

    public function createBoardVertice($vid, $new_content)
    {
        unset($new_content['content_type']);
        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.whiteboard.name'),
            $new_content
        );

        $new_vid = getVertexIdFromInsert($vertex);

        if(!$new_vid) {
            return false;
        }

        // board / room relation
        setPublishedInRelation($new_vid, $vid);

        return $new_vid;
    }

    public function createFeedWallVertice($vid, $new_content)
    {
        if(!$new_content['questionnaire_id']) {
            $new_content['questionnaire_id'] = config('socializer.posts.classic_form');
        }

        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.wall.name'),
            $new_content
        );

        $new_vid = getVertexIdFromInsert($vertex);

        if(!$new_vid) {
            return false;
        }

        // wall / room relation
       setOwnedByRelation($new_vid, $vid); // used for feed
       setPublishedInRelation($new_vid, $vid); // used for room

        // owner/ wall relation
        setFollowedByRelation($new_vid, $this->user->vertexid);

        return $new_vid;
    }

    public function addRoomModule(Request $request)
    {
        $server_id = $request->get('server_id');
        $type = $request->get('type')['type'];
        $module_id = random_int(1, 999);

        if(!$this->user->isServerOwner($server_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        $setup = config('socializer.modules.'.$type);
        $forms = [];

        // create questionnaires
        foreach($setup['questionnaires'] as $idx => $questionnaire) {

            $questionnaire['network_id'] = $server_id;
            $questionnaire['code'] = 'server_'.$server_id;
            $questionnaire['extras'] = [
                "model" => "App\Models\User",
                "collection" => "server_".$server_id,
                "permission" => null
            ];

           $forms[$idx] = config('formdesigner.models.questionnaire')::create($questionnaire);
        }

        // create rooms
        foreach($setup['rooms'] as $idx => $room) {
            $room['module_id'] = $module_id;
            if(isset($room['questionnaire_id'])) {
                $room['questionnaire_id'] = $forms[$room['questionnaire_id']]->id;
            }
            $this->createRoomServer($server_id, $room);
        }
    }

    /*------------------------------------------
    | Questionnaires
    |------------------------------------------*/ 
    public function sendQuestionnaireAnswers(Request $request)
    {
        $questionnaire_id = $request->user_questionnaire_id ?? $request->questionnaire_id;
        $room_id = $request->room_id;

        $helper = new SocializerQuestionnaireHelper(
            $questionnaire_id,
            $request->formable,
            $request->answer_id,
            $request->standalone ?? false
        );

        $service = new QuestionnaireService($helper);
        $result = $service->storeAnswersQuestionnaire($request);

        if(optional($helper->config)->shared) {
            QuestionnaireAnswered::dispatch($result['response']['model'], $room_id);
        }

        // check alert
        if($result['status']) {
           // todo $this->checkAlertsForAnswer((int)$questionnaire_id, $result);
        }
       
        return response()->json($result['response'], $result['code']);
    }

    public function checkAlertsForAnswer($questionnaire_id, $answer)
    {
        $alerts = config('socializer.models.alert')::where('questionnaire_id', $questionnaire_id)->get();

        foreach ($alerts as $alert) {
             if ($this->matchesSearch($answer['response']['model'], $alert->search)) {

                $user = config('estarter.models.user')::find($alert->user_id);
                dump($user->feed());

                // Déclenche une alerte pour cet utilisateur
                dd($answer);
             }
        }
    }

    public function matchesSearch(array $model, array $search): bool
    {
        foreach ($search as $key => $values) {
            if (!array_key_exists($key, $model)) {
                return false; // La clé n'existe pas dans le modèle
            }

            $modelValue = $model[$key];

            // Vérifier les types pour différentes structures
            if (is_array($values)) {
                if (is_array($modelValue)) {
                    // Si les deux sont des tableaux, vérifier l'intersection
                    if (empty(array_intersect($values, $modelValue))) {
                        return false; // Pas de correspondance dans le tableau
                    }
                } else {
                    // Si `modelValue` est une valeur unique, vérifier si elle est dans `values`
                    if (!in_array($modelValue, $values)) {
                        return false;
                    }
                }
            } elseif ($modelValue !== $values) {
                return false; // Correspondance stricte pour les valeurs scalaires
            }
        }

        return true; // Toutes les conditions sont satisfaites
    }

    public function getQuestionnaireAnswers(Request $request)
    {
        $helper = new SocializerQuestionnaireHelper(
            $request->user_questionnaire_id ?? $request->questionnaire_id,
            $request->formable,
            $request->answer_id,
            $request->standalone ?? false
        );

        $service = new QuestionnaireService($helper);
        $result = $service->getAnswersQuestionnaire($request);

        return response()->json($result['response'], $result['code']);
    }

    public function deleteAnswersQuestionnaire(Request $request)
    {
        // todo
    }
}