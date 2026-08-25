<?php

namespace Dauvray\Socializer\Tests\Stubs;

use Nebula\Common\ErrorCode;
use Nebula\Graph\AuthResponse;
use Nebula\Graph\GraphServiceClient;
use Nebula\Graph\VerifyClientVersionResp;

/**
 * Doublure du service Thrift lui-même — un cran SOUS `FakeThriftClient`.
 *
 * `FakeThriftClient` remplace `NebulaGraphClient` : c'est le bon outil pour exercer la couture
 * (`NebulaGraphConnection`), et elle ne peut rien prouver du client puisqu'elle le remplace. Cette
 * doublure-ci se substitue au `GraphServiceClient` généré par Thrift, ce qui laisse tourner la
 * VRAIE `NebulaGraphClient` — donc `authenticate()`, `refreshSession()`, `logout()` et leur
 * arithmétique de cache, qui sont exactement ce qu'on doit épingler.
 *
 * ⚠️ **`signout` s'écrit en MINUSCULES dans le contrat Thrift** (`GraphServiceClient::signout`).
 * `NebulaGraphClient::logout()` appelle `signOut()` et ça marche par insensibilité à la casse des
 * noms de méthodes en PHP — mais un `shouldNotReceive('signOut')` sur un mock, lui, serait sensible
 * à la casse et donnerait un **faux vert**. D'où le compteur explicite ci-dessous plutôt qu'un mock.
 *
 * ⚠️ Aucun `parent::__construct()` : celui de `GraphServiceClient` attend un protocole Thrift et
 * ouvrirait un transport. Ne pas l'appeler suffit à n'ouvrir aucune connexion.
 */
final class FakeGraphService extends GraphServiceClient
{
    /** Les identifiants de session servis par `authenticate()`, dans l'ordre. */
    private array $sessionIdsToServe;

    private int $authenticateCount = 0;

    /** @var array<int, int> les identifiants reçus par `signout()` */
    private array $signOuts = [];

    /** @var array<int, array{session: int|null, stmt: string}> */
    private array $statements = [];

    private string $responseJson;

    /**
     * @param  array<int, int>  $sessionIdsToServe  un identifiant par authentification attendue ;
     *                                              le dernier est resservi si on dépasse
     */
    public function __construct(array $sessionIdsToServe = [777])
    {
        $this->sessionIdsToServe = $sessionIdsToServe;
        $this->responseJson = FakeThriftClient::successWithoutRows();
    }

    public function verifyClientVersion(\Nebula\Graph\VerifyClientVersionReq $req)
    {
        $resp = new VerifyClientVersionResp;
        $resp->error_code = ErrorCode::SUCCEEDED;

        return $resp;
    }

    public function authenticate($username, $password)
    {
        $index = min($this->authenticateCount, count($this->sessionIdsToServe) - 1);
        $this->authenticateCount++;

        $resp = new AuthResponse;
        $resp->error_code = ErrorCode::SUCCEEDED;
        $resp->session_id = $this->sessionIdsToServe[$index];

        return $resp;
    }

    public function signout($sessionId)
    {
        $this->signOuts[] = $sessionId;
    }

    public function execute($sessionId, $stmt)
    {
        $this->statements[] = ['session' => $sessionId, 'stmt' => $stmt];

        return $this->responseJson;
    }

    public function executeJson($sessionId, $stmt)
    {
        $this->statements[] = ['session' => $sessionId, 'stmt' => $stmt];

        return $this->responseJson;
    }

    /*
    |--------------------------------------------------------------------------
    | Observation
    |--------------------------------------------------------------------------
    */

    public function authenticateCount(): int
    {
        return $this->authenticateCount;
    }

    /** @return array<int, int> */
    public function signOuts(): array
    {
        return $this->signOuts;
    }

    /** @return array<int, array{session: int|null, stmt: string}> */
    public function statements(): array
    {
        return $this->statements;
    }
}
