<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Arr;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Dauvray\Socializer\app\Exceptions\NebulaGraphException;
use Dauvray\Socializer\app\Jobs\SendMessageToBot;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Response;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Log;
use Dauvray\Estarter\app\Helpers\ModelTraits\Thumbnails;
use Dauvray\Socializer\app\Http\Resources\MessageAuthor;
use Dauvray\Socializer\app\Http\Resources\MessageCollection;

class Chat
{
    use Thumbnails;

    public $user = null;
    public $nebula = null;
    public $usersOnlineService = null;

    public function __construct()
    {
        $this->user = Auth::user();
        $this->nebula = app('nebulaGraph');
        $this->usersOnlineService = app('onlineUsers');
    }

    /**
     * Inscrit l'auteur d'un message dans le chat — seulement s'il y a déjà sa place.
     *
     * ⚠️ Sans garde, cette méthode contournait `canJoinchatRoom` : un POST sur
     * `/send-chat-message` posait l'arête `registered_in` dans n'importe quel chat nommé, et le
     * join suivant devenait légitime — de façon permanente. Corriger le garde du canal sans
     * fermer ce chemin n'aurait rien fermé. Un garde n'est fermé que quand tous les chemins qui
     * écrivent son état le sont aussi. L'inscription d'un tiers passe par
     * `addContactToConversation`, jamais par ici.
     *
     * Le refus est un RETOUR, pas un `abort()` : les deux appelants ignorent la valeur, donc un
     * booléen ne casse personne, alors qu'un `abort` depuis `createAndDispatchMessage` couperait
     * la requête APRÈS l'écriture du message, du vertex et de deux arêtes, et AVANT la diffusion
     * — un message à demi écrit, jamais diffusé. Refuser l'ÉCRITURE d'un message dans un chat
     * dont on n'est pas membre est un correctif distinct.
     *
     * L'ordre des branches compte : « déjà inscrit » court-circuite le garde, pour que le chemin
     * nominal — chaque message envoyé — ne paie pas un aller-retour Thrift de plus.
     *
     * @return bool `true` si l'appelant est, ou vient d'être, inscrit.
     */
    public function checkRegistration($room_id): bool
    {
        // is registered in chat
        $is_registred = $this->nebula->execute('GO FROM "'.$this->user->vertexid.'" OVER registered_in WHERE id($$) == "'.$room_id.'" YIELD id($$) AS destination');

        // `execute()` rend un JsonResponse — un OBJET, donc truthy — quand nGQL échoue. Le
        // `if(!$is_registred)` d'origine y lisait « déjà inscrit » et passait son chemin.
        if (! is_array($is_registred)) {
            Log::warning('checkRegistration : le graphe n\'a pas répondu, inscription refusée', [
                'chat_vertexid' => $room_id,
                'user_vertexid' => $this->user->vertexid,
            ]);

            return false;
        }

        if ($is_registred !== []) {
            return true;
        }

        if (! $this->user->canJoinchatRoom($room_id)) {
            Log::warning('checkRegistration : inscription refusée dans un chat non joignable', [
                'chat_vertexid' => $room_id,
                'user_vertexid' => $this->user->vertexid,
            ]);

            return false;
        }

        // L'ÉCRITURE, elle aussi, peut échouer (E7) — et une inscription ratée annoncée réussie
        // rouvre exactement le trou que les branches ci-dessus viennent de fermer : l'appelant
        // conclut « inscrit », le message suivant se voit refuser le canal, et rien ne l'explique.
        try {
            setRegisteredRelation($this->user->vertexid, $room_id);
        } catch (NebulaGraphException $e) {
            Log::warning('checkRegistration : l\'inscription a été refusée par le graphe', $e->context() + [
                'chat_vertexid' => $room_id,
                'user_vertexid' => $this->user->vertexid,
            ]);

            return false;
        }

        return true;
    }

