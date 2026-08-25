<?php

namespace Dauvray\Socializer\app\Helpers;

use Nebula\Common\ErrorCode;
use Thrift\Exception\TTransportException;
use Thrift\Protocol\TBinaryProtocol;
use Thrift\Transport\TBufferedTransport;
use Thrift\Transport\TSocket;
use Nebula\Graph\GraphServiceClient;
use Nebula\Graph\VerifyClientVersionReq;
use Illuminate\Support\Facades\Cache;

/**
 * GraphClient class used for connecting and executing commands on Nebula.
 *
 * This is the main high-level abstraction of Nebula upon which various other
 * abstractions are built.
 *
 * @author Yanlong He <yanlong@php.net>
 */
class NebulaGraphClient
{
    const VERSION = "2.6.0";

    /** @var GraphServiceClient */
    private $connection;

    /** @var string */
    private $sessionId;

    /** @var array */
    private $options;

    /** @var string */
    private $host;

    /** @var int */
    private $port;

    /**
     * @param string $host Set the remote server host or ip for the client.
     * @param int $port Set the remote server port for the client.
     * @param array $options Options to configure some behaviours of the client.
     * @throws TTransportException
     */
    public function __construct(string $host, int $port, array $options = [])
    {
        $this->host = $host;
        $this->port = $port;
        $this->options = $options;
        $this->connection = static::createConnection();
    }

    /**
     * Creates single or aggregate connections form supplied arguments.
     *
     * @return GraphServiceClient
     * @throws TTransportException
     */
    protected function createConnection(): GraphServiceClient
    {
        // todo ssl
        $socket = new TSocket($this->host, $this->port);
        $transport = new TBufferedTransport($socket);
        $protocol = new TBinaryProtocol($transport);
        $transport->open();
        $connection = new GraphServiceClient($protocol);
        $resp = $connection->verifyClientVersion(new VerifyClientVersionReq());
        if ($resp->error_code != ErrorCode::SUCCEEDED) {
            // todo
        }
        return $connection;
    }
        
    /**
     * Authorize and get a new session.
     * @param string $username
     * @param string $password
     * @return bool
     */
    /**
     * Adopte la session partagée par le cache, ou en forge une si la clé a expiré.
     *
     * ⚠️ LA ROTATION ET LE `KILL SESSION` DE CETTE MÉTHODE SONT LE GARDE-FOU ANTI-SATURATION.
     * NebulaGraph plafonne les sessions par couple (ip, utilisateur) — 300 par défaut, et ce plafond
     * a DÉJÀ été atteint sur ce déploiement, ce qui bloque l'application entière : plus aucune
     * session n'est accordée. Sans ce recyclage, la session partagée n'est jamais réclamée. Ne pas
     * « simplifier » cette méthode : `SHOW SESSIONS` doit rendre 1, et c'est elle qui le tient.
     *
     * Sa contrepartie est assumée : à chaque expiration de la clé, la session que TOUS les processus
     * partagent est recyclée, donc un processus long (reverb, queue) qui l'avait en mémoire se
     * retrouve avec un identifiant mort. Ce n'est pas un défaut à corriger ici — c'est ce que
     * `NebulaGraphConnection::executeJsonRecovering()` rattrape, une fois, sans bruit.
     */
    public function authenticate(string $username, string $password): bool
    {
        $sessionId = Cache::get('nebulagraph_sessionid');

        if(!$sessionId) {
            $last_sessionId = Cache::get('nebulagraph_last_sessionid');
            if ($last_sessionId) {
                $this->logout($last_sessionId);
                $this->executeJson('KILL SESSION ' . $last_sessionId);
            }

            return $this->forceAuthenticate($username, $password);
        }

        $this->sessionId = (string) $sessionId;

        return true;
    }

