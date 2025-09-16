<?php

use Backpack\PageManager\app\Models\Page;
use Illuminate\Support\Facades\Route;
use Dauvray\Socializer\app\Services\Chat as ChatService;
use Dauvray\Socializer\app\Services\Page as PageService;
use Illuminate\Http\Request;

Route::prefix('api')->group(function () {

   // Endpoint to handle bot response answers
   Route::post('/bot-response-answer', function (Request $request, ChatService $service) {
      // Récupère tout le JSON
      $data = $request->all();

      // Vérifie que 'body' et 'output' existent
       $output = json_decode($data['output']) ?? '...';
       $conversation = $data['chat'] ?? null;

      $botMessage = [
         'chat_id' =>  $conversation['id'],
         'title' => $output->title ?? 'Réponse',
         'message' => $output->message,
         'user' => $conversation['bot_id'],
      ];

      $service->sendMessage(null, $botMessage, true);
   });

   Route::post('/copywriter-generated-page', function (Request $request, PageService $service) {
      // Récupère tout le JSON
      $data = $request->all();
      $service->storeGeneratedPage($data);
   });

});

