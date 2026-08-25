<?php

namespace Dauvray\Socializer\Tests\Feature\Signaling;

use Dauvray\Socializer\Tests\TestCase;
use Illuminate\Support\Carbon;
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
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVERA JAMAIS NON PLUS : que coturn ACCEPTE le credential. Les tests
 * ci-dessous épinglent le format, l'expiration et la non-fuite ; ils sont tous verts avec un
 * mauvais ordre de champs ou un mauvais encodage — le seul juge est le relais lui-même. Quatre
 * contre-épreuves à passer à la main, `turnutils_uclient` et `turnutils_peer` étant livrés dans
 * l'image `instrumentisto/coturn` :
 *
 *   COTURN_IP=$(docker inspect -f \
 *     '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' estarter-test-coturn-1)
 *   docker exec -d estarter-test-coturn-1 turnutils_peer -p 3480
 *
 *   # 1. le couple servi par /get-ice-servers, tel quel        ⇒ doit RÉUSSIR
 *   #    valide l'ordre, le HMAC et l'encodage d'un seul coup — c'est celle qui vaut
 *   docker exec estarter-test-coturn-1 turnutils_uclient -v -n 3 -y -c \
 *     -e "$COTURN_IP" -r 3480 -p 3478 -u '<username servi>' -w '<credential servi>' "$COTURN_IP"
 *
 *   # 2. COTURN_CREDENTIAL_TTL=-60, puis config:clear          ⇒ doit rendre 401
 *   # 3. l'ancien couple statique (-u maintenance -w secret)   ⇒ doit rendre 401 : la bascule
 *   #    en `--use-auth-secret` EST la rotation du secret compromis
 *   # 4. une allocation DÉJÀ ouverte survit-elle à l'expiration ? (TTL=30 + --stale-nonce=10)
 *   #    réponse binaire — elle décide de la formulation de la borne écrite dans
 *   #    `docs/modules/webrtc2/securite.md`
 */
class IceServersTest extends TestCase
{
    private const URI = '/get-ice-servers';

    private const SECRET = 'secret-de-test-qui-ne-doit-jamais-sortir';

    protected function setUp(): void
    {
        parent::setUp();

        // Le harnais reste neutre, le test déclare son état — même parti pris que
        // `ThrottleTest::setThrottle()`. Nécessaire ici : `phpunit.xml` ne définit pas `APP_URL`,
        // donc le défaut `parse_url(env('APP_URL'), PHP_URL_HOST)` rend `null` sous Testbench et
        // l'entrée TURN n'existerait jamais — les tests seraient verts en ne gardant plus rien.
        $this->setIce('turn.host', 'turn.example.test');

        // Le harnais décrit le mode CIBLE : secret posé, donc TURN REST API. Le couple statique
        // reste posé à côté pour que son abandon soit prouvé plutôt que supposé — c'est
        // exactement l'état d'une machine qui n'a pas encore nettoyé son `.env`, et
        // `un_utilisateur_authentifie_recoit_stun_et_turn` vérifie que le secret gagne.
        // Le mode statique est donc un opt-out explicite : voir
        // `le_couple_statique_reste_servi_quand_aucun_secret_n_est_pose`.
        $this->setIce('turn.static_auth_secret', self::SECRET);
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

        // Le secret de signature ne doit fuiter à personne, et sa fuite serait la pire des trois :
        // il permet de forger le credential de n'importe quel utilisateur. Sentinelle bon marché
        // plutôt que garde fort — sur ce chemin, le contrôleur rend `null` avant toute entrée
        // TURN, donc seul un contrôleur qui servirait le bloc de config à tout le monde la ferait
        // rougir. Le vrai garde du secret est dans
        // `la_charge_utile_ne_relaie_que_les_trois_cles_attendues`.
        $response->assertDontSee(self::SECRET);
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

        // Le secret est posé, donc le couple statique du `setUp()` est IGNORÉ : c'est le sens de
        // « la présence du secret commute le mode ». Sans cette paire d'assertions, un contrôleur
        // qui préférerait `username`/`password` passerait les tests de format ci-dessous en
        // servant quand même des identifiants partagés.
        $this->assertNotSame('coturn-user', $iceServers[1]['username']);
        $this->assertNotSame('coturn-pass', $iceServers[1]['credential']);
    }

