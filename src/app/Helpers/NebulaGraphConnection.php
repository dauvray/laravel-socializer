<?php

namespace Dauvray\Socializer\app\Helpers;


      /*

      Exemples 
      
        $^ Represents the source vertex of the edge.
        $- Represents the outputs of the query before the pipe symbol.
        $$ Represents the main vertex
    
        ->showHost();
        ->showSpaces();
        ->createSpace('GHU')
        ->createTag('Etablissement', ['props' => ['name string']]);
        ->createEdge('serve', ['props' => ['start_year int','end_year int']]);
        ->insertVertex('Player', [['name' => 'Neymar'],['name' => 'MBappe'],['name' => 'Messi']])
        ->insertVertex('Player', [['id' => 'player97', 'name' => 'Steve Boker'],['id' => 'player96', 'name' => 'Francis Roco'],['id' => 'player95', 'name' => 'Bootsy Colins']])
        ->insertEdge('follow', [
            'player102->player100' => [
                'degree' => 75,
            ]
        ])
        ->insertEdge('serve', [
        [
              'player101->team204' => [
                  'start_year' => 1999,
                  'end_year' => 2018,
              ]
              ],
              [
                'player102->team203' => [
                  'start_year' => 2006,
                  'end_year' => 2015,
                ]
          ]
          ])
        ->updateVertex('Player', 'player100', ['name' => 'Tim Burton'])
        ->updateEdge('follow', 'player101->player100', ['degree' => 96])
        ->deleteVertex(['player111', 'team203'])
        ->deleteEdge('follow', ['player101->team204'])
        ->createTagIndex('Player', 'player_index', ['name(20)'])
        ->createEdgeIndex('follow', 'follow_index')
        ->execute('SHOW USERS');
        ->fetchProp('player', 'player101')
        ->execute('GO FROM "'.$from.'" OVER '.$edge.' WHERE properties($$).age >= 35 YIELD properties($$).name AS Teammate, properties($$).age AS Age;');

      */

  //  $collection = app('nebulaGraph')->execute('MATCH (s:server) RETURN s');
    //  $collection = app('nebulaGraph')->insertVertex('application', [
  //   ['id' => 'appli2', 'nom' => 'Regulpsy', 'url' => 'https://regulpsy-test.ghu-paris.fr'],
  //   ['id' => 'appli3', 'nom' => 'prems-proms', 'url' => 'https://prems-proms-test.ghu-paris.fr'],
  //   ['id' => 'appli4', 'nom' => 'nml-mnesie', 'url' => 'https://cbi-r-test.ghu-paris.fr'],
  //   ['id' => 'appli5', 'nom' => 'anapath', 'url' => 'https://portal-uploader-test.ghu-paris.fr'],
  // ]);

  // $collection = app('nebulaGraph')->insertEdge('host', [
  //   ['vm1->appli2' => []],
  //   ['vm1->appli3' => []],
  //   ['vm1->appli4' => []],
  //   ['vm1->appli5' => []],
  // ]);

  //app('nebulaGraph')->deleteVertex(['f45aef3814a3d', 'b2bd59d61c611', '363be65fbde2e','086581e55b5f5']);

use Illuminate\Database\Connection;

use Dauvray\Socializer\app\Helpers\NebulaGraphClient;
use Illuminate\Container\Attributes\Log;
use Illuminate\Support\Arr;

class NebulaGraphConnection extends Connection {

    /**
     * The NebulaGraph active client connection.
     *
     * @var ClientInterface
     */
    public $nebula;

    /**
     * The database connection configuration options.
     *
     * @var array
     */
    protected $config = [];

    /**
     * Specifies the VID type in a graph space. Available values are FIXED_STRING(N)
     * and INT64
     */
    protected $vid_type = 'FIXED_STRING(30)';

    /**
     * Specifies the number of partitions in each replica
     */
    protected $partition_num;

    /**
     * the number of replicas in the cluster. The suggested number is 3 in a production environment
     * and 1 in a test environment
     */
    protected $replica_factor;

    protected $query = [];

