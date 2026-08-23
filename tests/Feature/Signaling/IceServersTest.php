<?php

namespace Dauvray\Socializer\Tests\Feature\Signaling;

use Dauvray\Socializer\Tests\TestCase;
use PHPUnit\Framework\Attributes\Test;

/**
 * `/get-ice-servers` — la configuration ICE se calcule sur le serveur, plus dans le bundle.
 *
 * `VITE_COTURN_USERNAME` / `VITE_COTURN_CREDENTIAL` étaient inlinés par Vite au build : le mot de
 * passe du conteneur coturn était en clair dans `public/build/assets/js/*.js`, servi à tout
 * visiteur. Relais TURN ouvert.
 *
 * ⚠️ CETTE ROUTE EST PUBLIQUE ET REND TOUJOURS 200, et ce n'est pas une facilité. La coquille SPA
 * `/app/{any}` est publique, `Notifications.vue` y monte le contexte `data-app` avant tout login,
 * donc un invité appelle cette route — et `AjaxService.load` d'estarter fait
 * `document.location.reload()` sur un 401. Un garde par middleware produirait une boucle de
 * rechargement sur la page de login. La garde est donc `Auth::check()`, DANS le contrôleur, et
 * c'est le premier test ci-dessous qui l'épingle.
 *
 * ⚠️ PREMIER TEST DU PAQUET À TRAVERSER `routes.public.php`. Le harnais met
 * `estarter.routes_middlewares.classic.public = []` (cf. `TestCase::defineEnvironment`, décision
 * 1) : la branche existait mais n'avait jamais été exercée par une requête. Ne PAS « fidéliser »
 * le harnais en y remettant `['web','routeProtect','restrictedMode']` — `routeProtect` et
 * `restrictedMode` sont des alias posés par estarter et formdesigner, non installés en test, et le
 * conteneur lèverait `Target class [routeProtect] does not exist` sur TOUTE la suite. Ce que le
 * harnais ne prouvera donc jamais, et qui se vérifie une fois à la main sur le dev, est écrit dans
 * la bannière de `routes.public.php` : que `routeProtect` laisse passer l'invité, et que
 * `restrictedMode` exige `X-Requested-With`.
 */
class IceServersTest extends TestCase
{
    private const URI = '/get-ice-servers';

    protected function setUp(): void
    {
        parent::setUp();

        // Le harnais reste neutre, le test déclare son état — même parti pris que
        // `ThrottleTest::setThrottle()`. Nécessaire ici : `phpunit.xml` ne définit pas `APP_URL`,
        // donc le défaut `parse_url(env('APP_URL'), PHP_URL_HOST)` rend `null` sous Testbench et
        // l'entrée TURN n'existerait jamais — les tests seraient verts en ne gardant plus rien.
        $this->setIce('turn.host', 'turn.example.test');
        $this->setIce('turn.username', 'coturn-user');
        $this->setIce('turn.password', 'coturn-pass');
    }

    private function setIce(string $key, mixed $value): void
    {
        $this->app['config']->set('socializer.signaling.ice.'.$key, $value);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function iceServers(mixed $response): array
    {
        return $response->json('iceServers');
    }

    #[Test]
    public function un_invite_recoit_stun_seul_sans_aucun_identifiant(): void
    {
        $response = $this->getJson(self::URI);

        $response->assertOk();

        $iceServers = $this->iceServers($response);
        $this->assertCount(1, $iceServers);
        $this->assertStringStartsWith('stun:', $iceServers[0]['urls']);

        // Sur le corps entier, pas seulement sur l'entrée TURN : c'est la fuite qu'on interdit,
        // quel que soit l'endroit d'où elle sortirait.
        $response->assertDontSee('coturn-user');
        $response->assertDontSee('coturn-pass');
        $response->assertDontSee('credential');
    }

    #[Test]
    public function un_utilisateur_authentifie_recoit_stun_et_turn(): void
    {
        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $response->assertOk();

        $iceServers = $this->iceServers($response);
        $this->assertCount(2, $iceServers);
        $this->assertStringStartsWith('stun:', $iceServers[0]['urls']);
        $this->assertStringStartsWith('turn:', $iceServers[1]['urls']);
        $this->assertSame('coturn-user', $iceServers[1]['username']);
        $this->assertSame('coturn-pass', $iceServers[1]['credential']);
    }

    #[Test]
    public function l_url_turn_reprend_l_hote_et_le_port_configures(): void
    {
        $this->setIce('turn.port', 3479);

        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        // Pin de la construction : un seul schéma, pas de `?transport=`, port casté en entier.
        $this->assertSame('turn:turn.example.test:3479', $this->iceServers($response)[1]['urls']);
    }

    #[Test]
    public function sans_identifiant_coturn_aucune_entree_turn_n_est_emise(): void
    {
        // Le déploiement sans relais. Surtout pas une entrée aux identifiants nuls : l'agent ICE
        // l'interrogerait et attendrait son échec d'authentification avant de conclure.
        $this->setIce('turn.password', null);

        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $response->assertOk();
        $this->assertSame([], $this->turnEntries($response));
    }

    #[Test]
    public function sans_hote_turn_aucune_entree_turn_n_est_emise(): void
    {
        // `false` et non `null` : c'est ce que rend `parse_url()` sur une URL malformée, et c'est
        // le cas que `blank()` aurait laissé passer (`blank(false) === false`).
        $this->setIce('turn.host', false);

        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $response->assertOk();
        $this->assertSame([], $this->turnEntries($response));
    }

    #[Test]
    public function la_charge_utile_ne_relaie_que_les_trois_cles_attendues(): void
    {
        // Le niveau 2 (credentials HMAC éphémères) posera un secret dans CE bloc de config. Ce
        // test est ce qui arrêtera un `return response()->json(config('socializer.signaling.ice'))`
        // écrit ce jour-là.
        $this->setIce('turn.static_auth_secret', 'NE-DOIT-PAS-FUIR');

        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $response->assertDontSee('NE-DOIT-PAS-FUIR');
        $this->assertSame(
            ['urls', 'username', 'credential'],
            array_keys($this->iceServers($response)[1]),
        );
    }

    #[Test]
    public function une_section_ice_absente_ne_casse_pas_la_route(): void
    {
        // `mergeConfigFrom` est un `array_merge` PEU PROFOND : un hôte qui a publié
        // `config/socializer.php` avec un `signaling` sans `ice` écrase toute la section. Le
        // contrôleur doit alors dégrader en STUN, pas rendre 500.
        $this->app['config']->set('socializer.signaling.ice', []);

        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $response->assertOk();
        $this->assertSame([['urls' => 'stun:stun.l.google.com:19302']], $this->iceServers($response));
    }

    #[Test]
    public function tous_les_serveurs_stun_configures_sont_servis(): void
    {
        $this->setIce('stun_urls', ['stun:a.test:1', 'stun:b.test:2']);

        $response = $this->getJson(self::URI);

        $this->assertSame(
            [['urls' => 'stun:a.test:1'], ['urls' => 'stun:b.test:2']],
            $this->iceServers($response),
        );
    }

    #[Test]
    public function la_reponse_interdit_toute_mise_en_cache_partagee(): void
    {
        // Une même URL rend deux charges utiles selon la session, et l'une porte un identifiant.
        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function turnEntries(mixed $response): array
    {
        return array_values(array_filter(
            $this->iceServers($response),
            fn (array $entry): bool => str_starts_with($entry['urls'], 'turn:'),
        ));
    }
}