    #[Test]
    public function le_username_porte_l_horodatage_d_expiration_puis_l_identifiant(): void
    {
        $user = $this->makeUser('alice');

        Carbon::setTestNow('2026-08-23 12:00:00');

        $response = $this->actingAs($user)->getJson(self::URI);

        // `<expiration epoch>:<identifiant>`, dans CET ORDRE — c'est ce que coturn attend
        // (`turnutils_uclient` porte la chaîne de format `%lu%c%s`). L'ordre inverse ne donnerait
        // pas une erreur mais `strtol("alice") == 0`, donc un credential expiré depuis 1970 :
        // refusé, sans autre symptôme que « ça ne relaie pas ».
        $this->assertSame(
            (Carbon::now()->getTimestamp() + 86400).':'.$user->id,
            $this->iceServers($response)[1]['username'],
        );
    }

    #[Test]
    public function le_credential_est_le_hmac_sha1_base64_du_username(): void
    {
        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $turn = $this->iceServers($response)[1];

        // Recalculé ici plutôt que figé en dur : une valeur figée n'aurait dit lequel des trois
        // paramètres a bougé (algorithme, encodage, chaîne signée). HMAC-SHA1 BRUT puis base64 —
        // `hash_hmac(..., false)` rendrait l'hexadécimal, que coturn base64-erait différemment.
        $this->assertSame(
            base64_encode(hash_hmac('sha1', $turn['username'], self::SECRET, true)),
            $turn['credential'],
        );
    }

    #[Test]
    public function l_expiration_est_lue_dans_la_config_et_non_en_dur(): void
    {
        $user = $this->makeUser('alice');
        $this->setIce('turn.credential_ttl', 60);

        Carbon::setTestNow('2026-08-23 12:00:00');

        $response = $this->actingAs($user)->getJson(self::URI);

        // `assertSame` exact, et non `assertGreaterThan(time(), ...)` : une assertion à fenêtre
        // resterait VERTE sur un TTL faux d'un facteur 60. C'est ce qui impose `now()` plutôt que
        // `time()` dans le contrôleur — `Carbon::setTestNow()` n'intercepte que le premier.
        $this->assertSame(
            (Carbon::now()->getTimestamp() + 60).':'.$user->id,
            $this->iceServers($response)[1]['username'],
        );
    }

    #[Test]
    public function le_ttl_du_credential_est_annonce_au_client_et_vaut_celui_du_username(): void
    {
        // La raison d'être de cette clé : sans elle, le front n'a aucun moyen de savoir QUAND
        // rafraîchir. La seule autre trace de l'expiration est l'epoch préfixant `username`, qui
        // est ABSOLU — un poste dont l'horloge est en retard programmerait le rafraîchissement
        // après l'expiration et la panne « la visio ne passe plus, un F5 la répare » subsisterait.
        $user = $this->makeUser('alice');
        $this->setIce('turn.credential_ttl', 60);

        Carbon::setTestNow('2026-08-23 12:00:00');

        $response = $this->actingAs($user)->getJson(self::URI);

        $response->assertOk();
        $this->assertSame(60, $response->json('credential_ttl'));

        // ET la même valeur que celle qui expire l'`username` : c'est ce que garantit la lecture
        // unique de la config dans `turnServer()`. Deux lectures se laisseraient désynchroniser, et
        // le client programmerait alors son rafraîchissement sur une durée qui n'est pas la sienne.
        $this->assertSame(
            (Carbon::now()->getTimestamp() + 60).':'.$user->id,
            $this->iceServers($response)[1]['username'],
        );
    }

