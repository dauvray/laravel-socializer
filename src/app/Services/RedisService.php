<?php

namespace Dauvray\Socializer\app\Services;

use Closure;
use Illuminate\Support\Facades\Redis;
use Illuminate\Redis\Connections\PhpRedisConnection;

class RedisService
{
    protected PhpRedisConnection $redis;

    public function __construct()
    {
        $this->redis = Redis::connection();
    }

    // region === Strings ===

    /**
     * Stocke une valeur (string ou JSON) sous une clé Redis, avec TTL optionnel.
     *
     * @param string $key
     * @param mixed $value
     * @param int|null $ttl Time to live in seconds
     * @return bool
     */
    public function set(string $key, mixed $value, int $ttl = null): bool
    {
        $value = is_scalar($value) ? $value : json_encode($value);

        return $ttl
            ? $this->redis->set($key, $value, 'ex', $ttl)
            : $this->redis->set($key, $value);
    }

    /**
     * Récupère la valeur associée à une clé. Si asJson est true, la valeur est décodée depuis JSON.
     *
     * @param string $key
     * @param bool $asJson Whether to decode the value as JSON
     * @return mixed
     */
    public function get(string $key, bool $asJson = false): mixed
    {
        $value = $this->redis->get($key);

        return $asJson && $value ? json_decode($value, true) : $value;
    }

    /**
     * Supprime une ou plusieurs clés de Redis.
     *
     * @param string ...$keys
     * @return int Nombre de clés supprimées
     */
    public function del(string ...$keys): int
    {
        return $this->redis->command('del', [$keys]);
    }

    /**
     * Vérifie si une clé existe dans Redis.
     *
     * @param string $key
     * @return bool
     */
    public function exists(string $key): bool
    {
        return (bool) $this->redis->command('exists', [$key]);
    }

    /**
     * Récupère le TTL (Time to Live) d'une clé.
     *
     * @param string $key
     * @return int TTL en secondes, ou -1 si la clé n'existe pas ou n'a pas de TTL
     */
    public function ttl(string $key): int
    {
        return $this->redis->command('ttl', [$key]);
    }

    /**
     * Définit un TTL (Time to Live) pour une clé.
     *
     * @param string $key
     * @param int $ttl Time to live en secondes
     * @return bool True si la commande a réussi, false sinon
     */
    public function expire(string $key, int $ttl): bool
    {
        return (bool) $this->redis->command('expire', [$key, $ttl]);
    }

    // endregion

    // region === Hashes ===

    /**
     * Définit un champ dans un hash Redis. Si la valeur n'est pas scalaire, elle est encodée en JSON.
     *
     * @param string $key
     * @param string $field
     * @param mixed $value
     * @return int Nombre de champs ajoutés ou mis à jour
     */
    public function hSet(string $key, string $field, mixed $value): int
    {
        return $this->redis->client()->hSet($key, $field, is_scalar($value) ? $value : json_encode($value));
    }

    /**
     * Récupère la valeur d'un champ dans un hash Redis. Si asJson est true, la valeur est décodée depuis JSON.
     *
     * @param string $key
     * @param string $field
     * @param bool $asJson Whether to decode the value as JSON
     * @return mixed
     */
    public function hGet(string $key, string $field, bool $asJson = false): mixed
    {
        $value = $this->redis->client()->hGet($key, $field);

        return $asJson && $value ? json_decode($value, true) : $value;
    }

    /**
     * Récupère tous les champs et valeurs d'un hash Redis. Si asJson est true, les valeurs sont décodées depuis JSON.
     *
     * @param string $key
     * @param bool $asJson Whether to decode the values as JSON
     * @return array Associative array of fields and values
     */
    public function hGetAll(string $key, bool $asJson = false): array
    {
        $all = $this->redis->client()->hGetAll($key);

        if ($asJson) {
            foreach ($all as &$value) {
                $value = json_decode($value, true);
            }
        }

        return $all;
    }

    /**
     * Supprime un ou plusieurs champs d'un hash Redis.
     *
     * @param string $key
     * @param string ...$fields
     * @return int Nombre de champs supprimés
     */
    public function hDel(string $key, string ...$fields): int
    {
        return $this->redis->client()->hDel($key, ...$fields);
    }

