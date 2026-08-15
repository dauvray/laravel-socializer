<?php

namespace Dauvray\Socializer\Tests;

use Dauvray\Socializer\ServiceProvider as SocializerServiceProvider;
use Dauvray\Socializer\Tests\Stubs\FakeNebulaGraph;
use Dauvray\Socializer\Tests\Stubs\User;
use Illuminate\Broadcasting\AnonymousEvent;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Orchestra\Testbench\TestCase as BaseTestCase;

/**
 * Socle du harnais PHP — application Laravel fabriquée par Orchestra Testbench.
 *
 * Quatre décisions y sont prises, toutes contraintes par l'état réel du paquet. Les défaire
 * sans lire ce qui suit fait perdre une demi-journée :
 *
 *  1. PILE DE MIDDLEWARES SANS `web`. Le provider pousse
 *     `Dauvray\Estarter\...\UserActivity` dans le groupe `web` — une classe d'un AUTRE paquet
 *     (`innovation/laravel-estarter`), que le composer.json d'ici ne déclare pas. Traverser
 *     `web` obligerait donc à tirer estarter dans le harnais pour rien : `auth` suffit à ce
 *     que teste le lot C. ⚠️ Delta assumé — la pile de test n'est pas celle de production
 *     (qui vaut `['web','auth','routeProtect','verified','restrictedMode']`).
 *
 *  2. AUCUNE MIGRATION DU PAQUET. `ServiceProvider::boot` enregistre `src/database/migrations`,
 *     qui contient du MongoDB et du NebulaGraph : les jouer sur sqlite casse immédiatement.
 *     D'où la table `users` fabriquée à la main ci-dessous, et l'absence de `RefreshDatabase`.
 *
 *  3. NEBULAGRAPH REMPLACÉ AU CONTENEUR. Le paquet n'atteint le graphe que par
 *     `app('nebulaGraph')`, singleton posé dans `ServiceProvider::register`. Cette couture
 *     unique est ce qui rendra C2 testable.
 *
 *  4. LES BROADCASTS S'OBSERVENT PAR `Event::fake()`. Il n'existe PAS de `Broadcast::fake()`
 *     dans Laravel 13. `Broadcast::private(…)->sendNow()` construit un `AnonymousEvent` que
 *     `PendingBroadcast::__destruct` remet au dispatcher d'événements : c'est là qu'on
 *     l'intercepte. Voir `fakeBroadcasts()` / `assertBroadcastSent()` plus bas.
 */
abstract class TestCase extends BaseTestCase
{
    protected function getPackageProviders($app): array
    {
        return [
            // Requis par le trait `Socializable` du paquet (Sluggable).
            \Cviebrock\EloquentSluggable\ServiceProvider::class,
            SocializerServiceProvider::class,
        ];
    }

    protected function defineEnvironment($app): void
    {
        $config = $app['config'];

        // Base sqlite en mémoire, déclarée explicitement plutôt que dépendre du squelette
        // Testbench : une seule source de vérité, indépendante de sa version.
        $config->set('database.default', 'testing');
        $config->set('database.connections.testing', [
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
        ]);

        // ── Config de l'application hôte que le paquet lit ────────────────────────────
        // Le paquet ne connaît le modèle utilisateur que par cette clé : c'est exactement
        // ce qui permet de lui substituer un stub.
        $config->set('estarter.models.user', User::class);

        // Cf. décision 1 en tête de fichier.
        $config->set('estarter.routes_middlewares.classic.private', ['auth']);
        $config->set('estarter.routes_middlewares.classic.public', []);

        $config->set('auth.providers.users.model', User::class);
        $config->set('broadcasting.default', 'null');
    }

    protected function defineDatabaseMigrations(): void
    {
        // Cf. décision 2 : surtout pas les migrations du paquet. Le strict nécessaire à
        // `config('estarter.models.user')::where('slug', …)->firstOrFail()`.
        if (Schema::hasTable('users')) {
            return;
        }

        Schema::create('users', function ($table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->nullable()->unique();
            $table->string('vertexid')->nullable();
            $table->string('email')->unique();
            $table->string('password')->default('secret');
            $table->timestamps();
        });
    }

    /*
    |--------------------------------------------------------------------------
    | Helpers du harnais
    |--------------------------------------------------------------------------
    */

    /**
     * Crée un utilisateur. Le slug est dérivé du nom par Sluggable, comme en production.
     */
    protected function makeUser(string $name, array $attributes = []): User
    {
        return User::create(array_merge([
            'name' => $name,
            'email' => $name.'@example.test',
            'vertexid' => 'user'.$name,
        ], $attributes));
    }

    /**
     * Substitue la doublure du graphe au binding réel et la renvoie pour la scripter.
     */
    protected function fakeNebulaGraph(): FakeNebulaGraph
    {
        $fake = new FakeNebulaGraph();

        $this->app->instance('nebulaGraph', $fake);

        return $fake;
    }

    /**
     * Arme l'interception des broadcasts. Cf. décision 4 en tête de fichier.
     */
    protected function fakeBroadcasts(): void
    {
        Event::fake([AnonymousEvent::class]);
    }

    /**
     * Asserte qu'un broadcast a été émis sur le canal privé d'un utilisateur, sous un nom
     * d'événement donné. `$inspect` reçoit la charge utile (`broadcastWith()`).
     */
    protected function assertBroadcastSent(User $to, string $as, ?callable $inspect = null): void
    {
        Event::assertDispatched(
            AnonymousEvent::class,
            function (AnonymousEvent $event) use ($to, $as, $inspect) {
                if ($event->broadcastAs() !== $as) {
                    return false;
                }

                $channels = collect(\Illuminate\Support\Arr::wrap($event->broadcastOn()))
                    ->map(fn ($channel) => (string) $channel);

                if (! $channels->contains('private-App.Models.User.'.$to->id)) {
                    return false;
                }

                return $inspect === null || $inspect($event->broadcastWith()) !== false;
            }
        );
    }

    /**
     * Asserte qu'AUCUN broadcast n'est parti — l'assertion centrale des gardes du lot C :
     * un refus qui journaliserait sans émettre reste un refus, un refus qui émet n'en est pas un.
     */
    protected function assertNoBroadcastSent(): void
    {
        Event::assertNotDispatched(AnonymousEvent::class);
    }
}
