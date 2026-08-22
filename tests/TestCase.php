<?php

namespace Dauvray\Socializer\Tests;

use App\Models\User as HostUser;
use Cviebrock\EloquentSluggable\ServiceProvider as SluggableServiceProvider;
use Dauvray\Socializer\app\Helpers\NebulaGraphConnection;
use Dauvray\Socializer\ServiceProvider as SocializerServiceProvider;
use Dauvray\Socializer\Tests\Stubs\FakeNebulaGraph;
use Dauvray\Socializer\Tests\Stubs\FakeOnlineUsers;
use Dauvray\Socializer\Tests\Stubs\FakeThriftClient;
use Dauvray\Socializer\Tests\Stubs\User;
use Illuminate\Broadcasting\AnonymousEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\DB;
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
 *     D'où les tables fabriquées à la main ci-dessous, et l'absence de `RefreshDatabase`.
 *     `users` pour la résolution du destinataire ; `group_user` pour le garde de relation,
 *     dont la migration vit qui plus est dans un AUTRE paquet (estarter).
 *
 *  3. NEBULAGRAPH REMPLACÉ AU CONTENEUR. Le paquet n'atteint le graphe que par
 *     `app('nebulaGraph')`, singleton posé dans `ServiceProvider::register`. Cette couture
 *     unique est ce qui rend le garde de relation de C2 testable. ⚠️ Elle a une limite :
 *     `FakeNebulaGraph` fait du `str_contains` sur le nGQL, il ne le PARSE pas. Un test vert
 *     sur la jambe follow ne prouve donc rien de la requête elle-même — cf. l'avertissement
 *     en tête de `RelationGuardTest`.
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
            SluggableServiceProvider::class,
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

        // Les compteurs de `throttle` vivent dans le cache. Déclaré explicitement pour la même
        // raison que la base ci-dessus : ne pas dépendre du défaut du squelette Testbench. Le
        // store `array` naît vide à chaque test, donc un plafond atteint ne déborde jamais sur
        // le test suivant.
        $config->set('cache.default', 'array');

        // ── Config de l'application hôte que le paquet lit ────────────────────────────
        // Le paquet ne connaît le modèle utilisateur que par cette clé : c'est exactement
        // ce qui permet de lui substituer un stub.
        $config->set('estarter.models.user', User::class);

        // Cf. décision 1 en tête de fichier.
        $config->set('estarter.routes_middlewares.classic.private', ['auth']);
        $config->set('estarter.routes_middlewares.classic.public', []);

        $config->set('auth.providers.users.model', User::class);
        $config->set('broadcasting.default', 'null');

        // `GraphProjection::projectAll()` marque une pause entre les sommets d'article et leurs
        // arêtes, parce que le schéma NebulaGraph est asynchrone. Le défaut du paquet est 20 s :
        // la garder bloquerait la suite pour rien, aucun graphe réel n'étant en jeu ici.
        $config->set('socializer.nebulagraph.sleeping_duration', 0);
    }

    protected function defineDatabaseMigrations(): void
    {
        // Cf. décision 2 : surtout pas les migrations du paquet. Le strict nécessaire à
        // `config('estarter.models.user')::where('slug', …)->first()`.
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

        // Pivot user ↔ group d'estarter, lu par `Socializable::mayReach`. Fabriqué à la main
        // pour la même raison que `users` : sa migration vit dans un AUTRE paquet, absent du
        // harnais. Le prédicat retenu est « même group_id exactement », il ne remonte pas le
        // nested set.
        Schema::create('group_user', function ($table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->unsignedBigInteger('group_id');
            $table->unique(['user_id', 'group_id']);
        });

        // `groups` n'est pas nécessaire à `mayReach`, mais l'est à `User::groups()` — que
        // `createUserAndNetwork()` parcourt — et au stub `Group`, cible de
        // `config('estarter.models.group')` quand un test projette les groupes.
        Schema::create('groups', function ($table) {
            $table->id();
            $table->string('name');
            $table->unsignedBigInteger('parent_id')->nullable();
        });
    }

    /*
    |--------------------------------------------------------------------------
    | Helpers du harnais
    |--------------------------------------------------------------------------
    */

    /**
     * Groupe par défaut de `makeUser`. Deux utilisateurs du harnais sont donc joignables au
     * sens de `mayReach` sans rien déclarer.
     */
    protected const DEFAULT_GROUP_ID = 1;

    /**
     * Crée un utilisateur. Le slug est dérivé du nom par Sluggable, comme en production.
     *
     * ⚠️ L'inscrit dans `DEFAULT_GROUP_ID` par défaut. Sans ça, le garde de relation de C2
     * refuserait toute signalisation entre deux utilisateurs du harnais, et les suites qui
     * testent AUTRE CHOSE (throttle, fuite d'exception, validation) échoueraient en 403 sans
     * rapport avec ce qu'elles vérifient.
     *
     * Passer `groupId: null` pour un inconnu — c'est ce dont `RelationGuardTest` a besoin.
     */
    protected function makeUser(string $name, array $attributes = [], ?int $groupId = self::DEFAULT_GROUP_ID): User
    {
        $user = User::create(array_merge([
            'name' => $name,
            'email' => $name.'@example.test',
            'vertexid' => 'user'.$name,
        ], $attributes));

        if ($groupId !== null) {
            $this->joinGroup($user, $groupId);
        }

        return $user;
    }

    /**
     * Inscrit un utilisateur dans un groupe — la jambe « contexte partagé » de `mayReach`.
     */
    protected function joinGroup(User $user, int $groupId): void
    {
        DB::table('group_user')->insert([
            'user_id' => $user->id,
            'group_id' => $groupId,
        ]);
    }

    /**
     * Substitue la doublure du graphe au binding réel et la renvoie pour la scripter.
     */
    protected function fakeNebulaGraph(): FakeNebulaGraph
    {
        $fake = new FakeNebulaGraph;

        $this->app->instance('nebulaGraph', $fake);

        return $fake;
    }

    /**
     * Substitue la VRAIE `NebulaGraphConnection`, branchée sur un client Thrift doublé.
     *
     * À utiliser quand ce qui est testé est la couture elle-même — le décodage de la réponse, la
     * levée sur écriture, la NON-levée sur lecture, le nGQL construit. `fakeNebulaGraph()`
     * remplace la connexion entière et ne peut donc rien en prouver : cf. le docblock de
     * `FakeThriftClient`.
     *
     * Le journal du client est vidé après construction : le constructeur émet un `USE <space>`
     * que le test n'a pas demandé, et sans cet oubli chaque assertion d'index serait décalée.
     */
    protected function fakeNebulaGraphConnection(?FakeThriftClient $client = null): NebulaGraphConnection
    {
        $client ??= new FakeThriftClient;

        $connection = new NebulaGraphConnection([
            'host' => '127.0.0.1',
            'port' => 9669,
            'username' => 'root',
            'password' => 'nebula',
            'space' => 'harnais',
            'partition' => 5,
            'replica_factor' => 3,
            'options' => [],
        ], $client);

        $client->forgetStatements();

        $this->app->instance('nebulaGraph', $connection);

        return $connection;
    }

    /**
     * Ce que `execute()` rend VRAIMENT sur erreur nGQL, sur le chemin LECTURE : un `JsonResponse`,
     * pas une exception. Un objet, donc *truthy* — c'est toute la raison d'être du refus par
     * défaut d'E4.1.
     *
     * Non résolu dans un fournisseur de données statique parce que `response()` a besoin de
     * l'application.
     *
     * ⚠️ Ne vaut que pour les LECTURES. Depuis E7, les 6 méthodes d'écriture DML lèvent une
     * `NebulaGraphException` — scripter `always($this->grapheMuet())` sur un chemin d'écriture
     * décrirait un contrat qui n'existe plus.
     */
    protected function grapheMuet(int $code = -1005, string $message = 'SemanticError'): JsonResponse
    {
        return response()->json(['code' => $code, 'message' => $message], 500);
    }

    /**
     * Substitue la doublure du service de présence et la renvoie pour la scripter.
     *
     * Le binding `onlineUsers` est posé par le provider d'estarter, absent du harnais : sans
     * cette substitution, tout chemin qui le résout lève une `BindingResolutionException`.
     */
    protected function fakeOnlineUsers(): FakeOnlineUsers
    {
        $fake = new FakeOnlineUsers;

        $this->app->instance('onlineUsers', $fake);

        return $fake;
    }

    /*
    |--------------------------------------------------------------------------
    | Canaux de diffusion
    |--------------------------------------------------------------------------
    */

    /**
     * ⚠️ `App\Models\User` et non `makeUser()` : les closures de `channels.php` sont typées sur
     * la classe de l'app hôte, en dur. Un `Tests\Stubs\User` ne satisfait pas la signature.
     *
     * Pas de `joinGroup` ici : aucun garde de canal ne lit l'appartenance MariaDB.
     */
    protected function makeChannelUser(string $name): HostUser
    {
        return HostUser::create([
            'name' => $name,
            'email' => $name.'@example.test',
            'vertexid' => 'user'.$name,
        ]);
    }

    /**
     * Invoque le callback d'un canal tel que `channels.php` l'a enregistré.
     *
     * `Broadcast::getChannels()` est publique et documentée sur la façade, servie par
     * `Broadcaster::getChannels()` : une Collection indexée par MOTIF. Les callbacks atterrissent
     * dans l'unique driver mémorisé — `broadcasting.default` vaut `null` dans le harnais, et
     * `NullBroadcaster` hérite du stockage des canaux de la classe de base.
     *
     * ⚠️ Le callback est appelé DIRECTEMENT, et non par `Broadcaster::auth()` : `auth()` est un
     * no-op sur les drivers `null` et `log`, et les seuls qui descendent dans
     * `verifyUserCanAccessChannel` (Pusher/Redis/Ably) terminent par un `json_encode` du
     * résultat.
     */
    protected function joinChannel(string $pattern, HostUser $user, string ...$parameters): mixed
    {
        $callback = Broadcast::getChannels()->get($pattern);

        // Sans cette garde, un motif renommé rendrait `null` et TOUS les tests de refus de canal
        // passeraient au vert sans avoir rien exercé.
        $this->assertIsCallable(
            $callback,
            "Le canal `$pattern` n'est plus enregistré par src/routes/socializer/channels.php."
        );

        return $callback($user, ...$parameters);
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

                $channels = collect(Arr::wrap($event->broadcastOn()))
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