    /**
     * Inscrit l'appelant dans le chat d'un salon, si le SALON l'admet.
     *
     * Ce n'est pas une règle nouvelle : c'est exactement le garde que `channels.php` applique
     * déjà au canal `room.{roomId}`. Le chat d'un salon hérite ainsi de la décision de son
     * salon, au lieu d'être plus permissif que lui.
     *
     * ⚠️ Sans cette jambe, fermer `canJoinchatRoom` verrouillerait tout chat de salon pour
     * quiconque ne l'a pas créé : `getOrcreateChatVertice` n'inscrit que dans sa branche de
     * CRÉATION, et `ChatController::getOrcreateChatVertice` l'appelle sans valeurs — donc
     * `createConversation` retombe sur `privacy => 1`.
     *
     * Méthode distincte de `getOrcreateChatVertice` pour être testable : celle-ci finit par
     * `getConversation()`, qui lit les messages et pagine.
     */
    public function registerInRoomChat($room_id, $chat_vid): bool
    {
        if (! $this->user->canJoinRoom($room_id) && ! $this->user->isCreator($room_id)) {
            return false;
        }

        // Cf. `checkRegistration` : le garde décide, mais c'est l'écriture qui inscrit.
        try {
            setRegisteredRelation($this->user->vertexid, $chat_vid);
        } catch (NebulaGraphException $e) {
            Log::warning('registerInRoomChat : l\'inscription a été refusée par le graphe', $e->context() + [
                'chat_vertexid' => $chat_vid,
                'room_vertexid' => $room_id,
                'user_vertexid' => $this->user->vertexid,
            ]);

            return false;
        }

        return true;
    }

