<?php

namespace Dauvray\Socializer\Tests\Feature\Profile;

use Dauvray\Socializer\app\Services\Users as UserService;
use Dauvray\Socializer\Tests\Stubs\FakeNebulaGraph;
use Dauvray\Socializer\Tests\Stubs\User;
use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use PHPUnit\Framework\Attributes\Test;

/**
 * E3 — la liste de contacts cesse d'énumérer tous les utilisateurs.
 *
 * Arbitrage produit rendu le 25/08/2026 : **`list_users` voit tout le monde, les autres ne
 * voient que les joignables** au sens de `mayReach` (groupe commun OU follow réciproque) —
 * exactement le prédicat que les 5 routes de signalisation appliquent depuis C2. Avant, la
 * route rendait tous les utilisateurs actifs à tout authentifié : son contrôle de permission
 * était commenté.
 *
 * ⚠️ CE FICHIER TESTE `visibleUsers()`, PAS LA ROUTE. `getUsersList()` appelle
 * `makePaginationCollection()`, helper d'`innovation/laravel-estarter` — paquet absent du
 * harnais, cf. décision 2 de `tests/TestCase`. Le maillon service → pagination → HTTP se
 * contre-vérifie dans l'application ; le périmètre, lui, est ici.
 *
 * ⚠️ CE QUE LA DOUBLURE NE PROUVE PAS. `FakeNebulaGraph` fait du `str_contains`, il ne PARSE
 * pas le nGQL : que le lot et l'unitaire s'accordent est vérifié sur des réponses SCRIPTÉES
 * séparément. Ce qui est réellement exercé, c'est la jambe MariaDB (sqlite, vraies requêtes),
 * l'inclusion de soi-même et le refus par défaut. La requête en lot elle-même se contre-vérifie
 * sur un vrai graphe.
 */
class UserListScopeTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // `Users::__construct` résout `onlineUsers`, singleton posé par le provider d'estarter
        // — absent du harnais. Doublure volontairement vide : `visibleUsers` ne s'en sert pas,
        // et tout appel inattendu lèvera au lieu de passer inaperçu.
        $this->app->instance('onlineUsers', new \stdClass);
    }

    /**
     * La réponse de la requête de liste : PLUSIEURS colonnes, donc des lignes associatives.
     *
     * ⚠️ À ne pas confondre avec la requête en lot de `reachableVertexIds`, qui n'a qu'UNE
     * colonne et rend donc une liste plate — cf. `withMutuals()`.
     */
    private function listRows(User ...$users): array
    {
        return array_map(fn (User $u) => [
            'user' => [
                'id' => $u->vertexid,
                'name' => $u->name,
                'connected' => 1,
            ],
            'follow_status' => null,
            'nb_followers' => 0,
        ], $users);
    }

    /** Le graphe scripté sur ses deux requêtes : la liste, et le lot des follows réciproques. */
    private function fakeGraph(array $rows, array $mutual_vertexids = []): FakeNebulaGraph
    {
        return $this->fakeNebulaGraph()
            ->when('AS reachable_vertexid', $mutual_vertexids)
            ->when('active: 1', $rows);
    }

    /** @return array<int, string> les noms rendus, dans l'ordre */
    private function listSeenBy(User $viewer): array
    {
        $this->actingAs($viewer);

        // Instancié APRÈS la doublure : le constructeur résout `nebulaGraph` au conteneur.
        return array_map(fn (object $u) => $u->name, (new UserService)->visibleUsers());
    }

    /** Les requêtes du prédicat en lot, isolées de celle de la liste. */
    private function reachableQueries(FakeNebulaGraph $graph): array
    {
        return array_values(array_filter(
            $graph->queries(),
            fn (string $nGQL) => str_contains($nGQL, 'AS reachable_vertexid')
        ));
    }

    #[Test]
    public function sans_permission_la_liste_se_limite_aux_joignables(): void
    {
        $alice = $this->makeUser('alice', groupId: 42);
        $bob = $this->makeUser('bob', groupId: 42);
        $dave = $this->makeUser('dave', groupId: null);
        $mallory = $this->makeUser('mallory', groupId: null);

        $this->fakeGraph(
            rows: $this->listRows($alice, $bob, $dave, $mallory),
            mutual_vertexids: [$dave->vertexid],
        );

        // bob par le groupe, dave par le follow réciproque, alice par le court-circuit
        // d'identité (multi-onglet) — et mallory, inconnue, disparaît de la liste.
        $this->assertSame(['alice', 'bob', 'dave'], $this->listSeenBy($alice));
    }

    #[Test]
    public function la_permission_list_users_rend_la_liste_entiere(): void
    {
        $alice = $this->makeUser('alice', groupId: null);
        $mallory = $this->makeUser('mallory', groupId: null);

        Gate::define('list_users', fn (User $user) => $user->is($alice));

        $graph = $this->fakeGraph(
            rows: $this->listRows($alice, $mallory),
            mutual_vertexids: [],
        );

        $this->assertSame(['alice', 'mallory'], $this->listSeenBy($alice));

        // Et le privilégié ne paie pas le prédicat : sans filtre à appliquer, les deux requêtes
        // du lot n'ont aucune raison de partir.
        $this->assertSame([], $this->reachableQueries($graph));
    }

    #[Test]
    public function une_panne_du_graphe_ne_rouvre_pas_la_liste(): void
    {
        $alice = $this->makeUser('alice', groupId: 42);
        $bob = $this->makeUser('bob', groupId: 42);
        $mallory = $this->makeUser('mallory', groupId: null);

        // `grapheMuet()` et non `[]` : sur une LECTURE la production rend un JsonResponse — un
        // objet, donc truthy — au lieu de lever. C'est ce que la jambe follow doit traiter comme
        // un refus, pas comme « aucun follow ».
        $this->fakeNebulaGraph()
            ->when('AS reachable_vertexid', $this->grapheMuet())
            ->when('active: 1', $this->listRows($alice, $bob, $mallory));

        Log::spy();

        // La jambe MariaDB tient toujours — la liste se resserre, elle ne s'ouvre pas.
        $this->assertSame(['alice', 'bob'], $this->listSeenBy($alice));

        Log::shouldHaveReceived('warning')
            ->withArgs(fn (string $message, array $context) => str_contains($message, 'reachableVertexIds')
                && ($context['from_vertexid'] ?? null) === $alice->vertexid)
            ->once();
    }

    #[Test]
    public function une_panne_du_graphe_sur_la_liste_elle_meme_ne_rend_rien_et_le_dit(): void
    {
        $alice = $this->makeUser('alice', groupId: 42);

        $this->fakeNebulaGraph()->always($this->grapheMuet());

        Log::spy();

        $this->assertSame([], $this->listSeenBy($alice));

        // ⚠️ Sans le garde `is_array`, ce test n'échoue pas : il ERREUR. `foreach` itère le seul
        // attribut public de la réponse Symfony (`$headers`) et `$res['user']` lève « Cannot use
        // object of type ResponseHeaderBag as array » — donc un 500. Le garde ramène la panne à
        // une liste vide, et le journal est ce qui l'empêche de se lire « aucun utilisateur ».
        Log::shouldHaveReceived('warning')
            ->withArgs(fn (string $message, array $context) => str_contains($message, 'getUsersList')
                && ($context['user_vertexid'] ?? null) === $alice->vertexid)
            ->once();
    }

    #[Test]
    public function le_lot_dit_la_meme_chose_que_le_predicat_unitaire(): void
    {
        $alice = $this->makeUser('alice', groupId: 42);
        $bob = $this->makeUser('bob', groupId: 42);
        $dave = $this->makeUser('dave', groupId: null);
        $mallory = $this->makeUser('mallory', groupId: null);

        // Les deux formes de la jambe follow, scriptées pour dire la même chose : dave est
        // réciproque, personne d'autre. L'ordre compte — la première règle qui matche gagne.
        $this->fakeNebulaGraph()
            ->when('AS reachable_vertexid', [$dave->vertexid])
            ->when("AND id(b) == '".$dave->vertexid."'", [true])
            ->when('AS mutual', [false]);

        $this->actingAs($alice);

        $reachable = $alice->reachableVertexIds();

        // L'invariant : une divergence entre le lot et l'unitaire ferait une liste qui propose
        // ce que la signalisation refuse, ou qui cache ce qu'elle accorde.
        foreach ([$alice, $bob, $dave, $mallory] as $candidat) {
            $this->assertSame(
                $alice->mayReach($candidat),
                isset($reachable[$candidat->vertexid]),
                'Divergence lot / unitaire sur '.$candidat->name
            );
        }

        // Et le verdict lui-même n'est pas trivialement vrai ou faux partout.
        $this->assertFalse($alice->mayReach($mallory));
        $this->assertTrue($alice->mayReach($dave));
    }
}
