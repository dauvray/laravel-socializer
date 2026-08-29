<?php

use Illuminate\Support\Facades\Route;

/*----------------------------------------------------------------------
| Comments
|----------------------------------------------------------------------*/

Route::post('/send-comment',
    config('socializer.controllers_front.comment').'@submitComment')
    ->name('comments.store');

Route::post('/send-sub-comment',
    config('socializer.controllers_front.comment').'@submitSubComment')
    ->name('subcomments.store');

Route::post('/delete-comment',
    config('socializer.controllers_front.comment').'@deleteComment')
    ->name('comments.delete');

/*----------------------------------------------------------------------
| Likes
|----------------------------------------------------------------------*/

Route::post('/send-like',
    config('socializer.controllers_front.like').'@submitLike')
    ->name('likes.store');

/*----------------------------------------------------------------------
| Walls
|----------------------------------------------------------------------*/

Route::get('/wall/{slug}', 
    config('socializer.controllers_front.wall').'@getWallOwner')
    ->name('wall.owner');

/*----------------------------------------------------------------------
| Feed
|----------------------------------------------------------------------*/

Route::get('/owner-feed/{idenfifier}', 
    config('socializer.controllers_front.feed').'@getOwnerFeed')
    ->name('feed.owner');

Route::get('/owner-wall/{idenfifier}/{owner?}', 
    config('socializer.controllers_front.feed').'@getOwnerWall')
    ->name('wall.owner2');

Route::get('/get-feed-posts/{feedid}', 
    config('socializer.controllers_front.feed').'@getFeedPosts')
    ->name('feed.posts');

Route::post('/send-feed-post',
    config('socializer.controllers_front.feed').'@sendFeedPost')
    ->name('feed.send.post'); 

Route::post('/share-feed-post',
    config('socializer.controllers_front.feed').'@shareFeedPost')
    ->name('feed.share.post'); 

Route::post('/delete-feed-post',
    config('socializer.controllers_front.feed').'@deleteFeedPost')
    ->name('feed.delete.post'); 

Route::post('/trigger-feed-activity',
    config('socializer.controllers_front.feed').'@triggerFeedActivity')
    ->name('feed.trigger.activity'); 

Route::post('/feed-subscribe-alert',
    config('socializer.controllers_front.feed').'@feedSubscribeAlert')
    ->name('feed.trigger.alert');

/*----------------------------------------------------------------------
| Chat
|----------------------------------------------------------------------*/

Route::get('/load-my-conversations/{type}', 
    config('socializer.controllers_front.chat').'@getConversations')
    ->name('chat.get.conversations');

Route::get('/load-conversation/{vertex_id}', 
    config('socializer.controllers_front.chat').'@getConversation')
    ->name('chat.get.conversation');

Route::post('/create-new-conversations', 
    config('socializer.controllers_front.chat').'@createConversation')
    ->name('chat.create.conversation');

Route::post('/get-or-create-chat-room', 
    config('socializer.controllers_front.chat').'@getOrcreateChatVertice')
    ->name('chat.create.room');

Route::get('/delete-conversation/{vertex_id}', 
    config('socializer.controllers_front.chat').'@deleteConversation')
    ->name('chat.delete.conversation');

Route::get('/quit-conversation/{vertex_id}', 
    config('socializer.controllers_front.chat').'@quitConversation')
    ->name('chat.quit.conversation');

Route::post('/send-chat-message',
    config('socializer.controllers_front.chat').'@sendMessage')
    ->name('chat.send');

Route::get('/edit-chat-message/{vertex_id}', 
    config('socializer.controllers_front.chat').'@editMessage')
    ->name('chat.edit');

Route::post('/delete-chat-message',
    config('socializer.controllers_front.chat').'@deleteMessage')
    ->name('chat.delete');

Route::post('/send-chat-audio',
    config('socializer.controllers_front.chat').'@sendMessageAudio')
    ->name('chat.send.audio');

Route::post('/update-chat-message',
    config('socializer.controllers_front.chat').'@updateMessage')
    ->name('chat.update');
    
Route::post('/send-chat-emoji',
    config('socializer.controllers_front.chat').'@setEmoji')
    ->name('chat.send.emoji');

Route::post('/add-contact-to-conversation',
    config('socializer.controllers_front.chat').'@addContactToConversation')
    ->name('chat.add.contact');

Route::get('/chat/file/{vertex_id}/{filename}',
    config('socializer.controllers_front.chat').'@getFile')
    ->name('chat.get.file');
    
/*----------------------------------------------------------------------
| Servers
|----------------------------------------------------------------------*/

Route::post('/create-user-server', 
    config('socializer.controllers_front.server').'@createUserServer')
    ->name('server.create');

Route::post('/update-server', 
    config('socializer.controllers_front.server').'@updateServer')
    ->name('server.update');

