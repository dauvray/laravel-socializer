<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Arr;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Response;
use Illuminate\Support\Facades\Broadcast;
use Dauvray\Estarter\app\Helpers\ModelTraits\Thumbnails;
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

    public function checkRegistration($room_id)
    {
        // is registered in chat
        $is_registred = $this->nebula->execute('GO FROM "'.$this->user->vertexid.'" OVER registered_in WHERE id($$) == "'.$room_id.'" YIELD id($$) AS destination');

        if(!$is_registred) {
           // user / chat relation
            $this->nebula->insertEdge(
                config('socializer.nebulagraph.edges.registered_in.name'), 
                [
                    $this->user->vertexid.'->'.$room_id => config('socializer.nebulagraph.edges.registered_in.props')
                ]
            );
        }
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
        $result =  $this->nebula->execute('
                MATCH (c) WHERE id(c)=="'. $chat_id .'"
                OPTIONAL MATCH (u:user)-[:registered_in]->(c) 
                RETURN c as chat, collect(id(u)) as users
        ')[0];
        $chat = $result['chat'];
        $user = $options['user'] ?? $this->user;
        $registeredUsers = Arr::flatten($result['users']) ?? [];

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
            $this-> notifyBot($chat, $message);
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

        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.published_in.name'), 
            [
                $vid.'->'.$data['chat_id'] => config('socializer.nebulagraph.edges.published_in.props')
            ]
        );

        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.has_creator.name'), 
            [
                $vid.'->'.$author->vertexid => config('socializer.nebulagraph.edges.has_creator.props')
            ]
        );

        $message->vertexid = $vid;
        $message->save();

        // register user in chat if not already registered
        $this->checkRegistration($data['chat_id']);

        $params = [
                'message' => $message->message,
                'id' => $message->vertexid,
                'created_at' => $message->created_at,
                'author' => filterSensibleDataUserRessource($author),
                "extras" => $message->extras,
                'chat_id' => $data['chat_id'],
        ];

        Broadcast::presence("chat.{$data['chat_id']}")
            ->as('receivedMsg')
            ->with($params)
            ->sendNow();

        // only when there is only two users ( real conversation )
        // here we check if the user is registered in the chat
        // if not but is online, we will send a private message to the user
        $chatOnlineUsers = Redis::smembers("presence:chat:{$data['chat_id']}");
        $chatOfflineUsers = array_diff($registeredUsers, $chatOnlineUsers);

        if(count($registeredUsers) == 2) {
            foreach($chatOfflineUsers as $vertex_id) {

                $user_id = getRealIdFromVertexId($vertex_id);
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

    private function notifyBot(array $chat, object $message): void
    {

        // TODO mettre dans une queue job   


        $botResponse = Http::post($chat['url_bot'], [
            'message' => $message->message_src,
            'author' => ['name' => $this->user->name, 'id' => $this->user->id],
            'room_id' => $chat['id'],
        ]);

        $response = $botResponse->json('message') ?? '...';

        $botMessage = [
            'chat_id' =>  $chat['id'],
            'message' => $response,
            'user' => config('estarter.models.user')::find(
                config('socializer.agents_ai.chatbot.user_id')
            ),
        ];
      
        $this->sendMessage(null, $botMessage, true);
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
            'author' => filterSensibleDataUserRessource($author),
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
        $messages = config('socializer.models.message')::whereIn('vertexid', $messages_vid)->get();
        unset($result[0]['messages']);

        $paginator = makePaginationCollection($messages->reverse(), route('chat.get.conversation', $vertex_id));

        // set user in online chat connections
        $this->usersOnlineService->addUserItem('chat', $vertex_id);

        return [ 
            'general' => $result[0],
            'messages' => new MessageCollection($paginator),
        ];
    }

    public function createConversation($values = [])
    {
        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.chat.name'),
            [
                'privacy' => isset($values['privacy']) ? (int)$values['privacy'] : 1,
                'is_bot' => isset($values['is_bot']) ? (int)$values['is_bot'] : 0,
                'url_bot' => isset($values['url_bot']) ? $values['url_bot'] : null,
            ]
        );

        if(!is_array($vertex)) {
            return response()->json($vertex, 500);
        } 

        $vid = getVertexIdFromInsert($vertex);

        if(!$vid) {
            return false;
        }

        // chat / user relation
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.registered_in.name'), 
            [
                $this->user->vertexid.'->'.$vid => config('socializer.nebulagraph.edges.registered_in.props')
            ]
        );

        // chat / creator relation
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.has_creator.name'), 
            [
                $vid.'->'.$this->user->vertexid => config('socializer.nebulagraph.edges.has_creator.props')
            ]
        );

       return $this->getConversation($vid);
    }

    public function createChatVertice($room_id = null, $values = [])
    {
        $result = $this->createConversation($values);
        $chat_vid = $result['general']['chat']['id'];

        // chat / room relation
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.published_in.name'), 
            [
                $chat_vid.'->'.$room_id => config('socializer.nebulagraph.edges.published_in.props')
            ]
        );
        // chat / user registered
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.registered_in.name'), 
            [
                $this->user->vertexid.'->'.$chat_vid => config('socializer.nebulagraph.edges.registered_in.props')
            ]
        );

        return $chat_vid;
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
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.registered_in.name'), 
            [
                $contact->vertexid.'->'.$chat_vid => config('socializer.nebulagraph.edges.registered_in.props')
            ]
        );

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