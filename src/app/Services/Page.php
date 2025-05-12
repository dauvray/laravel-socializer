<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;

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

        if(!is_array($vertex)) {
            return false;
        } 

        $vid = getVertexIdFromInsert($vertex);

        if(!$vid) {
            return false;
        }

        // page / creator relation
        $this->nebula->insertEdge(
            config('socializer.nebulagraph.edges.has_creator.name'), 
            [
                $vid.'->'.$this->user->vertexid => config('socializer.nebulagraph.edges.has_creator.props')
            ]
        );
        
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
}