    public function __construct(array $config) 
    {
        $this->config = $config;

        $this->nebula = new NebulaGraphClient($config['host'], $config['port'], $config['options']);
        $this->nebula->authenticate($config['username'], $config['password']);
        $this->nebula->execute('USE '. $config['space']);
        $this->partition_num = $config['partition'];
        $this->replica_factor = config('app.env') == 'production' ? $config['replica_factor'] : 1;
    }

    /*---------------------------------- HELPERS ----------------------------------------*/

    public function stringFormatArray($values)
    {
        return Arr::map($values, function ( $value, string $key) {
            return $this->stringFormat($value);
        });
    }

    public function stringFormat($value)
    {
        if(is_string($value)) {
            return "'".$value."'";
        }

        if($value === null) {
            return 'null';
        }

        return $value;
    }

    public function getEdgeDirection($key)
    {
        $pattern = '/([a-zA-Z0-9]+)([<>-]+)([a-zA-Z0-9]+)/';
        preg_match($pattern, $key, $matches);
        return $matches;
    }

    public function responseJson($response)
    {
        $response = json_decode($response);

        if($response->errors[0]->code != 0) {
            return response()->json($response->errors[0], 500);
        }

        $graphData = [];
    
        foreach($response->results as $spacename) {
            if(isset($spacename->data)) {
              
                foreach($spacename->data as $idx_item => $item) {
                    $graphData[] = $this->formatValues($item, $idx_item, $spacename->columns);
                }
            } 
        }

        return $graphData;
    }

    public function formatValues($item, $idx, $columns)
    {
        $result = [];
        
        foreach($item->row as $idx_val => $value) {
            if(is_array($value)) {
                $result[$columns[$idx_val]] = [];
                foreach($value as $idx_subval => $subVal) {
                    $result[$columns[$idx_val]][] = collect(collect($subVal)->undot()->first())->merge($item->meta[$idx_val][$idx_subval])->all();
                }
            } else {
                $collection = collect(collect($value)->undot()->first())->merge($item->meta[$idx_val])->all();
                $result[$columns[$idx_val]] = count($collection) == 1 ? $collection[0] : $collection;
            }
        }
   
        if(count($result) == 1) {
            $cleDynamique = key($result);
            $result = $result[$cleDynamique];
        }

        return $result;
    }

    public function formatNumber($value)
    {
        if (is_float($value + 0)) {
            return floatval($value);
        } else {
            return intval($value);
        }
    }

    public function populatePropsFromPattern($object, array $pattern)
    {
        $result = [];

        if(isset($object->vertexId)) {
            $result['id'] = $object->vertexId;
            $pattern = Arr::except($pattern, ['id']);
        }
       
        foreach ($pattern as $key => $value) {
            if (isset($object->$key)) {
                $result[$key] = is_numeric($object->$key) ? $this->formatNumber($object->$key) : $object->$key;
            } elseif (isset($object->extras[$key])) {
                $result[$key] = is_numeric($object->extras[$key]) ? $this->formatNumber($object->extras[$key]) : $object->extras[$key];
            } else {
                $result[$key] = is_numeric($value) ? $this->formatNumber($value) : $value;
            }
        }

        return $result;
    }

     /*---------------------------------- DATABASE ----------------------------------------*/


    /**
     * Execute stmt
     * @param string $stmt
     */
    public function execute(string $stmt)
    {   $res = $this->responseJson($this->nebula->executeJson($stmt));
        \Log::debug('NebulaGraph Query: '. $stmt.' Result: '.json_encode($res));
        return $res;
    }

    public function getConfig($option = null)
    {
        return $this->config;
    }

    public function showHost()
    {
        return $this->execute('SHOW HOSTS');
    }

    public function logout($session_id = null)
    {
        return $this->nebula->logout($session_id);
    }


    /*---------------------------------- SPACE ----------------------------------------*/

    public function showSpaces(array $options = [])
    {
        return $this->execute('SHOW SPACES');
    }

