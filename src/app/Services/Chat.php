<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Broadcast;
use Dauvray\Socializer\app\Http\Resources\MessageCollection;
use Dauvray\Socializer\app\Http\Resources\User as UserResource;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Response;
use Illuminate\Http\Request;

class Chat
{
    public $user = null;
    public $nebula = null;

    public function __construct()
    {
        $this->user = Auth::user();
        $this->nebula = app('nebulaGraph');
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

    public function sendMessage( Request $request, $options = [] ) 
    {
        $is_audio = isset($options['audio_file']);
        $room_id = $request->get('room_id');
        $formated = null;
        $content = $request->get('message');

        if(!$is_audio && $content) {
             $formated = formatTextToContent($content);
        }

        // Sauvegarder les fichiers si présents
        $files = [];
        if ($request->hasFile('files')) {
            foreach ($request->file('files') as $file) {
                $path = $file->store('chat_uploads/'.$room_id, 'local');
                $files[] = [
                    'name' => $file->getClientOriginalName(),
                    'path' => $path,
                    'filename' => basename($path),
                    'mime' => $file->getMimeType(),
                    'size' => $file->getSize(),
                ];
            }
        }


        $message = config('socializer.models.message')::create([
            "message" => $formated ? $formated['content'] : null,
            "message_src" => $formated ? $formated['src'] : null,
            "model_id" => $this->user->id,
            "model_type" => get_class($this->user),
            "room_id" => $room_id,
            "extras" => [
                'status' => 1,
                'audio' => $is_audio ? ['filename' => $options['audio_file'], 'path' => $options['audio_path']] : null,
                'files' => count($files) ? $files : null,
            ],
        ]);

        if(!$message) {
            return false;
        }

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

        if(!$vid) {
            return false;
        }

        $this->checkRegistration($room_id);
        
        // message / chat relation
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.published_in.name'), 
            [
                $vid.'->'.$room_id => config('socializer.nebulagraph.edges.published_in.props')
            ]
        );

        // message / author relation
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.has_creator.name'), 
            [
                $vid.'->'.$this->user->vertexid => config('socializer.nebulagraph.edges.has_creator.props')
            ]
        );

        $message->vertexid = $vid;
        $message->save();

        Broadcast::presence("chat.$room_id")
        ->as('receivedMsg')
        ->with([
            'message' => $message->message,
            'id' => $message->vertexid,
            'created_at' => $message->created_at,
            'author' => new UserResource($this->user),
            "extras" => $message->extras,
        ])
        ->sendNow();
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
            'author' => new UserResource($this->user),
            "extras" => $message->extras
        ])
        ->sendNow();
    }

    public function deleteMessage(Request $request )
    {
        $message = config('socializer.models.message')::where('vertexid', $request->get('message_id'))->first();
        $room_id = $request->get('room_id');

        if($message->model_id != $this->user->id) {
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

    public function getConversations()
    {
       return $this->user->conversations();
    }

    public function getConversation( $vertex_id = null)
    {    
        // users = registered users + authors     
        $query =  "
            MATCH (c:chat) WHERE id(c) == '$vertex_id'
            MATCH (c:chat)<-[:registered_in]-(us:user)
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

        return [ 
            'general' => $result[0],
            'messages' => new MessageCollection($paginator),
        ];
    }

    public function createConversation($private = true)
    {
        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.chat.name'),
            [
                'privacy' => (int)$private,
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

        return $vid;
    }

    public function createChatVertice($room_id = null, $private = true)
    {
        $chat_vid = $this->createConversation($private);

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
        $nb_users = $this->nebula->execute("MATCH (c:chat)<-[:registered_in]-(u:user) WHERE id(c)=='$vertex_id' RETURN count(u)");

        if($nb_users[0] === 0) {

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
        $room_id = $request->get('room_id');

         $this->checkRegistration($room_id);

        if (!$request->hasFile('audio')) {
            return response()->json(['error' => 'Aucun fichier reçu'], 400);
        }

        $file = $request->file('audio');

        $path = $file->store('chat_uploads/'.$room_id, 'local');

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