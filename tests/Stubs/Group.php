<?php

namespace Dauvray\Socializer\Tests\Stubs;

use Illuminate\Database\Eloquent\Model;

/**
 * Groupe du harnais — cible de `config('estarter.models.group')`.
 *
 * En production c'est le `Group` d'estarter, un nested set. Le paquet n'en lit que trois choses :
 * `name`, `parent_id`, et ce que `getVertexId()` en tire.
 *
 * ⚠️ VOLONTAIREMENT SANS COLONNE `vertexid`, contrairement au stub `User`. `getVertexId()` a deux
 * chemins — la colonne si elle existe, sinon `tags.<classe>.name` concaténé à l'`id` — et c'est le
 * second que prend le groupe d'estarter. Le stub prend donc le même que la production : `group1`.
 *
 * `extras` est casté en array comme sur le modèle d'estarter : c'est là que vit
 * `socializer_server_vid`, la poignée par laquelle le front entre dans le serveur d'un groupe.
 */
class Group extends Model
{
    protected $table = 'groups';

    protected $fillable = ['name', 'parent_id', 'extras'];

    protected $casts = ['extras' => 'array'];

    public $timestamps = false;
}