    #[Test]
    public function aucun_ttl_n_est_annonce_en_mode_statique(): void
    {
        // Un couple longue durée ne s'expire pas : annoncer un TTL ferait programmer au client un
        // rafraîchissement inutile — une requête par TTL et par onglet, pour réécrire la même
        // configuration.
        //
        // ⚠️ Contre-épreuve des TROIS tests « aucun TTL » : retirer la clé du contrôleur ne les
        // fait PAS rougir (ils sont alors vrais pour la mauvaise raison) — c'est l'émettre
        // INCONDITIONNELLEMENT qui les rougit tous les trois, plus
        // `un_invite_recoit_stun_seul_sans_aucun_identifiant`, dont l'`assertDontSee('credential')`
        // attrape `credential_ttl` au passage. Vérifié le 2026-08-25.
        $this->setIce('turn.static_auth_secret', null);

        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $response->assertOk();
        $this->assertArrayNotHasKey('credential_ttl', $response->json());
    }

    #[Test]
    public function aucun_ttl_n_est_annonce_a_un_invite(): void
    {
        // Un invité ne reçoit aucune entrée TURN, donc rien à rafraîchir. La clé ABSENTE (et non
        // `null`) est ce qui permet au front de n'avoir qu'un seul prédicat pour les trois cas.
        $response = $this->getJson(self::URI);

        $response->assertOk();
        $this->assertArrayNotHasKey('credential_ttl', $response->json());
    }

    #[Test]
    public function aucun_ttl_n_est_annonce_quand_aucune_entree_turn_n_est_emise(): void
    {
        $this->setIce('turn.host', false);

        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $response->assertOk();
        $this->assertSame([], $this->turnEntries($response));
        $this->assertArrayNotHasKey('credential_ttl', $response->json());
    }

    #[Test]
    public function le_secret_seul_suffit_sans_couple_statique(): void
    {
        // L'état d'un déploiement propre en mode REST : plus aucune trace de `COTURN_USER` /
        // `COTURN_PASS` dans le `.env`. Le contrôleur ne doit pas exiger un couple qu'il n'utilise
        // plus — sinon nettoyer son `.env` coupe le relais, ce qui est précisément le piège que
        // la règle « une seule variable » cherche à éviter.
        $this->setIce('turn.username', null);
        $this->setIce('turn.password', null);

        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $response->assertOk();
        $this->assertCount(1, $this->turnEntries($response));
    }

    #[Test]
    public function le_couple_statique_reste_servi_quand_aucun_secret_n_est_pose(): void
    {
        // ⚠️ Ce test NE PEUT PAS être vu rouge d'abord : il épingle le comportement de D0, déjà
        // vrai. C'est un test de non-régression, et sa seule contre-épreuve honnête est de retirer
        // la branche de compatibilité du contrôleur — il rougit alors.
        //
        // Ce qu'il protège n'est pas théorique : un hôte tiers dont le coturn tourne encore en
        // `--user` ne doit pas perdre son relais sur un simple `composer update`.
        $this->setIce('turn.static_auth_secret', null);

        $response = $this->actingAs($this->makeUser('alice'))->getJson(self::URI);

        $turn = $this->iceServers($response)[1];
        $this->assertSame('coturn-user', $turn['username']);
        $this->assertSame('coturn-pass', $turn['credential']);
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
    public function sans_aucun_identifiant_coturn_aucune_entree_turn_n_est_emise(): void
    {
        // Le déploiement sans relais. Surtout pas une entrée aux identifiants nuls : l'agent ICE
        // l'interrogerait et attendrait son échec d'authentification avant de conclure.
        //
        // Les TROIS, et c'est le point : depuis le niveau 2, vider le seul `password` ne suffit
        // plus — le secret prendrait le relais et l'entrée TURN existerait quand même.
        $this->setIce('turn.static_auth_secret', null);
        $this->setIce('turn.username', null);
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
        // Le secret de signature vit dans CE bloc de config depuis le niveau 2. Ce test est ce qui
        // arrête un `return response()->json(config('socializer.signaling.ice'))` — écrit
        // distraitement, il publierait à tout visiteur de quoi forger le credential de n'importe
        // quel utilisateur. Valeur locale plutôt que celle du `setUp()` : elle nomme l'enjeu.
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