    public function createSpace(string $name = "defaultSpace", array $options = [])
    {
        $params = [
            'vid_type' => isset($options['vid_type']) ? $options['vid_type'] : $this->vid_type,
            'replica_factor' => isset($options['replica_factor']) ? $options['replica_factor'] : $this->replica_factor,
            'partition_num' => isset($options['partition_num']) ? $options['partition_num'] : $this->partition_num,
        ];

        $query = 'CREATE SPACE IF NOT EXISTS '. $name 
        .' (partition_num='. $params['partition_num'] .', replica_factor='. $params['replica_factor'] .', vid_type='. $params['vid_type'] .');';

        return $this->execute($query);
    }

    public function dropSpace(string $name = "defaultSpace")
    {
        $query = 'DROP SPACE IF EXISTS '. $name;
        return $this->execute($query);
    }

    public function useSpace(string $name = "defaultSpace")
    {
        $query = 'USE '. $name;
        return $this->execute($query);
    }

    public function describeSpace(string $name = "defaultSpace")
    {
        $query = 'DESCRIBE SPACE '. $name;
        return $this->execute($query);
    }

    /*---------------------------------- TAG ----------------------------------------*/

    public function createTag(array $options = [ 'name' => 'default', 'props' => []])
    {

        $options['props'][] = 'created_at datetime NULL';
        $query = 'CREATE TAG IF NOT EXISTS '. $options['name'] .'('. implode(',', $options['props']) .')';
        return $this->execute($query);
    }

    public function dropTag(array $options = [ 'name' => 'default'])
    {
        $query = 'DROP TAG IF EXISTS '. $options['name'];
        return $this->execute($query);
    }

    public function alterTag(array $options = [ 'name' => 'default'])
    {
        // TODO
    }

    public function describeTag(string $name = "default")
    {
        $query ='DESCRIBE TAG '. $name;
        return $this->execute($query);
    }

    public function showTags()
    {
        $query ='SHOW TAGS';
        return $this->execute($query);
    }

    /*---------------------------------- VERTEX ----------------------------------------*/

    public function insertVertex(string $label = "default", array $values = [], array $options = [])
    {
        $items = [];
        $keys = [];
        $vertice = config("socializer.nebulagraph.vertices.$label");

        // keep only keys defined in config
        foreach($values as $key => $value) {
            if(!array_key_exists($key, $vertice) && $key != 'id') {
                unset($values[$key]);
            }
        }

        // merge default values if not exists
        foreach($vertice as $key => $value) {
            if(!isset($values[$key]) && $vertice[$key]) {
                $values[$key] = $vertice[$key];
            }
        };

        $formatQueryValues = function($values) {

            $vid = $values['id'] ?? uniqidReal();
            $filtered = Arr::except($values, ['id']);
            [$keys, $values] = Arr::divide($filtered);
            $mapped = $this->stringFormatArray($values);

            // created_at value
            $mapped[] = 'datetime()';
            
            return  '"'. $vid .'":('. implode(',', $mapped) .')';
        };

        if(isset($values[0])) {
            $keys = array_keys(Arr::except($values[0], ['id']));
            foreach($values as $value) {
                $items[] = $formatQueryValues($value);
            }
        } else {
            $keys = array_keys(Arr::except($values, ['id']));
            $items[] = $formatQueryValues($values);
        }

        // add created_at for all vertexes
        $keys[] = 'created_at';

        $query = 'INSERT VERTEX IF NOT EXISTS '. $label .' ('. implode(',', $keys) .') VALUES '. implode(',', $items);

        $result = $this->execute($query);

        return is_array($result) && count($result) ? $result : $items;
    }

    public function updateVertex(string $label = "default", $vertex_id = null, array $values = [])
    {
        $updates = [];
        $filtered = Arr::except($values, ['id']);
        
        foreach($filtered as $key => $value) {
            $updates[] = $label.'.'.$key.' = '. $this->stringFormat($value);
        }

        $query = 'UPDATE VERTEX ON '. $label .' "'. $vertex_id .'" SET '. implode(',', $updates);

        return $this->execute($query);
    }

    public function deleteVertex(array $vids = [], bool $with_edge = false)
    {
        $query = 'DELETE VERTEX '. implode(',', $this->stringFormatArray($vids));
        
        if($with_edge) {
            $query .= ' WITH EDGE';
        }

        return $this->execute($query);
    }

    /*---------------------------------- EDGE ----------------------------------------*/