    public function sendMessage( ?Request $request, $options = [], $is_bot_answer = false ) 
    {
        $chat_id = $request?->get('chat_id') ?? $options['chat_id'] ?? null;

        if (!$chat_id) {
            throw new \InvalidArgumentException("Chat ID est requis.");
        }

        $is_audio = isset($options['audio_file']);
        $formated = ['content' => null, 'src' => null];
        $content = $request?->get('message') ?? $options['message'] ?? null;

        $result = $this->nebula->execute('
                MATCH (c) WHERE id(c)=="'. $chat_id .'"
                OPTIONAL MATCH (u:user)-[:registered_in]->(c) 
                RETURN c as chat, collect(id(u)) as users
        ');

        $result = $result[0];

        $chat = $result['chat'];
        $user = isset($options['user']) ? config('estarter.models.user')::find($options['user']) : $this->user;

        // update conversation title if provided
        if(isset($options['title']) && $options['title'] && !$chat['name']) {
            $this->updateConversationTitle($chat_id, $options['title']);
        }
       
        $registeredUsers = Arr::flatten($result['users']) ?? [];
        foreach ($registeredUsers as $idx => $registeredUser) {
            $registeredUsers[$idx] = getRealIdFromVertexId($registeredUser);
        }

        if(!$is_audio && $content) {
             $formated = formatTextToContent($content);
        }

        // Sauvegarder les fichiers si présents
        $uploadedFiles = $this->getNormalizedFiles($request, $options);
        $files = [];

        foreach ($uploadedFiles as $file) {
            $path = $file->store('chat_uploads/'. $chat_id, 'local');

            $fileData =  [
                'name' => $file->getClientOriginalName(),
                'path' => $path,
                'filename' => basename($path),
                'mime' => $file->getMimeType(),
                'size' => $file->getSize(),
            ];

            // Si le fichier est une image, générer une vignette
            if (str_starts_with($file->getMimeType(), 'image/')) {
                $fileData['thumbnail'] = '/serve-thumbnail/'. $this->createThumbnails($file) . '/large';
            }

            $files[] = $fileData;
        }
        
        $data = [
            'content' => $formated['content'],
            'src' => $formated['src'],
            'chat_id' => $chat_id,
            'extras' => [
                'is_bot_answer' => $is_bot_answer,
                'status' => 1,
                'audio' => $is_audio ? ['filename' => $options['audio_file'], 'path' => $options['audio_path']] : null,
                'files' => count($files) ? $files : null,
                'thumbnails' => $formated && isset($formated['thumbnails']) ? $formated['thumbnails'] : null,
            ],
        ];

        $message = $this->createAndDispatchMessage($data, $user, $registeredUsers);

        // si la room est un bot, on appelle l'url d'automation
        if(!$is_bot_answer && isset($chat['is_bot']) && $chat['is_bot'] == 1) {

            Broadcast::presence("chat.{$chat_id}")
                ->as('botWriting')
                ->sendNow();

            SendMessageToBot::dispatch(
                message: $message,
                chat: $chat,
                user: $this->user
            );
        }
    }

    private function createAndDispatchMessage(array $data, $author = null, $registeredUsers = [])
    {
        $author = $author ?? $this->user;

        $message = config('socializer.models.message')::create([
            "message" => $data['content'] ?? null,
            "message_src" => $data['src'] ?? null,
            "model_id" => $author->id,
            "model_type" => get_class($author),
            "room_id" => $data['chat_id'],
            "extras" => $data['extras'] ?? [],
        ]);

        if (!$message) return null;

        $message_identifier = hideIdentifier($message);

        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.message.name'), 
            array_merge(
                $this->nebula->populatePropsFromPattern(
                    $message,
                    config('socializer.nebulagraph.vertices.message')
                ),
                [
                    'mongoid' => $message->id,
                    'identifier' => $message_identifier
                ]  
            )
        );

        $vid = getVertexIdFromInsert($vertex);

        if (!$vid) return null;

        setPublishedInRelation($vid, $data['chat_id']);
        setHasCreatorRelation( $author->vertexid, $vid);

        $message->vertexid = $vid;
        $message->save();

        // register user in chat if not already registered
        if(!$data['extras']['is_bot_answer']) {
            $this->checkRegistration($data['chat_id']);
        }
       
        $params = [
            'message' => $message->message,
            'id' => $message->vertexid,
            'created_at' => $message->created_at,
            'author' => (new MessageAuthor($author))->resolve(),
            "extras" => $message->extras,
            'chat_id' => $data['chat_id'],
            'is_bot_answer' => $data['extras']['is_bot_answer'] ?? false,
        ];

        Broadcast::presence("chat.{$data['chat_id']}")
            ->as('receivedMsg')
            ->with($params)
            ->sendNow()
            ;

        // only when there is only two users ( real conversation )
        // here we check if the user is registered in the chat
        // if not but is online, we will send a private message to the user
        $chatOnlineUsers = Redis::smembers("presence:chat:{$data['chat_id']}");
        $chatOfflineUsers = array_diff($registeredUsers, $chatOnlineUsers);

        if(count($registeredUsers) == 2) {
            foreach($chatOfflineUsers as $user_id) {
                // check if the user is online
                $is_online = app('onlineUsers')->isOnlineUser($user_id);

                if ($is_online && $user_id != $this->user->id) {
                    Broadcast::private('App.Models.User.'.$user_id)
                    ->as('NewChatMessageNotification')
                    ->with($params)
                    ->sendNow();
                }
            }
        }

        return $message;
    }

    private function getNormalizedFiles(?Request $request, array $options): array
    {
        $files = [];

        // Cas 1 : Fichiers uploadés via la requête HTTP
        if ($request?->hasFile('files')) {
            return $request->file('files');
        }

        // Cas 2 : Fichiers passés dans $options['files'] (tableau de chemins)
        foreach ($options['files'] ?? [] as $path) {
            // Si le fichier est déjà un UploadedFile (ex: mock), on le garde tel quel
            if ($path instanceof UploadedFile) {
                $files[] = $path;
                continue;
            }

            // Si c'est un chemin valide, on le transforme
            if (is_string($path) && file_exists($path)) {
                $files[] = new UploadedFile(
                    path: $path,
                    originalName: basename($path),
                    mimeType: mime_content_type($path),
                    test: true // Important pour les fichiers "non uploadés"
                );
            }
        }

        return $files;
    }

