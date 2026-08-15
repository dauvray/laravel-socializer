<?php

namespace Dauvray\Socializer\Tests\Stubs;

use Dauvray\Socializer\app\Helpers\ModelTraits\Socializable;
use Illuminate\Foundation\Auth\User as Authenticatable;

/**
 * Modèle utilisateur du harnais — cible de `config('estarter.models.user')`.
 *
 * En production c'est `App\Models\User` de l'app d'accueil ; le paquet ne le connaît que par
 * cette clé de config, ce qui est précisément ce qui rend le harnais possible.
 *
 * Porte `Socializable` (donc `canJoinRoom`, `canJoinServer`, `vertexid`) parce que C2 en
 * dépendra : ces méthodes interrogent NebulaGraph via le binding `nebulaGraph`, que le
 * `TestCase` remplace par `FakeNebulaGraph`.
 *
 * ⚠️ `vertexid` est un attribut RÉEL ici, alors que `Socializable::getVertexIdAttribute()`
 * le calcule via le helper `getVertexId()`. Ce n'est pas une divergence : ce helper renvoie
 * justement `$item->getAttributes()['vertexid']` quand la colonne existe. Le stub prend donc
 * le même chemin que la production.
 */
class User extends Authenticatable
{
    use Socializable;

    protected $table = 'users';

    /**
     * ⚠️ `$fillable` et non `$guarded = []` : `Socializable::initializeSocializable()` fait
     * `$this->fillable = array_merge($this->fillable, ['is_bot'])`. Définir `fillable`, même
     * indirectement, **annule** `guarded` — un stub en `guarded = []` se retrouve avec le seul
     * `is_bot` assignable, et `User::create()` insère une ligne vide (contrainte NOT NULL sur
     * `name`). Piège vécu.
     */
    protected $fillable = ['name', 'slug', 'email', 'password', 'vertexid'];

    public $timestamps = true;
}
