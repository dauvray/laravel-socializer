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
 */
class Group extends Model
{
    protected $table = 'groups';

    protected $fillable = ['name', 'parent_id'];

    public $timestamps = false;
}