Route::post('/update-server-rooms', 
    config('socializer.controllers_front.server').'@updateServerRooms')
    ->name('server.update.rooms');

Route::get('/delete-user-server/{vertex_id}', 
    config('socializer.controllers_front.server').'@deleteUserServer')
    ->name('server.delete');

Route::get('/get-registered-servers', 
    config('socializer.controllers_front.server').'@getRegisteredServers')
    ->name('server.load.registered');

Route::get('/get-all-servers', 
    config('socializer.controllers_front.server').'@getAllServers')
    ->name('server.load.all');

Route::get('/load-server/{vertex_id}', 
    config('socializer.controllers_front.server').'@getServer')
    ->name('server.get.server');

Route::get('/check-server-access/{vertex_id}', 
    config('socializer.controllers_front.server').'@checkServerAccess')
    ->name('server.check.access');

Route::post('/request-server-access', 
    config('socializer.controllers_front.server').'@requestServerAccess')
    ->name('server.request.access');

Route::post('/response-server-access', 
    config('socializer.controllers_front.server').'@responseServerAccess')
    ->name('server.response.access');

/*----------------------------------------------------------------------
| Questionnaires
|----------------------------------------------------------------------*/    

Route::post('/get-server-questionnaire', 
    config('socializer.controllers_front.server').'@getServerQuestionnaires')
    ->name('server.get.questionnaire');

Route::post('/save-server-questionnaire', 
    config('socializer.controllers_front.server').'@manageServerQuestionnaires')
    ->name('server.manage.questionnaire');

Route::post('/update-server-questionnaire', 
    config('socializer.controllers_front.server').'@updateServerQuestionnaires')
    ->name('server.update.questionnaire');

Route::post('/load-server-questionnaire-list', 
    config('socializer.controllers_front.server').'@getServerQuestionnaireList')
    ->name('server.get.questionnaires');

Route::post('delete-server-questionnaire',
    config('socializer.controllers_front.server').'@deleteServerQuestionnaire');

Route::post('/send-social-answers', 
    config('socializer.controllers_front.server').'@sendQuestionnaireAnswers');

Route::post('/get-answers-server/{server_id}', 
    config('socializer.controllers_front.server').'@getQuestionnaireAnswers');

// Route::post('/send-server-questionnaire-filters', 
//     config('socializer.controllers_front.server').'@applyFilters');
   
Route::post('/get-server-questionnaire-filters', 
    config('socializer.controllers_front.server').'@getQuestionnaireFilters');    

Route::post('/renderer-server-questionnaire',
    config('socializer.controllers_front.server').'@getJSONRender');

Route::post('/get-server-panel-answers-list',
    config('socializer.controllers_front.server').'@getAdminpanelList');

Route::post('/delete-server-answer-questionnaire',
    config('socializer.controllers_front.server').'@deleteAnswersQuestionnaire');

Route::post('/search-server-input-results',
    config('socializer.controllers_front.server').'@searchServerInputResults');

/*-------------------------- AI ---------------------------------------*/

Route::post('/create-ia-questionnaire',
    config('socializer.controllers_front.questionnaire_ia').'@createIAQuestionnaire');

/*----------------------------------------------------------------------
| Rooms
|----------------------------------------------------------------------*/

Route::post('/create-server-room', 
    config('socializer.controllers_front.server').'@createRoomServer')
    ->name('server.create.room');

Route::post('/create-sub-content', 
    config('socializer.controllers_front.server').'@createSubContent')
    ->name('server.create.subcontent');

Route::post('/update-server-room', 
    config('socializer.controllers_front.server').'@updateRoomServer')
    ->name('server.update.room');

Route::get('/delete-server-room/{vertex_id}', 
    config('socializer.controllers_front.server').'@deleteRoom')
    ->name('server.delete.room');

Route::get('/load-room/{room_id}', 
    config('socializer.controllers_front.server').'@getRoom')
    ->name('server.get.room');

Route::post('/add-room_module', 
    config('socializer.controllers_front.server').'@addRoomModule')
    ->name('server.module.add');

 /*----------------------------------------------------------------------
| Pages
|----------------------------------------------------------------------*/

Route::get('/get-room-page/{page_id}', 
    config('socializer.controllers_front.page').'@loadPage')
    ->name('server.get.page');

Route::post('/update-room-page', 
    config('socializer.controllers_front.page').'@updatePage')
    ->name('server.update.page');

Route::post('/generate-room-page', 
    config('socializer.controllers_front.page').'@generatePage')
    ->name('server.generate.page');


/*----------------------------------------------------------------------
| Users
|----------------------------------------------------------------------*/

Route::post('/get-user-list',
    config('socializer.controllers_front.user').'@getUsersList')
    ->name('users.load');

// `/send-alert-to-user` était ici : c'est une route d'invitation d'appel WebRTC (ses seuls
// appelants sont usePeerCore et le module v1 mort), elle vit désormais dans la section WEBRTC
// avec les autres routes de signalisation et leur plafond.

