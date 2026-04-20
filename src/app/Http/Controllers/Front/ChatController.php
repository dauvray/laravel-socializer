<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Dauvray\Socializer\app\Services\Chat as ChatService;

class ChatController extends Controller
{
    public function sendMessage(Request $request, ChatService $service) 
    {
        $request->validate([
            'chat_id' => 'required',
            'message' => 'required_without:files|string|nullable|max:1000',
            'files' => 'array|nullable',
            'files.*' => 'file|max:10240', // max 10 Mo par fichier
        ]);

        $service->sendMessage($request);
    }

    public function updateMessage(Request $request, ChatService $service) 
    {
        $request->validate([
            'message' => 'required_without:files|string|nullable|max:1000',
            'message_id' => 'required',
            'files' => 'array|nullable',
            'files.*' => 'file|max:10240', // max 10 Mo par fichier
            'room_id' => 'required',
        ]);

        $service->updateMessage($request);
    }

    public function editMessage(ChatService $service, $vertex_id = null)
    {
        return response($service->editMessage($vertex_id), 200);
    }

    public function deleteMessage(Request $request, ChatService $service)
    {
        $request->validate([
            'message_id' => 'required',
            'chat_id' => 'required',
        ]);

        $service->deleteMessage($request);
    }

    public function sendMessageAudio(Request $request, ChatService $service)
    {
        $request->validate([
            'audio' => 'required|file|mimes:webm',
            'chat_id' => 'required',
        ]);

        $result = $service->sendMessageAudio($request);

        if($result['success']) {
              $service->sendMessage($request, $result);
        } else {
            return response()->json(['message' => 'Enregistrement impossible'], 500);
        }
    }

    public function setEmoji(Request $request, ChatService $service)
    {
        $service->setEmoji($request);
    }

    public function getConversations(ChatService $service, $type = 'contacts')
    {
        return response()->json($service->getConversations($type), 200);
    }

    public function getConversation(ChatService $service, $vertex_id = null)
    {
        $result = $service->getConversation($vertex_id);

        if($result) {
            return response()->json($result, 200);
        }

        return response()->json(['message' => 'Conversation introuvable'], 404);
    }

    public function leaveConversation(ChatService $service, $vertex_id = null)
    {
        $service->leaveConversation( $vertex_id );
    }

    public function createConversation(Request $request, ChatService $service)
    {
       if( $result = $service->createConversation($request->all())) {
            return response()->json(['conversation' => $result, 'message' => "Conversation crée"], 200);
       } 

       return response()->json(['message' => 'Impossible de créer une conversation'], 500);
    }

    public function deleteConversation(ChatService $service, $vertex_id = null)
    {
        if( $result = $service->deleteConversation( $vertex_id )) {
            return response()->json(['message' => 'Conversation supprimée', 'id' => $vertex_id], 200);
           } 
    
           return response()->json(['message' => 'Impossible de supprimer la conversation'], 500);
    }

    public function quitConversation(ChatService $service, $vertex_id = null)
    {
        if( $result = $service->quitConversation( $vertex_id )) {
            return response()->json(['message' => 'Vous avez quitté la conversation', 'id' => $vertex_id], 200);
           } 
    
           return response()->json(['message' => 'Impossible de quitter la conversation'], 500);
    }

    public function addContactToConversation(Request $request, ChatService $service)
    {
        if($service->addContactToConversation($request)) {
            return response()->json(['message' => 'Contact ajouté'], 200);
        }

        return response()->json(['message' => 'Impossible d\'ajouter ce contact'], 500);
    }

    public function getFile( ChatService $service, $vertex_id, $filename)
    {
        return $service->getFile($vertex_id, $filename);
    }

    public function getOrcreateChatVertice(Request $request, ChatService $service)
    {
        $request->validate([
            'identifier' => 'required',
        ]);

        $result = $service->getOrCreateChatVertice($request->identifier);

        if($result) {
            return response()->json($result, 200);
        }

       return response()->json(['message' => 'Impossible de trouver ou créer une conversation'], 500);
    }
}