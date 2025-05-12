<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Http\Controllers\Controller;
use Dauvray\Socializer\app\Services\Server as ServerService;
use Innovation\formdesigner\app\Services\SearchService;
use Innovation\formdesigner\app\Services\RenderService;
use Dauvray\Eblogger\app\Services\VueFinderService;
use Innovation\formdesigner\app\Services\QuestionnaireService;
use Dauvray\Socializer\app\Helpers\SocializerQuestionnaireHelper;

class ServerController extends Controller
{
/*----------------------------------------------------------------------
| Servers
|----------------------------------------------------------------------*/

    public function createServer(Request $request,ServerService $service)
    {
        if( $result = $service->createServer($request)) {
            return response()->json(['id' => $result, 'message' => "serveur crée"], 200);
           } 
    
           return response()->json(['message' => 'Impossible de créer le serveur'], 500);
    }

    public function updateServer(Request $request,ServerService $service)
    {
        return $service->updateServer($request);
    }

    public function updateServerRooms(Request $request,ServerService $service)
    {
        return $service->updateServerRooms($request);
    }

    public function deleteServer(ServerService $service, $vertex_id)
    {
        return $service->deleteServer($vertex_id);
    }

    public function getAllServers(ServerService $service)
    {
        return response()->json($service->getAllServers(), 200);
    }

    public function getRegisteredServers(ServerService $service)
    {
        return response()->json($service->getRegisteredServers(), 200);
    }

    public function getServer(ServerService $service, $vertex_id)
    {
        return $service->getServer($vertex_id);
    }

