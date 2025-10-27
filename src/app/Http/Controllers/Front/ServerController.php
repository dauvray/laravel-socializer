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

    public function checkServerAccess(ServerService $service, $vertex_id)
    {
        return response()->json($service->checkServerAccess($vertex_id), 200);
    }

    public function requestServerAccess(Request $request, ServerService $service)
    {
        if($service->requestServerAccess($request)) {
            return response()->json(['message' => 'Votre demande a été envoyée au propriétaire du domaine'], 200);
        }

        return response()->json(['message' => 'Impossible d\'envoyer la demande'], 500);
    }

    public function responseServerAccess(Request $request, ServerService $service)
    {
        if($service->responseServerAccess($request)) {
            return response()->json(['message' => 'Autorisation accordée'], 200);
        }

        return response()->json(['message' => 'Impossible d\'enregistrer la réponse'], 500);
    }

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
        $result = $service->getServer($vertex_id);
        if($result) {
            return response()->json($result, 200);
        } else {
            return response()->json(['message' => 'Serveur introuvable'], 404);
        }
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

    public function searchServerInputResults(Request $request, SearchService $searchService)
    {
        $helper = new SocializerQuestionnaireHelper(
            $request->questionnaire_id,
            null, 
            null, 
            true
        );

        $items = $searchService->getQuestionnaireValuesInputItems($request, $helper);
        return response()->json($items, 200);
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

    public function getAdminpanelList(Request $request, SearchService $searchService, ServerService $serverService)
    {
        $questionnaire_id = revealIdentifier($request->get('questionnaire_id'));
        $options = $request->get('options', null);
        $user =  revealIdentifier($options['identifier']);

        if(!$options || !isset($options['roomId']) || !$options['roomId']) {
            abort(403);
        }

        if(!checkServerAccess($options['roomId'], $user->vertex_id, 'room')) {
            abort(403);
        }

        $room = $serverService->getSimpleRoom($options['roomId']);

        $limitations = $room['room']['privacy'] == 2 ? false : true;
        $authoredLimitations = false;   
        if($room['content']['author_only'] === 1) {
            $authoredLimitations = true;
        }
       
        $helper = new SocializerQuestionnaireHelper($questionnaire_id, null, null, true);
        return response()->json($searchService->getAdminpanelList($request, $helper, $limitations, $authoredLimitations), 200);
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
                    if($limitation['model'] == $item['field']->model) {
                        switch($limitation['settings']->limitedConstraint) {
                            case 'not':
                                foreach($item['field']->values as $idx => $value) {
                                    if(in_array($value->value, $limitation['settings']->limitedAnswers)) {
                                        unset($item['field']->values[$idx]);
                                    }
                                }
                                break;
                            default:
                                foreach($item['field']->values as $idx => $value) {
                                    if(!in_array($value->value, $limitation['settings']->limitedAnswers)) {
                                        unset($item['field']->values[$idx]);
                                    }
                                }
                                break;
                        }
                    }
                }

                foreach($helper->user_limitations as $limitation) {
                    if($limitation['model'] == $item['field']->model) {
                        switch($limitation['settings']->limitedConstraint) {
                            case 'and':
                                foreach($item['field']->values as $idx => $value) {
                                    $user_answer = $user_answers['model'][$item['field']->model] ?? null;

                                    if(is_array($user_answer)) {
                                        if(!in_array($value->$value, $user_answers['model'][$item['field']->model])) {
                                            unset($item['field']->values[$idx]);
                                        }
                                    } else {
                                        if($value->value != $user_answer) {
                                            unset($item['field']->values[$idx]);
                                        }
                                    }
                                }
                                break;
                            case 'or':
                                 $fileterValues = [];

                                 foreach($item['field']->values as $idx => $value) {
                                    $fileterValues[] = $value->value;
                                 }

                                $user_answer = $user_answers['model'][$item['field']->model] ?? null;
                                $valueArray = is_array($user_answer) ? $user_answer : [$user_answer];
                                $intersec = array_intersect($fileterValues, $valueArray);

                                foreach($item['field']->values as $idx => $value) {
                                   if(!in_array($value->value, $intersec)) {
                                    unset($item['field']->values[$idx]);
                                   }
                                 }
                                break;
                            case 'not':
                                // Exclut les valeurs correspondant à la réponse utilisateur
                                $item['field']->values = array_filter($item['field']->values, function ($v) use ($user_answers, $item) {
                                    $userValue = $user_answers['model'][$item['field']->model] ?? null;
                                    return $v->value != $userValue;
                                });
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