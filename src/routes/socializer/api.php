<?php

use Illuminate\Support\Facades\Route;
use Dauvray\Socializer\app\Services\Chat as ChatService;
use Illuminate\Http\Request;

Route::prefix('api')->group(function () {
   Route::post('/bot-response-answer', function (Request $request, ChatService $service) {
      // Récupère tout le JSON
      $data = $request->all();

      // $responseJson = $botResponse->body(); // chaîne JSON brute
       \Log::debug("message from n8n body", ['output' => $data['output'], 'chat' => $data['chat']]);
        // $responseArray = json_decode($responseJson, true); // tableau PHP

      // Vérifie que 'body' et 'output' existent
       $output = $data['output'] ?? '...';
       $conversation = $data['chat'] ?? null;

     
      $botMessage = [
         'chat_id' =>  $conversation['id'],
         'message' => $output,
         'user' => $conversation['bot_id'],
      ];

      $service->sendMessage(null, $botMessage, true);
         

   });
});

