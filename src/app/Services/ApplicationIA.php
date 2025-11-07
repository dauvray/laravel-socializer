<?php

namespace Dauvray\Socializer\app\Services;

use Illuminate\Support\Facades\Auth;

class ApplicationIA
{
    public $nebula = null;
    public $user = null;

    public function __construct()
    {
        $this->nebula = app('nebulaGraph');
        $this->user = Auth::user();
    }

    public function createApplicationVertice($vid, $new_content)
    {
        // todo a protéger
        unset($new_content['content_type']);

        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.application.name'),
            $new_content
        );

        if(!is_array($vertex)) {
            return false;
        } 

        $new_vid = getVertexIdFromInsert($vertex);

        if(!$new_vid) {
            return false;
        }

        // create mongodb application
        $application = config('socializer.models.application')::create([
            "model_id" => $this->user->id,
            "model_type" => get_class($this->user),
            "vertexid" => $new_vid,
            "infos" => null,
            "code" => null,
            "specs" => null,
            "data" => null,
        ]);

        $application->code =  [
            "name" => 'SFC',
            "dependencies" => ['Vue', 'bootstrap', 'vue-i18n','bootstrap.js'],
            "template" => '<h1>{{ $t("message.hello") }}</h1>',
            "script" => "{  name: 'SFC',props: ['users', 'room', 'database'],  data() {return { }}}",
            "style" => '',
            'translations' => [
                'fr' => [
                    'message' => [
                        'hello' => 'Bonjour',
                    ],
                ],
                'en' => [
                    'message' => [
                        'hello' => 'Hello',
                    ],
                ],
            ], 
            "metadata" => [
                "version" => "1.0.0",
                "createdAt" => "current date",
                "author" => "Creator Name",
                "description" => "component description"
            ]
            ];

        $application->save();
        
        // application / room relation
        setPublishedInRelation($new_vid, $vid);

        // application / creator relation
        setHasCreatorRelation($this->user->vertexid, $new_vid);

        // create page to store application database 
        $vertex = $this->nebula->insertVertex(
            config('socializer.nebulagraph.tags.page.name'),
            $new_content
        );

        if(!is_array($vertex)) {
            return false;
        } 

        $page_vid = getVertexIdFromInsert($vertex);

        // create mongodb page for data
        $page = config('socializer.models.page')::create([
            "model_id" => $this->user->id,
            "model_type" => get_class($this->user),
            "application_id" => $new_vid,
            "room_id" => $vid,
            "content" => null,
            "vertexid" => $page_vid,
        ]);

        // page / room relation
        setOwnedByRelation($page_vid, $vid);

        // page / application relation
        setPublishedInRelation($page_vid, $new_vid);

        return $new_vid;
    }

    public function saveApplicationIA($request)
    {
        // todo a protéger
        $application = config('socializer.models.application')::where([
            ["vertexid", $request->get('vertexid')],
        ])->first();

        $data = $request->get('data');
        $application->code = $data['code'] ?? null;
        $application->infos = $data['infos'] ?? null;
        $application->save();

        $this->setPublished($application);

        return response()->json(['message' => 'Application sauvegardée'], 200);
    }

    private function setPublished($application)
    {

        if(!isset($application->infos['published'])) {
            return;
        }

        $published = filter_var($application->infos['published'], FILTER_VALIDATE_BOOLEAN);

        if($published) {
            $this->nebula->insertEdge('published_in', [$application->vertexid.'->marketplace' => []]);
        } else {
            $this->nebula->deleteEdge('published_in', [$application->vertexid.'->marketplace']);
        }
    }

    public function databaseAction($request)
    {
        // todo a protéger

        try{
            $operation = $request->get('event');
            $payload = $request->get('payload');
            $vertexid = $request->get('vertexid');

            // data are saved in the page model
            $database_app = config('socializer.models.page')::where([
                ["application_id", $vertexid],
            ])->first();

            $database = $database_app->data ?? [];

            switch($operation) {
                case 'create':
                    $database[] = $payload;
                    break;
                case 'update':
                    foreach($database as $key => $value) {
                        if($value['id'] == $payload['id']) {
                            $database[$key] = $payload;
                        }
                    }
                    break;
                case 'delete':
                    foreach($database as $key => $value) {
                        if($value['id'] == $payload['id']) {
                             unset($database[$key]);
                        }
                    }
                    break;
            }

            $database_app->data = $database;

            if($database_app->save()) {
                return response()->json([
                    'action'=> 'database',
                    'status' => 'success',
                    'data' => [
                        'event' => $operation, 
                        'payload' => $payload,
                        ]
                ], 200);
            }

        } catch(\Exception $e) {
           // dump($e->getMessage());
            return response()->json([
                'action'=> 'database',
                'status' => 'error',
                'data' => [
                    'event' => $operation, 
                    ]
            ]);

        }
    }

    public function loadApplicationIA($request)
    {
        $room_id = $request->get('room_id');

        $app_vertex = $this->nebula->execute("MATCH (r:room)<-[:published_in]-(a:application)<-[:published_in]-(p:page) where id(r) == '$room_id' return a,p");
       
        $app_id = $app_vertex[0]['a']['id'];
        $database_id = $app_vertex[0]['p']['id'];

        $application = config('socializer.models.application')::where([
            ["vertexid", $app_id],
        ])->select('code', 'infos')->first();

        $database = config('socializer.models.page')::where([
            ["vertexid", $database_id],
        ])->select('data')->first();

        $application->code = stringIsJSON($application->code) ? json_decode($application->code) : $application->code;
        $application->data = $database->data ?? [];

        return $application;
    }
}