    /**
     * Récupère une session utilisable après en avoir vu une refusée par graphd.
     *
     * Deux branches, et **la première est le cas nominal** : quand la clé de cache porte un
     * identifiant DIFFÉRENT de celui qu'on vient de voir refusé, un autre processus a déjà forgé une
     * session valide et l'a publiée. On l'adopte — sans authentifier, sans écrire dans le cache,
     * sans rien tuer. C'est le chemin qu'emprunte chaque recyclage, donc le chemin de loin le plus
     * fréquent : **il ne crée AUCUNE session supplémentaire**, ce qui est la condition pour ne pas
     * rouvrir la saturation décrite dans `authenticate()`.
     *
     * Le repli — cache vide, ou cache portant l'identifiant qu'on vient de voir refusé — forge. Il
     * passe par `forceAuthenticate()` et NON par `authenticate()` : cette dernière relirait le cache
     * et repartirait sur le mort. Et surtout il n'appelle **jamais** `Cache::forget()` : évincer une
     * clé partagée par tous les conteneurs pour orienter un `if` local ferait ré-authentifier en
     * meute tous les autres processus, et détruirait la publication d'un tiers qui vient d'aboutir.
     *
     * @return bool  true si une session utilisable est en place
     */
    public function refreshSession(string $username, string $password): bool
    {
        $cached = Cache::get('nebulagraph_sessionid');

        // ⚠️ Comparaison de CHAÎNES, jamais d'entiers. `$resp->session_id` est un i64 Thrift, et ce
        // que `Cache::get` rend dépend du store : `DatabaseStore` sérialise donc rend un int,
        // `RedisStore::unserialize` rend la chaîne brute dès que la valeur `is_numeric`. Un `!==`
        // entre les deux types serait TOUJOURS vrai sous Redis, donc cette branche ré-adopterait le
        // cadavre à l'infini et le rejeu deviendrait un no-op silencieux. Le harnais de tests ne
        // peut pas l'attraper : il force `cache.default = array`, qui ne sérialise pas.
        if ($cached !== null && (string) $cached !== (string) $this->sessionId) {
            $this->sessionId = (string) $cached;

            return true;
        }

        return $this->forceAuthenticate($username, $password);
    }

    /**
     * Forge une session neuve et la publie, sans relire le cache.
     *
     * Extrait de `authenticate()` sans en changer une instruction : mêmes appels, même ordre, mêmes
     * clés, même TTL. C'est le SEUL point de création de session du paquet, ce qui rend le débit
     * mesurable en un endroit.
     */
    private function forceAuthenticate(string $username, string $password): bool
    {
        $resp = $this->connection->authenticate($username, $password);
        $this->sessionId = (string) $resp->session_id;
        Cache::put('nebulagraph_sessionid', $this->sessionId, now()->addMinutes(10));
        Cache::put('nebulagraph_last_sessionid', $this->sessionId);

        return true;
    }

    public function getSessionId()
    {
        return $this->sessionId;
    }

      /**
     * Execute stmt
     * @param string $stmt The ngql
     */
    public function execute(string $stmt)
    {
       return $resp = $this->connection->execute($this->sessionId, $stmt);
    }

    /**
     * Execute stmt
     * @param string $stmt
     */
    public function executeJson(string $stmt)
    {
        return $resp = $this->connection->executeJson($this->sessionId, $stmt);
    }

    /**
     * Déconnecte une session — la sienne par défaut, ou celle dont on donne l'identifiant.
     *
     * ⚠️ `signOut` est un appel Thrift **ONEWAY** : pas de réponse, pas d'erreur, invisible. C'est
     * lui qui tue réellement la session ; le `KILL SESSION` de `authenticate()` part, lui, après que
     * cette méthode a remis `$this->sessionId` à null, donc avec un identifiant nul. Constat, pas
     * conjecture — et laissé en place : le rendre actif ferait émettre un nGQL que graphd refuse,
     * donc une ligne d'erreur toutes les 10 minutes, pour tuer une session déjà morte.
     *
     * ⚠️ Le cache n'est évincé QUE si l'identifiant sortant est celui qui y est publié. Évincer
     * inconditionnellement — ce qui était le cas — laissait `logout('<id d'un tiers>')` détruire la
     * publication de la session COURANTE : tous les processus ré-authentifiaient en meute, et
     * `socializer:nebula-clear-sessions` produisait cet effet à chaque tour de sa boucle. Même
     * raison pour `$this->sessionId`, qu'on n'annule que si c'est bien la nôtre qu'on ferme :
     * l'annuler en fermant celle d'un tiers rendait le client aveugle au milieu d'une boucle.
     */
    public function logout( $session_id = null): void
    {
        $sessionId = $session_id ?? $this->sessionId;

        if ($sessionId) {
            try {
                $this->connection->signOut($sessionId);
            } catch (\Throwable $e) {
                logger()->warning('[Nebula] Logout failed: ' . $e->getMessage());
            }

            if ((string) Cache::get('nebulagraph_sessionid') === (string) $sessionId) {
                Cache::forget('nebulagraph_sessionid');
                Cache::forget('nebulagraph_last_sessionid');
            }

            if ((string) $this->sessionId === (string) $sessionId) {
                $this->sessionId = null;
            }
        }
    }
}