<?php

namespace Dauvray\Socializer\Tests\Stubs;

use Dauvray\Socializer\app\Helpers\NebulaGraphClient;
use Nebula\Graph\GraphServiceClient;

/**
 * La VRAIE `NebulaGraphClient`, branchée sur un service Thrift doublé.
 *
 * Seul `createConnection()` est substitué — c'est la couture que le docblock de `NebulaGraphClient`
 * annonce (`protected`, appelée du seul constructeur). Tout le reste s'exécute pour de vrai :
 * `authenticate()`, `refreshSession()`, `forceAuthenticate()`, `logout()`, et surtout leurs
 * interactions avec le cache — qui sont précisément ce qu'on veut prouver.
 *
 * ⚠️ Le constructeur du parent appelle `authenticate()`… non : il ne fait que
 * `createConnection()`. C'est `NebulaGraphConnection` qui enchaîne `authenticate()` puis
 * `USE <space>`. Un test qui instancie cette doublure seule part donc d'un client SANS session,
 * ce qui est l'état voulu pour exercer `authenticate()` explicitement.
 */
final class FakeSessionClient extends NebulaGraphClient
{
    public FakeGraphService $service;

    public function __construct(?FakeGraphService $service = null)
    {
        $this->service = $service ?? new FakeGraphService;

        parent::__construct('127.0.0.1', 9669, []);
    }

    protected function createConnection(): GraphServiceClient
    {
        return $this->service;
    }
}
