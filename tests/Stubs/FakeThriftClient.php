<?php

namespace Dauvray\Socializer\Tests\Stubs;

use Dauvray\Socializer\app\Helpers\NebulaGraphClient;

/**
 * Doublure du client Thrift, pour exercer la VRAIE `NebulaGraphConnection`.
 *
 * `FakeNebulaGraph` remplace la connexion ENTIÈRE : elle court-circuite les constructeurs de
 * requête, `responseJson()`, `formatValues()`, et n'a ni `insertVertex`, ni `deleteVertex`, ni
 * `populatePropsFromPattern`. Elle est le bon outil pour prouver le CÂBLAGE d'un garde — elle ne
 * peut rien prouver de la COUTURE elle-même, puisqu'elle la remplace.
 *
 * Cette doublure-ci se branche un cran plus bas : seul `executeJson()` est scripté, tout le reste
 * de `NebulaGraphConnection` s'exécute pour de vrai. C'est ce qui rend démontrable ce qui ne
 * l'était pas :
 *
 *   - que `responseJson()` DISTINGUE une erreur nGQL d'un résultat vide ;
 *   - que les 6 méthodes DML LÈVENT, et que les lectures NE LÈVENT PAS (tout E4.1 en dépend) ;
 *   - que la journalisation part sur toutes les méthodes, DDL compris ;
 *   - le nGQL réellement construit, y compris les valeurs par défaut de `insertVertex`.
 *
 * ⚠️ CE QU'ELLE NE PROUVE PAS. Les charges JSON ci-dessous sont ÉCRITES À LA MAIN, pas capturées
 * contre un cluster. Elles prouvent la manière dont la couture les interprète, jamais qu'une
 * requête est valide ni qu'elle fait ce qu'on croit. La limite documentée en décision 3 de
 * `docs/architecture/tests.md` se déplace d'un cran, elle ne disparaît pas : les requêtes se
 * contre-vérifient contre un vrai NebulaGraph. Remplacer ces charges par des captures datées
 * dès qu'un accès au cluster de dev est disponible.
 *
 * L'héritage sans `parent::__construct()` est délibéré : le constructeur du parent ouvre un
 * `TSocket` (`createConnection()`, protégée et appelée de lui seul). Ne pas l'appeler suffit à
 * n'ouvrir aucune connexion — et `NebulaGraphConnection` type sur la classe concrète, donc
 * aucune interface n'est nécessaire.
 */
final class FakeThriftClient extends NebulaGraphClient
{
    /** @var array<int, string> */
    private array $statements = [];

    /** @var array<int, array{fragment: string, json: string}> */
    private array $rules = [];

    private string $default;

    /** Combien d'appels restent à faire échouer avant de retomber sur les règles. */
    private int $failuresRemaining = 0;

    /** La charge servie tant que `$failuresRemaining` n'est pas épuisé. */
    private ?string $transientJson = null;

    private int $refreshCount = 0;

    /** @var array<int, string> les identifiants passés à `logout()`, dans l'ordre */
    private array $signOuts = [];

    public function __construct(?string $default = null)
    {
        $this->default = $default ?? self::successWithoutRows();
    }

    /*
    |--------------------------------------------------------------------------
    | Ce que le client rend
    |--------------------------------------------------------------------------
    */

    /** Réponse par défaut de toute requête non couverte par une règle. */
    public function respondsWith(string $json): static
    {
        $this->default = $json;

        return $this;
    }

    /** Toute requête échoue avec ce code nGQL. */
    public function failsWith(int $code, string $message = 'SyntaxError'): static
    {
        return $this->respondsWith(self::failure($code, $message));
    }

    /**
     * Seules les requêtes contenant ce fragment échouent.
     *
     * ⚠️ Même limite que `FakeNebulaGraph` : c'est une correspondance de sous-chaîne, pas une
     * analyse du nGQL. La PREMIÈRE règle déclarée qui matche gagne, pas la plus spécifique.
     */
    public function failsOn(string $fragment, int $code = -1004, string $message = 'SyntaxError'): static
    {
        $this->rules[] = ['fragment' => $fragment, 'json' => self::failure($code, $message)];

        return $this;
    }

    /** Seules les requêtes contenant ce fragment rendent cette charge. */
    public function respondsOn(string $fragment, string $json): static
    {
        $this->rules[] = ['fragment' => $fragment, 'json' => $json];

        return $this;
    }