    public function getVueFinderFiles(Request $request, VueFinderService $service,) 
    {
        $server_id = $request->get('server_id');
        $user = Auth::user();

        if(!$user->isServerOwner($server_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

       $serverPath = "servers/" . $server_id;
        
        if (!file_exists(storage_path('app/public/' . $serverPath))) {
            mkdir(storage_path('app/public/' . $serverPath), 0775, true);
            mkdir(storage_path('app/' . $serverPath), 0775, true);
        }

        $config = [
            'publicLinks' => [
                'publique://' =>  url('/storage/servers/' .  $server_id).'/',
            ],
        ];

        $service->getVueFinderFiles($serverPath, $config);
    }

/*----------------------------------------------------------------------
| Rooms
|----------------------------------------------------------------------*/

    public function createRoomServer(Request $request, ServerService $service)
    {
        $server_id = $request->get('serverId');
        $new_room = $request->get('room');

        $room = $service->createRoomServer($server_id, $new_room);

        return response()->json([
            'room' => $room, 
            'message' => "Salon crée"
        ], 200);
    }

    public function createSubContent(Request $request, ServerService $service) 
    {
        return $service->createSubContent($request);
    }

    public function updateRoomServer(Request $request, ServerService $service)
    {
        return $service->updateRoomServer($request);
    }

    public function deleteRoom(ServerService $service, $vertex_id)
    {
        $result = $service->deleteRoom($vertex_id);        
        return response()->json($result['message'], $result['code_error']);
    }

    public function getRoom(ServerService $service, $vertex_id)
    { 
            return response()->json($service->getRoom($vertex_id), 200);
    }

    public function addRoomModule(Request $request, ServerService $service)
    {
         $service->addRoomModule($request);

        return response()->json([
            'message' => "Module ajouté"
        ], 200);
    }

/*----------------------------------------------------------------------
| Questionnaires
|----------------------------------------------------------------------*/  

    public function getServerQuestionnaires(Request $request)
    {
        $revealed = revealIdentifier($request->questionnaire_id);

        $helper = new SocializerQuestionnaireHelper(
            is_object($revealed) ? $revealed->id : $revealed, // to legacy with no hidden id
            $request->formable,
            $request->answer_id,
            $request->standalone
        );

        $service = new QuestionnaireService($helper);
        $result = $service->getUserQuestionnaireData($request);

        return response()->json($result['response'], $result['code']);
    }

    public function getServerQuestionnaireList(Request $request, ServerService $service)
    {
        return $service->getServerQuestionnaireList($request);
    }

    public function deleteServerQuestionnaire(Request $request, ServerService $service)
    {
        if($service->deleteServerQuestionnaire($request)) {
            return response()->json(['message' => 'Questionnaire supprimé'], 200);
        }

        return response()->json(['message' => 'Suppression impossible'], 404);
    }

    public function updateServerQuestionnaires(Request $request, ServerService $service)
    {
        $service->updateServerQuestionnaires($request);
    }

    public function manageServerQuestionnaires(Request $request, ServerService $service)
    {
        if($result = $service->manageServerQuestionnaires($request)) {
            return response()->json(['message' => 'Données enregistrées', 'questionnaire' => $result], 200);
        }
    }

    public function sendQuestionnaireAnswers(Request $request, ServerService $service)
    {
        return $service->sendQuestionnaireAnswers($request);
    }

    public function getQuestionnaireAnswers(Request $request, ServerService $service, $server_id = null)
    {
        return $service->getQuestionnaireAnswers($request, $server_id);
    }

    public function deleteAnswersQuestionnaire(Request $request)
    {
        $helper = new SocializerQuestionnaireHelper(
            $request->questionnaire_id,
            null, 
            null, 
            true
        );
        $service = new QuestionnaireService($helper);
        $result = $service->deleteAnswersQuestionnaire($request);
        return response()->json($result['response'], $result['code']);
    }

    /*----------------------------------------------------------------------
    | Questionnaires Search
    |----------------------------------------------------------------------*/  
    public function applyFilters(Request $request, SearchService $searchService)
    {
        $questionnaire_id = revealIdentifier($request->get('questionnaire_id'));
        $helper = new SocializerQuestionnaireHelper($questionnaire_id, null,null, true);
        $result = $searchService->getQuestionnaireFilteredItems($request, $helper);
        return response()->json($result, 200);
    }

    public function getAdminpanelList(Request $request, SearchService $searchService)
    {
        $questionnaire_id = revealIdentifier($request->get('questionnaire_id'));
        $helper = new SocializerQuestionnaireHelper($questionnaire_id, null, null, true);
        return response()->json($searchService->getAdminpanelList($request, $helper), 200);
    }

    public function getAuthorpanelList(Request $request, SearchService $searchService)
    {
        $questionnaire_id = revealIdentifier($request->get('questionnaire_id'));
        $helper = new SocializerQuestionnaireHelper($questionnaire_id, null, null, true);
        return response()->json($searchService->getAdminpanelList($request, $helper, true), 200);
    }

    public function getQuestionnaireFilters(Request $request)
    {
        $questionnaire_id = revealIdentifier($request->get('questionnaire_id'));
        $helper = new SocializerQuestionnaireHelper($questionnaire_id, null, null, true);
        $service = new QuestionnaireService($helper);
        $result = $service->getQuestionnaireFilters();
        $user_answers = $helper->_loadAnswersQuestionnaire();

       // apply limitations
       foreach($result['fields'] as $key => $item) {
            if(isset($item['field'])) {

                foreach($helper->global_limitations as $limitation) {
                    // todo
                }

                foreach($helper->user_limitations as $limitation) {
                    if($limitation['model'] == $item['field']->model) {
                        switch($limitation['settings']->limitedConstraint) {
                            case 'and':
                                // todo
                                break;
                            case 'or':
                                // todo
                                break;
                            case 'not':
                                foreach($item['field']->values as $idx => $value) {
                                    if($value->value == $user_answers['model'][$item['field']->model]) {
                                        unset($item['field']->values[$idx]);
                                    }
                                }
                                break;
                        }
                    }
                }
            }
       }

        return response()->json($result, 200);
    }

    /*----------------------------------------------------------------------
    | Questionnaires Render
    |----------------------------------------------------------------------*/  
    public function getJSONRender(Request $request, RenderService $renderService)
    {
        $helper = new SocializerQuestionnaireHelper(
            $request->user_questionnaire_id,
            $request->identifier['formable'] ?? null,
            $request->answer_id,
            true
        );

        if(!isset($helper->config->reportableOnline) || !$helper->config->reportableOnline) {
            return response()->json('Non consultable en ligne', 403);
        }

        $result = $renderService->questionnaireJSONRender($request, $helper);
        return response()->json($result, 200);
    }
}