    // endregion

    // region === Lists ===

    /**
     * Ajoute une valeur au début d'une liste Redis. Si la valeur n'est pas scalaire, elle est encodée en JSON.
     *
     * @param string $key
     * @param mixed $value
     * @return int Nombre d'éléments dans la liste après l'ajout
     */
    public function lPush(string $key, mixed $value): int
    {
        return $this->redis->client()->lPush($key, is_scalar($value) ? $value : json_encode($value));
    }

    /**
     * Ajoute une valeur à la fin d'une liste Redis. Si la valeur n'est pas scalaire, elle est encodée en JSON.
     *
     * @param string $key
     * @param mixed $value
     * @return int Nombre d'éléments dans la liste après l'ajout
     */
    public function rPush(string $key, mixed $value): int
    {
        return $this->redis->client()->rPush($key, is_scalar($value) ? $value : json_encode($value));
    }

    /**
     * Supprime et retourne le premier élément d'une liste Redis. Si asJson est true, la valeur est décodée depuis JSON.
     *
     * @param string $key
     * @param bool $asJson Whether to decode the value as JSON
     * @return mixed
     */
    public function lPop(string $key, bool $asJson = false): mixed
    {
        $value = $this->redis->client()->lPop($key);

        return $asJson && $value ? json_decode($value, true) : $value;
    }

    /**
     * Supprime et retourne le dernier élément d'une liste Redis. Si asJson est true, la valeur est décodée depuis JSON.
     *
     * @param string $key
     * @param bool $asJson Whether to decode the value as JSON
     * @return mixed
     */
    public function rPop(string $key, bool $asJson = false): mixed
    {
        $value = $this->redis->client()->rPop($key);

        return $asJson && $value ? json_decode($value, true) : $value;
    }

    /**
     * Récupère une plage d'éléments d'une liste Redis.
     *
     * @param string $key
     * @param int $start Index de début (inclusif)
     * @param int $stop Index de fin (inclusif)
     * @return array Liste des éléments dans la plage spécifiée
     */
    public function lRange(string $key, int $start, int $stop): array
    {
        return $this->redis->client()->lRange($key, $start, $stop);
    }

    // endregion

    // region === Sets ===

    /**
     * Ajoute une valeur à un ensemble Redis. Si la valeur n'est pas scalaire, elle est encodée en JSON.
     *
     * @param string $key
     * @param mixed $value
     * @return int Nombre d'éléments ajoutés à l'ensemble, excluant les éléments déjà présents
     */
    public function sAdd(string $key, mixed $value): int
    {
        return $this->redis->client()->sAdd($key, is_scalar($value) ? $value : json_encode($value));
    }

    /**
     * Supprime une valeur d'un ensemble Redis.
     *
     * @param string $key
     * @param mixed $value
     * @return int Nombre d'éléments supprimés de l'ensemble
     */
    public function sRem(string $key, mixed $value): int
    {
        return $this->redis->client()->sRem($key, $value);
    }

    /**
     * Récupère tous les membres d'un ensemble Redis.
     *
     * @param string $key
     * @return array Liste des membres de l'ensemble
     */
    public function sMembers(string $key): array
    {
        return $this->redis->client()->sMembers($key);
    }

    /**
     * Vérifie si une valeur est membre d'un ensemble Redis.
     *
     * @param string $key
     * @param mixed $value
     * @return bool True si la valeur est membre, false sinon
     */
    public function sIsMember(string $key, mixed $value): bool
    {
        return $this->redis->client()->sIsMember($key, $value);
    }

    // endregion

    // region === Sorted Sets ===

    /**
     * Ajoute un ou plusieurs membres avec leur score à un ensemble trié Redis.
     *
     * @param string $key
     * @param array $membersWithScores Associative array où les clés sont les membres et les valeurs sont les scores
     * @return int Nombre de membres ajoutés à l'ensemble trié, excluant les membres déjà présents
     */
    public function zAdd(string $key, array $membersWithScores): int
    {
        return $this->redis->zadd($key, $membersWithScores);
    }

