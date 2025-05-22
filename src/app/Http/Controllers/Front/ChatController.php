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
            'message' => 'required',
            'room_id' => 'required',
        ]);

        $service->sendMessage($request);
    }

    public function deleteMessage(Request $request, ChatService $service)
    {
        $request->validate([
            'message_id' => 'required',
            'room_id' => 'required',
        ]);

        $service->deleteMessage($request);
    }

    public function setEmoji(Request $request, ChatService $service)
    {
        $service->setEmoji($request);
    }

    public function getConversations(ChatService $service)
    {
        return response()->json($service->getConversations(), 200);
    }

    public function getConversation(ChatService $service, $vertex_id = null)
    {
        $result = $service->getConversation($vertex_id);

        if($result) {
            return response()->json($result, 200);
        }

        return response()->json(['message' => 'Conversation introuvable'], 404);
    }

    public function createConversation(ChatService $service)
    {
       if( $result = $service->createConversation()) {
        return response()->json(['id' => $result, 'message' => "Conversation crée"], 200);
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
}