<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Arr;
use Dauvray\Socializer\app\Models\Application;

class Store
{
    public $nebula = null;
    public $user = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->user = Auth::user();
    }

    public function getApplications($route_name = '')
    {
        $results = app('nebulaGraph')->execute("MATCH (m:marketplace)-[]-(a:application)-[:has_creator]->(u:user) RETURN a,u");

        dd($results);
        
        $app_ids = Arr::pluck($results, 'id');
        $applications = Application::whereIn('vertexid',$app_ids)->select('infos','vertexid')->get();
        $paginator = makePaginationCollection($applications, route($route_name));

        return $paginator;
    }
}