/*----------------------------------------------------------------------
| Followers
|----------------------------------------------------------------------*/

Route::post('/follow-user', 
    config('socializer.controllers_front.user').'@followUser')
    ->name('users.follow');
    
Route::post('/unfollow-user', 
    config('socializer.controllers_front.user').'@unfollowUser')
    ->name('users.unfollow');


/*----------------------------------------------------------------------
| Images
|----------------------------------------------------------------------*/

Route::post('/update-avatar', 
    config('socializer.controllers_front.user').'@updateAvatar')
    ->name('users.avatar.update');

Route::post('/update-cover', 
    config('socializer.controllers_front.user').'@updateCover')
    ->name('users.cover.update');

    /****************************
     * FILES VueFinder
     ****************************/
Route::any('/server-finder-files', 
    config('socializer.controllers_front.server').'@getVueFinderFiles')
    ->name('server.files.index');

/*----------------------------------------------------------------------
| WhiteBoard
|----------------------------------------------------------------------*/

Route::post('/save-white-board', 
    config('socializer.controllers_front.whiteboard').'@saveWhiteBoard')
    ->name('whiteboard.save');


Route::post('/load-white-board', 
    config('socializer.controllers_front.whiteboard').'@loadWhiteBoard')
    ->name('whiteboard.load');

/*----------------------------------------------------------------------
| Application IA
|----------------------------------------------------------------------*/

Route::post('/save-ia-application', 
    config('socializer.controllers_front.application_ia').'@saveApplicationIA')
    ->name('iaApp.save');

Route::post('/load-ia-application', 
    config('socializer.controllers_front.application_ia').'@loadApplicationIA')
    ->name('iaApp.load');

Route::post('/app-ia-database-action', 
    config('socializer.controllers_front.application_ia').'@databaseAction')
    ->name('iaApp.database');

/*----------------------------------------------------------------------
| Store
|----------------------------------------------------------------------*/

Route::post('/get-store-applications', 
    config('socializer.controllers_front.store').'@getApplications')
    ->name('store.load.applications');


/*...................... WEBRTC .....................*/

/*
| Les 5 routes de signalisation portent un plafond serveur — le limiteur de `usePeerCore` vit
| dans le bundle et se retire en une ligne. Deux buckets, parce que les cadences légitimes ne
| sont pas les mêmes : le mesh encaisse 14 demandes dans le même tick au join d'une room, quand
| l'invitation d'appel naît d'un clic humain. Valeurs et arithmétique dans
| `config/socializer.php` → `signaling.throttle` ; limiteurs dans
| `ServiceProvider::registerSignalingRateLimiters()`.
*/

Route::middleware('throttle:socializer-signaling')->group(function () {

    Route::post('/ask-to-peer-id',
        config('socializer.controllers_front.user').'@askForPeerId')
        ->name('users.peer.ask');

    Route::post('/response-to-peer-id',
        config('socializer.controllers_front.user').'@responseToPeerId')
        ->name('users.peer.response');

    Route::post('/close-connection-to-peer-id',
        config('socializer.controllers_front.user').'@closeConnectionToPeerId')
        ->name('users.peer.close');

    /*
    | Les deux routes d'attestation. Elles NE RELAIENT RIEN vers un tiers — aucun
    | `Broadcast::...->sendNow()`, donc aucune victime à protéger d'une cadence : le plafond
    | qu'elles portent est celui du groupe, pas une borne dimensionnée pour elles. Il est
    | néanmoins juste ici, contrairement à `/get-ice-servers` qui reste volontairement sans
    | `throttle` : celle-là est publique, donc sans émetteur à mettre en clé — ces deux-ci sont
    | privées, et `socializer-signaling` compose sa clé sur l'utilisateur authentifié.
    |
    | Cadence attendue : une requête d'attestation par cycle de vie de `Peer` puis une par
    | échéance de TTL (5 min), et une vérification par peerId inconnu — mise en cache côté
    | client jusqu'à l'échéance de l'attestation. Loin sous le bucket mesh, qui est dimensionné
    | pour une rafale de join de 14 requêtes dans le même tick.
    */

    Route::post('/attest-peer-id',
        config('socializer.controllers_front.webrtc').'@attestPeerId')
        ->name('webrtc.attestation.issue');

    Route::post('/verify-peer-attestation',
        config('socializer.controllers_front.webrtc').'@verifyPeerAttestation')
        ->name('webrtc.attestation.verify');
});

Route::middleware('throttle:socializer-call-invite')->group(function () {

    Route::post('/send-alert-to-user',
        config('socializer.controllers_front.user').'@sendAlertToUser')
        ->name('user.alert');

    Route::post('/response-to-authorization-peer',
        config('socializer.controllers_front.user').'@responseToPeerAuthorization')
        ->name('users.peer.response.authorization');
});
