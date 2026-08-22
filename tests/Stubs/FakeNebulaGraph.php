<?php

namespace Dauvray\Socializer\Tests\Stubs;

use Dauvray\Socializer\app\Exceptions\NebulaGraphException;

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

    /**
     * Les requêtes portant ce fragment LÈVENT, comme les 6 méthodes DML depuis E7.
     *
     * Scripter un `JsonResponse` sur un chemin d'écriture ne décrit plus la production : les
     * écritures ne rendent plus l'erreur, elles la lèvent. Sans ce mode, un test de rattrapage
     * resterait vert sans jamais exercer son `catch`.
     *
     * ⚠️ Réservé aux ÉCRITURES. Sur une lecture, la production rend toujours un `JsonResponse` —
     * c'est `grapheMuet()` qu'il faut, et tout E4.1 en dépend.
     */
    public function throwsOn(string $fragment, int $code = -1004, string $message = 'SyntaxError'): static
    {
        return $this->when($fragment, NebulaGraphException::writeRefused(
            'insertEdge', $code, $message, $fragment
        ));
    }

    public function execute(string $nGQL): mixed
    {
        $this->queries[] = $nGQL;

        foreach ($this->rules as $rule) {
            if (str_contains($nGQL, $rule['fragment'])) {
                // La requête est journalisée AVANT la levée : `queries()` doit rester le seul
                // point d'observation, y compris pour ce qui a échoué.
                if ($rule['result'] instanceof \Throwable) {
                    throw $rule['result'];
                }

                return $rule['result'];
            }
        }

        return $this->default;
    }

    /**
     * Les helpers d'écriture d'arête (`setRegisteredRelation`, `setHasCreatorRelation`, …)
     * n'appellent pas `execute()` mais `insertEdge()`. En production celui-ci finit néanmoins
     * par `return $this->execute($query)` (`NebulaGraphConnection::insertEdge`) : la doublure
     * fait de même, pour que `queries()` reste le SEUL point d'observation.
     *
     * ⚠️ Sans cette méthode, l'appel lèverait « undefined method » — et l'assertion « aucune
     * inscription n'est partie » ne pourrait jamais rougir autrement que par un fatal, donc ne
     * garderait rien.
     *
     * La requête reconstruite n'est pas la vraie (`INSERT EDGE x (props) VALUES …`) : juste
     * assez fidèle pour qu'un test y cherche `INSERT EDGE <label>` et la direction `from->to`.
     *
     * @param  array<string, mixed>  $values  clés au format `from->to`
     */
    public function insertEdge(string $label = 'default', array $values = []): mixed
    {
        return $this->execute('INSERT EDGE '.$label.' VALUES "'.((string) array_key_first($values)).'"');
    }

    /**
     * Même raison que `insertEdge` ci-dessus, pour les autres méthodes DML : en production elles
     * finissent toutes par `return $this->execute($query)`, la doublure fait de même pour que
     * `queries()` reste le seul point d'observation.
     *
     * Elles ne s'ajoutent qu'au fur et à mesure des tests qui les exigent — décision 5 du harnais.
     * Celles-ci ont été ajoutées par E7, pour les listeners de réplica.
     *
     * @param  array<int, string>  $directions  au format `from->to`
     */
    public function deleteEdge(string $label = 'default', array $directions = []): mixed
    {
        return $this->execute('DELETE EDGE '.$label.' "'.implode('","', $directions).'"');
    }

    /** @param  array<string, mixed>  $values */
    public function updateVertex(string $label = 'default', $vertex_id = null, array $values = []): mixed
    {
        return $this->execute('UPDATE VERTEX ON '.$label.' "'.((string) $vertex_id).'" SET '.implode(',', array_keys($values)));
    }

    /** @return array<int, string> */
    public function queries(): array
    {
        return $this->queries;
    }
}
