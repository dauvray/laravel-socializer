<?php

namespace Dauvray\Socializer\Tests\Stubs;

/**
 * Doublure du binding `nebulaGraph`.
 *
 * Le paquet n'accède JAMAIS au graphe autrement que par `app('nebulaGraph')->execute($nGQL)`
 * (binding posé dans `ServiceProvider::register`). Cette couture unique est ce qui rend les
 * gardes de relation — `canJoinRoom`, `canJoinServer`, et le futur `mayReach` de C2 —
 * testables sans serveur NebulaGraph.
 *
 * Deux modes, volontairement primitifs :
 *   - `always($result)`      : toute requête renvoie ce résultat ;
 *   - `when($fragment, $r)`  : la première règle dont le FRAGMENT apparaît dans le nGQL gagne.
 *
 * ⚠️ Le fragment est une correspondance de sous-chaîne, pas une analyse du nGQL. C'est
 * suffisant tant que les tests visent une requête identifiable (« MATCH (r:room) »), et ça
 * évite d'écrire un moteur de graphe de test — qui mentirait bien plus qu'il n'aiderait.
 *
 * `queries()` expose ce qui a été exécuté : un test peut ainsi asserter qu'AUCUNE requête
 * n'a été émise (garde qui refuse avant de toucher au graphe).
 */
class FakeNebulaGraph
{
    /** @var array<int, array{fragment: string, result: mixed}> */
    private array $rules = [];

    private mixed $default = [];

    /** @var array<int, string> */
    private array $queries = [];

    public function always(mixed $result): static
    {
        $this->default = $result;

        return $this;
    }

    public function when(string $fragment, mixed $result): static
    {
        $this->rules[] = ['fragment' => $fragment, 'result' => $result];

        return $this;
    }

    public function execute(string $nGQL): mixed
    {
        $this->queries[] = $nGQL;

        foreach ($this->rules as $rule) {
            if (str_contains($nGQL, $rule['fragment'])) {
                return $rule['result'];
            }
        }

        return $this->default;
    }

    /** @return array<int, string> */
    public function queries(): array
    {
        return $this->queries;
    }
}
