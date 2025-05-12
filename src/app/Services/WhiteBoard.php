<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;

class WhiteBoard
{
    public $nebula = null;
    public $user = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->user = Auth::user();
    }

    public function saveWhiteBoard($request)
    {
        // todo a protéger
        // save as mongodb page
        $page = config('socializer.models.page')::updateOrCreate(
            [
                "server_id" => $request->get('server_id'),
                "room_id" => $request->get('room_id'),
                "vertexid" => $request->get('vertex_id'),
            ],
            [
                "model_id" => $this->user->id,
                "model_type" => get_class($this->user),
                "content" => $request->get('data'),
            ]
        );
    }

    public function loadWhiteBoard($request)
    {
        // todo a protéger
        $page = config('socializer.models.page')::where([
            "server_id" => $request->get('server_id'),
            "room_id" => $request->get('room_id'),
            "vertexid" => $request->get('vertex_id'),
        ])->first();

        return $page->content ?? null;
    }
}