    /**
     * Récupère les membres d'un ensemble trié Redis dans une plage de scores.
     *
     * @param string $key
     * @param int|float $min Score minimum
     * @param int|float $max Score maximum
     * @param array $options Options supplémentaires pour la commande (par exemple, 'withscores' => true)
     * @return array Liste des membres dans la plage de scores spécifiée
     */
    public function zRangeByScore(string $key, int|float|string $min, int|float $max, array $options = []): array
    {
        return $this->redis->zrangebyscore($key, $min, $max, $options);
    }

    /**
     * Supprime un ou plusieurs membres d'un ensemble trié Redis.
     *
     * @param string $key La clé de l'ensemble trié.
     * @param mixed ...$members Les membres à supprimer.
     * @return int Le nombre d’éléments supprimés.
     */
    public function zRem(string $key, mixed ...$members): int
    {
        $members = collect($members)->flatten()->toArray();
        return $this->redis->command('zrem', array_merge([$key], $members));
    }

    /**
     * Supprime les membres d’un sorted set dont le score est compris dans une plage donnée.
     *
     * @param string $key La clé du sorted set.
     * @param int|float|string $min Score minimal (ex: 0, '-inf', etc.)
     * @param int|float|string $max Score maximal (ex: time(), '+inf', etc.)
     * @return int Le nombre d’éléments supprimés.
     */
    public function zRemRangeByScore(string $key, int|float|string $min, int|float|string $max): int
    {
        return $this->redis->command('zremrangebyscore', [$key, $min, $max]);
    }

    /**
     * Vérifie si un membre existe dans un sorted set (ZSET).
     *
     * @param string $key Clé du sorted set.
     * @param string $member Le membre à vérifier.
     * @return bool Vrai si le membre est présent dans le ZSET.
     */
    public function zIsMember(string $key, string $member): bool
    {
        return $this->redis->client()->zScore($key, $member) !== false;
    }

    // endregion

    // region === Transactions & Pipelines ===

    /**
     * Exécute une transaction Redis en utilisant un callback.
     *
     * @param Closure $callback
     * @return array Résultats de la transaction
     */
    public function transaction(Closure $callback): array
    {
        return $this->redis->transaction($callback);
    }

    /**
     * Exécute une série de commandes Redis en pipeline.
     *
     * @param Closure $callback
     * @return array Résultats des commandes exécutées en pipeline
     */
    public function pipeline(Closure $callback): array
    {
        return $this->redis->pipeline($callback);
    }

    // endregion

    // region === Pub/Sub ===

    /**
     * Souscrit à un ou plusieurs canaux Redis pour recevoir des messages.
     *
     * @param array|string $channels Canaux à souscrire
     * @param Closure $callback Fonction de rappel pour traiter les messages reçus
     */
    public function subscribe(array|string $channels, Closure $callback): void
    {
        $this->redis->subscribe($channels, $callback);
    }

    /**
     * Souscrit à un ou plusieurs canaux Redis avec des motifs (wildcards) pour recevoir des messages.
     *
     * @param array|string $patterns Motifs de canaux à souscrire
     * @param Closure $callback Fonction de rappel pour traiter les messages reçus
     */
    public function pSubscribe(array|string $patterns, Closure $callback): void
    {
        $this->redis->psubscribe($patterns, $callback);
    }

    // endregion

    // region === Custom ===

    /**
     * Exécute une commande Redis brute.
     *
     * @param array $command Commande à exécuter sous forme de tableau
     * @return mixed Résultat de la commande
     */
    public function raw(array $command): mixed
    {
        return $this->redis->executeRaw($command);
    }

    /**
     * Exécute une commande Redis en utilisant la méthode spécifiée et les arguments fournis.
     *
     * @param string $method Nom de la méthode Redis à appeler
     * @param array $args Arguments à passer à la méthode
     * @return mixed Résultat de la commande
     */
    public function command(string $method, array $args = []): mixed
    {
        return $this->redis->command($method, $args);
    }

    /**
     * Récupère le client Redis sous-jacent.
     *
     * @return \Illuminate\Redis\Connections\PhpRedisConnection
     */
    public function client(): Redis
    {
        return $this->redis->client();
    }

    // endregion
}