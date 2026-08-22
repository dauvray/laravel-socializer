<?php

namespace Dauvray\Socializer\Tests\Feature\Profile;

use Dauvray\Socializer\app\Services\Users as UsersService;
use Dauvray\Socializer\Tests\Stubs\FakeOnlineUsers;
use Dauvray\Socializer\Tests\Stubs\User;
use Dauvray\Socializer\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;

/**
 * E7 — suivre et ne plus suivre ne se déclarent pas réussis quand le graphe a refusé l'écriture.
 *
 * `followUser` et `unfollowUser` concluaient sur `count($result) === 0`. Deux façons dont c'était
 * faux, et les deux comptent :
 *
 *   - sur une écriture RÉUSSIE, `$result` vaut `[]` — donc `count()` valait 0, donc `true`. La
 *     branche `return false` n'était jamais prise : elle ressemblait à une gestion d'erreur, elle
 *     n'en était pas une.
 *   - sur une écriture REFUSÉE, `$result` valait un `JsonResponse`, et `count()` sur un objet lève
 *     un `TypeError` — soit un 500 opaque à la place d'un refus lisible.
 *
 * Depuis E7 l'écriture lève, le service rattrape et rend `false`, et `UserController` transforme
 * ce `false` en son 500 déjà rédigé en français : l'UX ne change pas, mais elle cesse de mentir.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. `FakeNebulaGraph` fait du `str_contains` : « le mur existe »
 * est une réponse scriptée, pas un fait de graphe. Ce qui est prouvé, c'est le verdict rendu par
 * le service selon que l'écriture passe ou non.
 */
class FollowVerdictTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // `Users::__construct` résout `app('onlineUsers')`, binding d'estarter absent du harnais.
        $this->app->instance('onlineUsers', new FakeOnlineUsers);
    }

    /** @return array{0: User, 1: UsersService} */
    private function actingUserAndService(): array
    {
        $alice = $this->makeUser('alice');
        $this->actingAs($alice);

        return [$alice, new UsersService];
    }

    #[Test]
    public function un_follow_refuse_par_le_graphe_ne_se_declare_pas_reussi(): void
    {
        $this->fakeNebulaGraph()
            ->when('RETURN id(w)', ['wallbob'])   // le mur de la cible existe
            ->throwsOn('INSERT EDGE');            // …mais l'arête est refusée

        [, $service] = $this->actingUserAndService();

        $this->assertFalse(
            $service->followUser($this->makeUser('bob')),
            'Le follow a échoué et le service l\'annonce réussi.'
        );
    }

    #[Test]
    public function un_unfollow_refuse_par_le_graphe_ne_se_declare_pas_reussi(): void
    {
        $this->fakeNebulaGraph()
            ->when('RETURN id(w)', ['wallbob'])
            ->throwsOn('DELETE EDGE');

        [, $service] = $this->actingUserAndService();

        $this->assertFalse($service->unfollowUser($this->makeUser('bob')));
    }

    /**
     * Le garde-fou de non-régression : c'est lui qui rougit si on ferme trop.
     *
     * Une écriture réussie rend `[]` — il ne faut pas confondre « aucune ligne rendue », qui est
     * la réponse NORMALE de tout INSERT, avec un échec.
     */
    #[Test]
    public function un_follow_qui_reussit_reste_reussi(): void
    {
        $this->fakeNebulaGraph()->when('RETURN id(w)', ['wallbob']);

        [, $service] = $this->actingUserAndService();

        $this->assertTrue($service->followUser($this->makeUser('bob')));
    }

    #[Test]
    public function un_unfollow_qui_reussit_reste_reussi(): void
    {
        $this->fakeNebulaGraph()->when('RETURN id(w)', ['wallbob']);

        [, $service] = $this->actingUserAndService();

        $this->assertTrue($service->unfollowUser($this->makeUser('bob')));
    }
}