    public function editMessage( $vertex_id )
    {
        $message = config('socializer.models.message')::where([
            ['vertexid', $vertex_id],
            ['model_id', $this->user->id],
        ])->first();

        if(!$message) {
            abort(404, 'Message not found');
        }

        return $message->message_src;
    }

    public function updateMessage(Request $request)
    {
        $room_id = $request->get('room_id');

        $message = config('socializer.models.message')::where([
            ['vertexid', $request->get('message_id')],
            ['room_id', $request->get('room_id')],
            ['model_id', $this->user->id],
        ])->first();

        if(!$message) {
            return false;
        }

        $formated = formatTextToContent($request->get('message'));

        $extras = $message->extras;
        $extras['edited'] = 1;
        $message->extras = $extras;
        $message->message = $formated['content'];
        $message->message_src = $formated['src'];
        $message->save();

        Broadcast::presence("chat.$room_id")
        ->as('updatedMsg')
        ->with([
            'message' => $message->message,
            'id' => $message->vertexid,
            'created_at' => $message->created_at,
            'author' => (new MessageAuthor($this->user))->resolve(),
            "extras" => $message->extras
        ])
        ->sendNow();
    }

    public function deleteMessage(Request $request )
    {
        $message = config('socializer.models.message')::where('vertexid', $request->get('message_id'))->first();
        $room_id = $request->get('chat_id');

        $message->extras['is_bot_answer'];

        if(!$message->extras['is_bot_answer'] && $message->model_id != $this->user->id) {
            return false;
        }

        // delete nebula vertex
        $this->nebula->deleteVertex([$message->vertexid], true);

        // delete audios
        if(isset($message->extras['audio']) && $message->extras['audio']) {
             Storage::disk('local')->delete($message->extras['audio']['path']);
        }

        // delete files
        if(isset($message->extras['files']) && count($message->extras['files'])) {
            foreach ($message->extras['files'] as $file) {
                Storage::disk('local')->delete($file['path']);
                if(isset($file['thumbnail']) && $file['thumbnail']) {
                    // delete thumbnail if exists
                    $this->deleteAllThumbnails($file['thumbnail']);
                }
            }
        }

        // delete thumbnails
        if(isset($message->extras['thumbnails']) && count($message->extras['thumbnails'])) {
            foreach ($message->extras['thumbnails'] as $thumbnail) {
                $this->deleteAllThumbnails($thumbnail);
            }
        }
        
        // delete message in mongo
        $message->delete();
       
        Broadcast::presence("chat.$room_id")
        ->as('deletedMessage')
        ->with([
            'vertexid' => $request->get('message_id'),
        ])
        ->sendNow();
    }
    
    public function setEmoji(Request $request )
    {
        $message = config('socializer.models.message')::where('vertexid', $request->get('message_id'))->first();
        $from = $request->get('from');
        $emoji = $request->get('emoji');
        $room_id = $request->get('room_id');

        if(!$emoji) {
            return false;
        }

        $extras = $message->extras;

        if(!is_array($extras)) {
            $extras = [];
        }
        if(!isset($extras['emojis'])) {
            $extras['emojis'] = [];
        }
        if(!isset($extras['emojis'][$emoji])) {
            $extras['emojis'][$emoji] = [];
        }

        // check if the user is already in the list for this emoji
        foreach ($extras['emojis'] as $emoji => $users) {
            // Vérifier si l'utilisateur est dans la liste pour cet emoji
            if (in_array($from, $users)) {
                
                // Supprimer l'utilisateur de la liste
                $extras['emojis'][$emoji] = array_values(array_filter($users, function($user) use ($from) {
                    return $user !== $from;
                }));
                // Si la liste d'utilisateurs est vide, supprimer l'entrée de l'emoji
                if (empty($extras['emojis'][$emoji])) {
                    unset($extras['emojis'][$emoji]);
                }
            }
        }

        $extras['emojis'][$emoji][] = $from;

        $message->extras = $extras;
        $message->save();

        Broadcast::presence("chat.$room_id")
        ->as('receivedEmoji')
        ->with([
            'emojis' => $message->extras['emojis'],
            'vertexid' => $message->vertexid,
            'from' => $from,
        ])
        ->sendNow();
    }

