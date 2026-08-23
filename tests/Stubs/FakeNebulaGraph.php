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
 * ⚠️ **LA FORME DU RÉSULTAT SCRIPTÉ DÉPEND DU NOMBRE DE COLONNES, et cette doublure ne le vérifie
 * pas.** En production, `NebulaGraphConnection::formatValues` effondre une ligne d'une SEULE colonne
 * sur sa valeur : `RETURN id(s) AS server` rend `['server1', 'server2']`, une liste plate, tandis que
 * `RETURN id(s) AS server, id(g) AS grp` rend `[['server' => …, 'grp' => …]]`. Scripter des lignes
 * associatives pour une requête à une colonne fait donc passer au vert un code qui lit `null` en
 * production — vécu : la relecture d'idempotence du serveur d'un groupe créait un second serveur à
 * chaque projection, suite verte. Seule la contre-épreuve sur un vrai graphe l'a vu.
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

    /**
     * Même raison que `deleteEdge` ci-dessus, et la requête reconstruite est ici FIDÈLE : la
     * production émet exactement `DELETE VERTEX "<vid>"[ WITH EDGE]` (`stringFormatArray` pose les
     * guillemets). Un test peut donc asserter le vid visé au caractère près — c'est tout l'objet
     * d'`ArticleVertexTest`, la clé de config fautive donnant `"1"` au lieu de `"article1"`.
     *
     * ⚠️ Elle ne reproduit PAS le garde « liste vide » de la production (`$vids === []` ⇒ aucune
     * requête). Ce contrat-là s'épingle contre la vraie couture, pas contre une doublure qui en
     * ferait une seconde implémentation : `NebulaGraphSeamTest::supprimer_aucun_sommet_n_emet_aucune_requete`.
     *
     * @param  array<int, string>  $vids
     */
    public function deleteVertex(array $vids = [], bool $with_edge = false): mixed
    {
        return $this->execute('DELETE VERTEX "'.implode('","', $vids).'"'.($with_edge ? ' WITH EDGE' : ''));
    }

    /** @param  array<string, mixed>  $values */
    public function updateVertex(string $label = 'default', $vertex_id = null, array $values = []): mixed
    {
        return $this->execute('UPDATE VERTEX ON '.$label.' "'.((string) $vertex_id).'" SET '.implode(',', array_keys($values)));
    }

    /**
     * Même raison que `insertEdge` ci-dessus, avec une exigence de plus.
     *
     * ⚠️ ELLE DOIT RENDRE LE CONTRAT DE RETOUR DE PRODUCTION, pas le résultat d'`execute()`.
     * `NebulaGraphConnection::insertVertex` rend les fragments `"vid":(…)` qu'elle a construits, et
     * c'est la SEULE source de `getVertexIdFromInsert()`. Une doublure qui rendrait `[]` ferait
     * repartir `createUserAndNetwork` avec un vid vide, et ses arêtes pointeraient sur du néant —
     * un test vert sur un bug complet.
     *
     * L'id de repli reproduit le comportement de production (`$values['id'] ?? uniqidReal()`) mais
     * en restant lisible dans les assertions : ce qui compte est de distinguer « id fourni » de
     * « id tiré au hasard ».
     *
     * @param  array<string, mixed>  $values
     * @return array<int, string>
     */
    public function insertVertex(string $label = 'default', array $values = []): mixed
    {
        $vid = $values['id'] ?? 'vid-aleatoire-'.$label;

        // Journalisée avant tout retour, y compris si une règle `throwsOn` la fait lever.
        $this->execute('INSERT VERTEX IF NOT EXISTS '.$label.' VALUES "'.$vid.'":()');

        return ['"'.$vid.'":()'];
    }

    /**
     * Transformation PURE de la production — aucune requête, donc rien à journaliser.
     *
     * `NebulaGraphConnection::populatePropsFromPattern` remplit les propriétés depuis le modèle et,
     * surtout, en tire l'`id` du sommet quand le modèle expose `vertexId` (accesseur des traits
     * `Socializable` / `Commentable`). La doublure ne garde que cette sortie-là : c'est elle qui
     * décide du vid, donc la seule dont un test dépend. Reproduire le remplissage complet ferait
     * une seconde implémentation à maintenir, qui divergerait.
     *
     * @param  array<string, mixed>  $pattern
     * @return array<string, mixed>
     */
    public function populatePropsFromPattern($object, array $pattern): array
    {
        return isset($object->vertexId) ? ['id' => $object->vertexId] : [];
    }

    /** @return array<int, string> */
    public function queries(): array
    {
        return $this->queries;
    }
}
