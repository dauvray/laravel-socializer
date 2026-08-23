<?php

namespace Dauvray\Socializer\Tests\Stubs;

use Illuminate\Database\Eloquent\Model;

/**
 * Page du harnais — cible de `config('socializer.models.page')`.
 *
 * ⚠️ EN PRODUCTION C'EST UN MODÈLE MONGO, et c'est pour ça que cette doublure existe :
 * `mongodb/laravel-mongodb` n'est pas installé dans le paquet (dépendance implicite, cf.
 * `docs/architecture/package.md`), donc toucher `Dauvray\Socializer\app\Models\Page` lève
 * `Class "MongoDB\Laravel\Eloquent\Model" not found` — avant même toute question de connexion.
 * Un Eloquent nu sur une table sqlite suffit, parce que le paquet n'atteint jamais ce modèle
 * autrement que par la clé de config : `Page::createPageVertice` ne lui demande qu'un `create()`,
 * un `->id`, et un `->vertexid = …; ->save()`.
 *
 * C'est le premier cas où une doublure du harnais RÉPOND au lieu de lever (cf. décision 5 de
 * `docs/architecture/tests.md`) sur un modèle d'une autre base : la fidélité s'arrête à ces trois
 * opérations. Tout ce qui dépendrait vraiment de Mongo — agrégations, `_id`, sous-documents — reste
 * hors de portée du harnais et doit se vérifier sur le dev.
 */
class Page extends Model
{
    protected $table = 'pages';

    protected $fillable = [
        'model_id',
        'model_type',
        'server_id',
        'room_id',
        'content',
        'vertexid',
    ];

    public $timestamps = false;
}