    public function getConversations($type = 'contacts')
    {
       return $this->user->conversations($type);
    }

    public function getConversation($vertex_id = null)
    {    
        // users = registered users + authors     
        $query =  "
            MATCH (c:chat) WHERE id(c) == '$vertex_id'
            OPTIONAL MATCH (c:chat)<-[:registered_in]-(us:user)
            OPTIONAL MATCH (c:chat)<-[:published_in]-(m:message)
            WITH c, collect(distinct us) as users, count(distinct us) as nb_contacts, id(m) as message_id, m.created_at as created_at
            ORDER BY created_at DESC
            RETURN c as chat, users, nb_contacts, collect(distinct(message_id)) as messages
        ";
       
        $result =  $this->nebula->execute($query);

        // messages
        $messages_vid = flattenArray(($result[0]['messages']), '', false);
        $messages = config('socializer.models.message')::whereIn('vertexid', $messages_vid)->orderBy('created_at', 'desc');
        unset($result[0]['messages']);

        $paginator = makePaginationQuery($messages, route('chat.get.conversation', $vertex_id));

        // set user in online chat connections
        $this->usersOnlineService->addUserItem('chat', $vertex_id);

        return [ 
            'general' => $result[0],
            'messages' => new MessageCollection($paginator),
        ];
    }

    public function createConversation($values = [], $room_id = null)
    {
        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.chat.name'),
            [
                'privacy' => isset($values['privacy']) ? (int)$values['privacy'] : 1,
                'is_bot' => isset($values['is_bot']) ? (int)$values['is_bot'] : 0,
                'bot_id' => isset($values['bot_id']) ? $values['bot_id'] : null,
                'position' => getNextPublishedPosition($room_id),
                'name' => isset($values['name']) ? $values['name'] : null
            ]
        );

        $vid = getVertexIdFromInsert($vertex);

        if(!$vid) {
            return false;
        }

        // chat / user relation
        setRegisteredRelation($this->user->vertexid, $vid);

        // chat / creator relation
        setHasCreatorRelation($this->user->vertexid, $vid);

