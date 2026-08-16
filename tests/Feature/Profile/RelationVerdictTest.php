<?php

namespace Dauvray\Socializer\Tests\Feature\Profile;

use Dauvray\Socializer\app\Services\Users as UserService;
use Dauvray\Socializer\Tests\Stubs\FakeNebulaGraph;
use Dauvray\Socializer\Tests\Stubs\User;
use Dauvray\Socializer\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;

/**
 * C5 — la charge utile du profil porte le verdict de la règle de relation (C2).
 *
 * Depuis C2, les 5 routes de signalisation refusent un destinataire sans relation. Le bouton
 * d'appel du mur, lui, ne s'affichait que sur `user.connected` : il proposait donc un appel
 * qui partait en 403, et comme aucun composable WebRTC2 n'inspecte le statut HTTP, l'échec
 * était strictement silencieux. `getGraphUser` expose désormais le même prédicat que le garde,
 * pour que le bouton cesse de mentir.
 *
 * ⚠️ CE N'EST PAS UN CONTRÔLE. Ce que ce fichier vérifie est de l'UX : le serveur reste
 * l'autorité et refuse même si le bouton s'affichait. Les tests du contrôle sont dans
 * `Signaling/RelationGuardTest`.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS — le dernier maillon. `Http/Resources/User` sérialise
 * `may_reach`, mais cette ressource étend celle d'estarter et appelle `revealIdentifier()` :
 * deux dépendances d'un paquet absent du harnais. La route `/wall/{slug}` est hors de portée
 * ici pour la même raison (`WallController` référence `App\Models\User` en dur, et non
 * `config('estarter.models.user')`). Le maillon service → ressource → HTTP se contre-vérifie
 * dans l'application, pas ici.
 */
class RelationVerdictTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // `Users::__construct` résout `onlineUsers`, singleton posé par le provider d'estarter
        // — absent du harnais. La doublure est volontairement vide : `getGraphUser` ne s'en
        // sert pas, et tout appel inattendu lèvera au lieu de passer inaperçu.
        $this->app->instance('onlineUsers', new \stdClass());
    }

    /**
     * Le graphe, scripté sur ses DEUX requêtes — qu'il ne faut surtout pas confondre :
     *
     *  - `AS mutual`     : la jambe follow de `mayReach`, le verdict lui-même ;
     *  - `nb_followers`  : la lecture du profil, qui contient elle aussi `followed_by` et
     *                      capterait donc une règle posée sur ce fragment.
     *
     * `[$mutual]` et non `[null]` pour le refus : `followsMutually` traite une ligne absente
     * comme une panne du graphe (cf. `RelationGuardTest`), pas comme une absence de follow.
     */
    private function fakeGraph(User $target, bool $mutual): FakeNebulaGraph
    {
        return $this->fakeNebulaGraph()
            ->when('AS mutual', [$mutual])
            ->when('nb_followers', [[
                'user' => [
                    'id' => $target->vertexid,
                    'name' => $target->name,
                    'connected' => 1,
                ],
                'nb_followers' => 3,
                'follow_status' => null,
            ]]);
    }

    /**
     * @return array<string, mixed>
     */
    private function profileSeenBy(User $viewer, User $target): array
    {
        $this->actingAs($viewer);

        // Instancié APRÈS la doublure : le constructeur résout `nebulaGraph` au conteneur.
        return (new UserService())->getGraphUser($target);
    }

    /** Les requêtes du prédicat, isolées de celle du profil. */
    private function predicateQueries(FakeNebulaGraph $graph): array
    {
        return array_values(array_filter(
            $graph->queries(),
            fn (string $nGQL) => str_contains($nGQL, 'AS mutual')
        ));
    }

    #[Test]
    public function un_groupe_commun_autorise_le_bouton(): void
    {
        $bob = $this->makeUser('bob', groupId: 42);
        $graph = $this->fakeGraph($bob, mutual: false);

        $alice = $this->makeUser('alice', groupId: 42);

        $profil = $this->profileSeenBy($alice, $bob);

        // Strict : le front distingue `false` d'une clé absente, pas `false` de `0`.
        $this->assertTrue($profil['may_reach']);

        // Et la jambe SQL doit trancher seule — la lecture d'un profil ne paie pas un
        // aller-retour Thrift de plus.
        $this->assertSame([], $this->predicateQueries($graph));
    }

    #[Test]
    public function deux_inconnus_masquent_le_bouton(): void
    {
        $mallory = $this->makeUser('mallory', groupId: null);
        $this->fakeGraph($mallory, mutual: false);

        // `groupId: null` est le point important : sans lui, `makeUser` inscrit tout le monde
        // dans le même groupe et ce test passerait au vert pour la mauvaise raison.
        $alice = $this->makeUser('alice', groupId: null);

        $this->assertFalse($this->profileSeenBy($alice, $mallory)['may_reach']);
    }

    #[Test]
    public function un_follow_reciproque_autorise_le_bouton(): void
    {
        $bob = $this->makeUser('bob', groupId: null);
        $this->fakeGraph($bob, mutual: true);

        $alice = $this->makeUser('alice', groupId: null);

        $this->assertTrue($this->profileSeenBy($alice, $bob)['may_reach']);
    }

    #[Test]
    public function son_propre_profil_ne_paie_pas_le_predicat(): void
    {
        $alice = $this->makeUser('alice', groupId: null);
        $graph = $this->fakeGraph($alice, mutual: false);

        // Le court-circuit d'identité de `mayReach` : sans groupe ni follow, alice reste
        // joignable par elle-même (multi-onglet), et le graphe n'est pas interrogé pour ça.
        $this->assertTrue($this->profileSeenBy($alice, $alice)['may_reach']);
        $this->assertSame([], $this->predicateQueries($graph));
    }

    #[Test]
    public function le_verdict_n_evince_pas_le_reste_de_la_charge_utile(): void
    {
        $bob = $this->makeUser('bob', groupId: 42);
        $this->fakeGraph($bob, mutual: false);

        $alice = $this->makeUser('alice', groupId: 42);

        $profil = $this->profileSeenBy($alice, $bob);

        // `may_reach` s'ajoute à côté de `nb_followers` / `follow_status`, il ne les remplace
        // pas : le mur lit les trois dans la même réponse.
        $this->assertSame(3, $profil['nb_followers']);
        $this->assertArrayHasKey('follow_status', $profil);
        $this->assertSame($bob->vertexid, $profil['id']);
    }
}
