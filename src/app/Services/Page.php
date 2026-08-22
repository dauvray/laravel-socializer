<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;

class Page
{
    public $user = null;
    public $nebula = null;

    public function __construct()
    {
        $this->user = Auth::user();
        $this->nebula = app('nebulaGraph');
    }

    public function createPageVertice($server_id = null, $room_id = null, $new_content = [])
    {
        // create mongodb page
        $page = config('socializer.models.page')::create([
            "model_id" => $this->user->id,
            "model_type" => get_class($this->user),
            "server_id" => $server_id,
            "room_id" => $room_id,
            "content" => '',
        ]);


        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.page.name'),
            array_merge([
                "page_id" => $page->id,
                'position' => getNextPublishedPosition($room_id)
            ], $new_content)
        );

        $vid = getVertexIdFromInsert($vertex);

        if(!$vid) {
            return false;
        }

        // page / creator relation ( voir si utile )
       // setHasCreatorRelation($vid, $this->user->vertexid);
        
        $page->vertexid = $vid;
        $page->save();

        return $vid;
    }

    public function loadPage($page_id)
    {
        // mongo or nebula version
        $page = config('socializer.models.page')::where('id', $page_id)
            ->orWhere('vertexid', $page_id)
            ->first();

        if($page) {
            return $page;
        }

        return false;
    }

    public function updatePage($request)
    {
        $page = $this->loadPage($request->get('pageid'));

        if(!$this->user->isServerOwner($page->server_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        $page->content = $request->get('content');
        $page->styles = $request->get('styles');
        $page->script = $request->get('script');
        $page->save();

        return [
            'page' => renderContentToBlade($page->content),
        ];
    }

    public function deletePage($page_id)
    {
        $page = $this->loadPage($page_id);
        if($page) {
            $page->delete();
            $this->nebula->deleteVertex([$page_id], true);
        }
    }

    public function generatePage($request)
    {
        $server_id = $request->get('server_id');
        $page_id = $request->get('page_id');
        $bot_id = config('socializer.agents_ai.copywriter.user_id'); // todo : a dynamiser
        $prompt = $request->get('prompt');
        $prompt_id = $request->get('prompt_id');

        if(!$this->user->isServerOwner($server_id)) {
            return response()->json(['message' => 'Non autorisé'], 401);
        }

        $chatbot = config('estarter.models.user')::find($bot_id); 

        Http::post($chatbot->extras['webhook_url'], [
            'assistantPrompt' => $chatbot->extras['prompt'] ?? '',
            'chatInput' => $prompt,
            'author' => ['name' => $this->user->name, 'id' => $this->user->id],
            'html' => $request->get('html'),
            'styles' => $request->get('styles'),
            'script' => $request->get('script'),
            'document' => [
                'id' => $page_id, 
                'bot_id' => $bot_id,
                'server_id' => $server_id,
                'prompt_id' => $prompt_id,
            ],
        ]);
    }

    public function storeGeneratedPage($data = null)
    {
        $result = $data['output'] ?? null;
        $document = $data['document'] ?? null;
        $author = $data['author'] ?? null;
        
        if($document && $result && $author) {

            $page_id = $document['id'];
            $page = config('socializer.models.page')::where('vertexid',  $page_id)->first();

            $page->content = $result['html'] ?? $page->content;
            $page->styles = $result['styles'] ?? $page->styles;
            $page->script = $result['script'] ?? $page->script;
            $page->save();

            broadcastEventbusNotification($author['id'], ['prompt_id' => $document['prompt_id'], 'output' => null]);

        }
    }
}