       return $this->getConversation($vid);
    }

    public function updateConversationTitle($chat_id, $title)
    {
        $this->nebula->updateVertex(config('socializer.nebulagraph.tags.chat.name'), $chat_id, ['name' => $title]);

        Broadcast::presence("chat.{$chat_id}")
        ->as('updateConversationTitle')
        ->with(['title' => $title])
        ->sendNow()
        ;
    }

    public function getOrcreateChatVertice($room_id = null, $values = [])
    {
        $query =  "
                    MATCH (r:room) WHERE id(r) == '$room_id'
                    OPTIONAL MATCH (r:room)<-[:published_in]-(c:chat)
                    RETURN c as chat
                ";
        $result =  $this->nebula->execute($query);

        // ⚠️ `$result` peut être VIDE, et pas seulement `$result[0]` : le `MATCH (r:room)` ci-dessus
        // ne rend aucune ligne dès que `$room_id` ne désigne pas un vertex portant le tag `room`.
        // Sans ce `?? []`, l'accès à `$result[0]` levait « Undefined array key 0 » — c'est ce qui
        // cassait la création d'une room ClassRoom, dont `createClassroomVertice` passait ici l'id
        // de son vertex `classroom` (corrigé le 01/09/2026 côté appelant).
        //
        // La branche prise dans ce cas est la BONNE : aucune ligne ⇒ aucun chat rattaché ⇒ il faut
        // le créer. Le garde ne change donc pas l'intention, il la rend atteignable.
        if(!count($result[0] ?? [])) {
            $result = $this->createConversation($values, $room_id);
            $chat_vid = $result['general']['chat']['id'];

            // chat / room relation
            setPublishedInRelation($chat_vid, $room_id);

            // chat / user registered
            setRegisteredRelation($this->user->vertexid, $chat_vid);

            return $this->getConversation($chat_vid);
        }

        // Le chat existe déjà : l'inscription du visiteur est déléguée au garde du salon.
        $this->registerInRoomChat($room_id, $result[0]['id']);

       return $this->getConversation($result[0]['id']);
    }

    public function deleteConversation( $vertex_id = null )
    {
        $owner_id = $this->nebula->execute("MATCH (c:chat)-[:has_creator]->(u:user) where id(c) == '$vertex_id' return id(u)");

        if($owner_id[0] != $this->user->vertexid) {
            return false;
        }

        $this->nebula->deleteVertex([$vertex_id], true);
        config('socializer.models.message')::where('room_id', $vertex_id)->delete();

        return true;
    }

    public function quitConversation( $vertex_id = null )
    {
        $user_vid = $this->user->vertexid;
        $this->nebula->deleteEdge(config('socializer.nebulagraph.edges.registered_in.name'), ["$user_vid->$vertex_id"]);

        // check users
        $result = $this->nebula->execute("MATCH (c:chat) WHERE id(c)=='$vertex_id' 
                                        OPTIONAL MATCH (r:room)<-[:published_in]-(c)
                                        OPTIONAL MATCH (c)<-[:registered_in]-(u:user)
                                        RETURN count(u) as nb_users, r as room");


        // no more users in the chat, delete it if is not a chat room
        if($result[0]['nb_users'] === 0 && count($result[0]['room']) === 0) {

            $this->nebula->deleteVertex([$vertex_id], true);
            config('socializer.models.message')::where('room_id', $vertex_id)->delete();

        } else {

            $conversation = $this->getConversation($vertex_id, false);

            Broadcast::presence("chat.$vertex_id")
            ->as('updateChatters')
            ->with($conversation['general'])
            ->sendNow();
        }

        return true;
    }

    public function addContactToConversation(Request $request )
    {
        $contact = $request->get('contact');
        $chat_vid = $request->get('chat'); 

        if(!$this->user->canJoinchatRoom($chat_vid)) {
            return false;
        }

        $contact = revealIdentifier($contact);

        // chat / user relation
        setRegisteredRelation($contact->vertexid, $chat_vid);

        // send invitation to user
        $conversation = $this->getConversation($chat_vid, false);

        Broadcast::private('App.Models.User.'.$contact->id)
        ->as('ChatInvitation')
        ->with($conversation['general']['chat'])
        ->sendNow();

        // update chat informations
        Broadcast::presence("chat.$chat_vid")
        ->as('updateChatters')
        ->with($conversation['general'])
        ->sendNow();

        return true;
    }

    public function sendMessageAudio(Request $request)
    {
        $chat_id = $request->get('chat_id');

         $this->checkRegistration($chat_id);

        if (!$request->hasFile('audio')) {
            return response()->json(['error' => 'Aucun fichier reçu'], 400);
        }

        $file = $request->file('audio');

        $path = $file->store('chat_uploads/'.$chat_id, 'local');

        return[
            'success' => true,
            'audio_file' => basename($path),
            'audio_path' => $path,
        ];

    }

    public function getFile($vertex_id, $filename)
    {
        $path = "chat_uploads/{$vertex_id}/{$filename}";

        if (!Storage::disk('local')->exists($path)) {
            abort(404);
        }

        $mimeType = Storage::disk('local')->mimeType($path);

        return Response::make(Storage::disk('local')->get($path), 200, [
            'Content-Type' => $mimeType,
            'Content-Disposition' => 'inline; filename="'.$filename.'"',
        ]);
    }
}