    public function createEdge(array $options = [ 'name' => 'default', 'props' => []])
    {
        $query = 'CREATE EDGE IF NOT EXISTS '.  $options['name'] .'('. implode(',', $options['props']) .')';
        return $this->execute($query);
    }

    public function insertEdge(string $label = "default", array $values = [])
    {
        $items = [];
        $keys = [];

        $formatQueryValues = function($values, $key) {

            $matches = $this->getEdgeDirection($key);
            $vid = $key;
            [$keys, $values] = Arr::divide($values[$key]);
            $mapped = $this->stringFormatArray($values);
            return  '"'. $matches[1] .'" '. $matches[2] .' "'. $matches[3] .'":('. implode(',', $mapped) .')';

        };

        if(isset($values[0])) {

            $keys = array_keys(array_values(array_values($values)[0])[0]);
            foreach($values as $value) {
                $items[] = $formatQueryValues($value, array_keys($value)[0]);
            }

        } else {
       
            $keys = array_keys(array_values($values)[0]);
            $items[] = $formatQueryValues($values, array_keys($values)[0]);
        }

        $query = 'INSERT EDGE '. $label .' ('. implode(',', $keys) .') VALUES '. implode(',', $items);

        return $this->execute($query);
    }

    public function updateEdge(string $label = "default", string $direction, array $values = [])
    {
        $matches = $this->getEdgeDirection($direction);
        $updates = [];
        foreach($values as $key => $value) {
            $updates[] = $key.' = '. $this->stringFormat($value);
        }

        $query = 'UPDATE EDGE "'. $matches[1] .'" '. $matches[2] .' "'. $matches[3]  .'" OF '. $label . ' SET '. implode(',', $updates);

        return $this->execute($query);
    }

    public function deleteEdge(string $label = "default", array $directions = [])
    {
        $updates = [];

        foreach($directions as $direction) {
            $matches = $this->getEdgeDirection($direction);

            $updates[] = '"'. $matches[1] .'" '. $matches[2] .' "'. $matches[3].'"';
        }

        $query = 'DELETE EDGE '. $label .' '. implode(',', $updates);

        return $this->execute($query);
    }

    public function dropEdge(string $name = "default")
    {
        $query ='DROP EDGE IF EXISTS '.$name;
        return $this->execute($query);
    }

    public function showEdges()
    {
        $query ='SHOW EDGES';
        return $this->execute($query);
    }

    public function describeEdge(string $name = "default")
    {
        $query ='DESCRIBE EDGE '. $name;
        return $this->execute($query);
    }

    /*---------------------------------- INDEXES ----------------------------------------*/

    public function createTagIndex(string $label = "default", string $index = 'default_idx', array $values = [])
    {
        $updates = [];
        foreach($values as $key => $value) {
            $updates[] = $value;
        }
        $query ='CREATE TAG INDEX IF NOT EXISTS '. $index .' on '. $label .'('. implode(',', $updates).')';

        $result = $this->execute($query);
        return $result;
    }

    public function rebuildTagIndex(string $index = 'default_idx')
    {
        $query = 'REBUILD TAG INDEX '. $index;

        return $this->execute($query);
    }

    public function dropTagIndex(string $index = 'default_idx')
    {
        $query ='DROP TAG INDEX IF EXISTS '.$index;
        return $this->execute($query);
    }

    public function dropEdgeIndex(string $index = 'default_idx')
    {
        $query ='DROP EDGE INDEX IF EXISTS '.$index;
        return $this->execute($query);
    }

    public function createEdgeIndex(string $label = "default", string $index = 'default_idx')
    {
        $query ='CREATE EDGE INDEX IF NOT EXISTS '. $index .' on '. $label .'()';
        $result = $this->execute($query);
        return $result;
    }

    public function rebuildEdgeIndex(string $index = 'default_idx')
    {
        $query = 'REBUILD EDGE INDEX '. $index;

        return $this->execute($query);
    }

    /*----------------------------------  OTHERS ----------------------------------------*/

    public function fetchProp(string $label = "default", $id = null, $options = [])
    {
        $query = 'FETCH PROP ON '. $label .' "'. $id .'" YIELD properties(vertex)';

        return $this->execute($query);
    }

}