    /**
     * Les `$times` PREMIERS appels échouent avec ce code, les suivants retombent sur les règles.
     *
     * C'est ce qui rend le rejeu observable : un refus de session suivi d'un succès. Épuisable et
     * prioritaire sur `$rules` — délibérément un mécanisme SÉPARÉ et non une règle, pour ne pas
     * toucher à la sémantique « la première règle déclarée qui matche gagne » : retirer une règle
     * épuisée changerait l'ordre en cours de test.
     */
    public function failsTimes(int $times, int $code, string $message = 'Session not existed!'): static
    {
        $this->failuresRemaining = $times;
        $this->transientJson = self::failure($code, $message);

        return $this;
    }

    /**
     * Le transport rend quelque chose que `json_decode` ne sait pas lire.
     *
     * Ce cas n'est PAS couvert par le `errors[0]->code` d'origine : `null->errors` y produisait
     * une cascade de warnings, et `phpunit.xml` a `failOnWarning="true"`.
     */
    public function returnsGarbage(): static
    {
        return $this->respondsWith('<html>502 Bad Gateway</html>');
    }

    /*
    |--------------------------------------------------------------------------
    | Charges JSON — la forme que `responseJson()` attend
    |--------------------------------------------------------------------------
    */

    /** Succès sans aucune ligne : la réponse de TOUT INSERT / UPDATE / DELETE / DDL. */
    public static function successWithoutRows(): string
    {
        return json_encode(['errors' => [['code' => 0]], 'results' => [new \stdClass]]);
    }

    /**
     * Succès avec des lignes, la forme que `formatValues()` sait déplier.
     *
     * @param  array<int, string>  $columns
     * @param  array<int, array<int, mixed>>  $rows  une entrée par ligne, une valeur par colonne
     */
    public static function successWithRows(array $columns, array $rows): string
    {
        return json_encode([
            'errors' => [['code' => 0]],
            'results' => [[
                'columns' => $columns,
                'data' => array_map(
                    static fn (array $row): array => ['row' => $row, 'meta' => array_fill(0, count($row), null)],
                    $rows
                ),
            ]],
        ]);
    }

    public static function failure(int $code, string $message = 'SyntaxError'): string
    {
        return json_encode(['errors' => [['code' => $code, 'message' => $message]]]);
    }

    /*
    |--------------------------------------------------------------------------
    | Ce que le client fait
    |--------------------------------------------------------------------------
    */

    public function authenticate(string $username, string $password): bool
    {
        return true;
    }

    public function executeJson(string $stmt)
    {
        $this->statements[] = $stmt;

        if ($this->failuresRemaining > 0) {
            $this->failuresRemaining--;

            return $this->transientJson;
        }

        foreach ($this->rules as $rule) {
            if (str_contains($stmt, $rule['fragment'])) {
                return $rule['json'];
            }
        }

        return $this->default;
    }

    public function execute(string $stmt)
    {
        return $this->executeJson($stmt);
    }

    /**
     * ⚠️ OVERRIDE OBLIGATOIRE, ET LE PIÈGE EST FATAL SI ON L'OUBLIE.
     *
     * Cette doublure n'appelle pas `parent::__construct()` (cf. le docblock de tête), donc
     * `$this->connection` est **null**. La vraie `refreshSession()` finirait par appeler
     * `$this->connection->authenticate(...)` : `Error: Call to a member function on null`, pas un
     * warning rattrapable. On se contente donc de COMPTER — cette doublure observe la couture, elle
     * ne simule pas la logique de session. Cette logique-là se teste avec `FakeGraphService`, qui se
     * branche un cran plus bas encore.
     */
    public function refreshSession(string $username, string $password): bool
    {
        $this->refreshCount++;

        return true;
    }

    public function logout($session_id = null): void
    {
        $this->signOuts[] = (string) $session_id;
    }

    /*
    |--------------------------------------------------------------------------
    | Observation
    |--------------------------------------------------------------------------
    */

    /** @return array<int, string> le nGQL réellement parti, dans l'ordre */
    public function statements(): array
    {
        return $this->statements;
    }

    public function lastStatement(): ?string
    {
        return $this->statements === [] ? null : $this->statements[array_key_last($this->statements)];
    }

    /** Combien de fois la couture a demandé une session neuve. */
    public function refreshCount(): int
    {
        return $this->refreshCount;
    }

    /** @return array<int, string> les identifiants dont on a demandé la déconnexion */
    public function signOuts(): array
    {
        return $this->signOuts;
    }

    /**
     * Oublie le journal — appelé par `fakeNebulaGraphConnection()` après construction.
     *
     * Le constructeur de `NebulaGraphConnection` émet un `USE <space>` : sans cet oubli, chaque
     * test devrait décaler ses index d'un cran pour une requête qu'il n'a pas demandée.
     */
    public function forgetStatements(): static
    {
        $this->statements = [];

        return $this;
    }
}
