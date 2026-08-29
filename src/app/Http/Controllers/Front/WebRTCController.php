<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * Configuration ICE servie au navigateur, et attestation d'identité des peerId.
 *
 * Deux mécanismes, une seule parenté : ce sont les deux endroits où le serveur SIGNE quelque
 * chose pour le compte d'un utilisateur, et les deux seules routes WebRTC qui ne relaient rien
 * vers un tiers. Rien d'autre ne les couple — le TTL de l'un n'a aucun rapport avec celui de
 * l'autre (un credential TURN authentifie un RELAIS pour 24 h, une attestation authentifie une
 * PERSONNE pour 5 minutes).
 *
 * ── LA CONFIGURATION ICE ──────────────────────────────────────────────────────────────────────
 *
 * Elle vivait dans le bundle : `VITE_COTURN_USERNAME` / `VITE_COTURN_CREDENTIAL` étaient inlinés
 * par Vite au build, donc lisibles par quiconque ouvrait le JS. Ces identifiants sont ceux du
 * conteneur coturn lui-même — relais ouvert. La configuration se calcule désormais ici, à chaque
 * requête.
 *
 * PUBLIQUE ET TOUJOURS 200. `System/Notifications.vue` monte le contexte permanent `data-app` dès
 * le chargement de la coquille SPA, laquelle est publique (`estarter/routes.public.php` ;
 * `config('estarter.vue_router_auth_protect')` n'est définie dans aucune config livrée, donc le
 * `auth` conditionnel d'`EstarterSpaController` n'est jamais posé). Un invité appelle donc cette
 * route. Un 401 y déclencherait le `document.location.reload()` d'`AjaxService.load`
 * (estarter, `services/AjaxService.js`) : boucle de rechargement sur la page de login.
 *
 * D'où la garde : elle est ICI, dans `Auth::check()`, et non dans la pile de middlewares.
 * L'invité reçoit STUN seul, sans un seul identifiant.
 *
 * ⚠️ LISTE BLANCHE, JAMAIS LISTE NOIRE — la doctrine de `Resources/PresenceUser.php` s'applique
 * telle quelle, et c'est ici qu'elle compte le plus. Ne JAMAIS rendre
 * `config('socializer.signaling.ice')` tel quel : ce bloc porte le secret de signature HMAC, et un
 * splat ne fuiterait pas un mot de passe de relais mais **de quoi forger le credential de
 * n'importe quel utilisateur**. Trois clés sortent d'ici, nommées une par une.
 * `IceServersTest::la_charge_utile_ne_relaie_que_les_trois_cles_attendues` l'épingle.
 *
 * ⚠️ Les défauts sont répétés en 2ᵉ argument de `config()` pour la raison écrite dans le docblock
 * de `ServiceProvider::registerSignalingRateLimiters()` : `mergeConfigFrom` est un `array_merge`
 * PEU PROFOND, un hôte dont le `config/socializer.php` publié porte un `signaling` sans `ice`
 * écraserait toute la section. Absence d'hôte ou d'identifiant ⇒ STUN seul, jamais un fallback
 * en dur. La même règle vaut mot pour mot pour la section `attestation`.
 *
 * ── L'ATTESTATION DE PEERID ───────────────────────────────────────────────────────────────────
 *
 * PRIVÉE, elle : `attestPeerId` et `verifyPeerAttestation` vivent dans `routes.private.php`, donc
 * derrière `auth`. C'est la différence de nature avec la route ICE — un invité n'a pas d'identité
 * à faire attester, et il n'y a donc aucun `Auth::check()` à écrire dans ces deux méthodes.
 *
 * Ce qu'elles ferment : le chemin (a) de `_isAuthorizedIncomingPeer` (appartenance à la room)
 * admettait un pair sur la seule foi de `metadata.from`, un champ que l'émetteur choisit. Un membre
 * ouvrant un SECOND `new Peer()` obtenait un UUID que rien ne mappait, nommait un autre membre, et
 * parlait sous son identité. Le récepteur ne pouvait pas trancher : le cas nominal de la présence
 * et l'usurpation ont la MÊME signature locale (slug déclaré membre, peerId inconnu).
 *
 * Le serveur signe donc `{peerId, slug, exp}` — **le slug étant celui d'`Auth::user()`, jamais un
 * champ du corps** ; c'est tout le mécanisme, et c'est ce qui le rend infalsifiable. Un attaquant
 * n'obtient jamais qu'une attestation à SON nom : présentée sous un `from` étranger, elle
 * contredit, donc elle refuse.
 *
 * ⚠️ CE QUE L'ATTESTATION NE FERME PAS, et qui doit rester écrit : le REJEU. Qui détient
 * l'attestation d'un pair parti et reprend son UUID sur le serveur PeerJS (possible passé
 * `alive_timeout`, 60 s) la rejoue avec succès jusqu'à son échéance. C'est `attestation.ttl` qui
 * borne cette fenêtre, et rien d'autre — la fermer demande que le serveur PeerJS valide lui-même
 * l'inscription d'un id, ce qui est hors de ce paquet.
 */
class WebRTCController extends Controller
{
    /**
     * Version du format d'attestation, embarquée dans la charge signée.
     *
     * Une CONSTANTE et non une clé de config : c'est un contrat entre le signataire et le
     * vérificateur, pas un réglage — même arbitrage que les listes blanches de types de connexion
     * (cf. `docs/architecture/signalisation.md`, « un plafond est un réglage, une liste blanche est
     * un contrat »). Elle existe pour qu'un changement de format futur puisse REFUSER les anciennes
     * attestations au lieu de les mal lire.
     */
    private const ATTESTATION_VERSION = 1;

    /**
     * Étiquette de dérivation du secret de repli.
     *
     * Elle est ce qui empêche une signature d'attestation de valoir ailleurs : la clé dérivée
     * d'`APP_KEY` sous cette étiquette n'est pas `APP_KEY`, et un autre domaine qui dériverait sous
     * la sienne n'obtiendrait pas la même.
     */
    private const ATTESTATION_KEY_LABEL = 'socializer:peer-attestation:v1';

    /**
     * Borne de longueur de l'attestation acceptée en vérification.
     *
     * Une attestation du format courant en fait ~210 : charge base64url (~165) + `.` + signature
     * HMAC-SHA256 en base64url (43). 512 laisse la marge d'un champ de plus sans autoriser qu'un
     * corps arbitraire traverse `json_decode`.
     *
     * ⚠️ Sa jumelle côté JS est `MAX_ATTESTATION_LENGTH` (`webrtc2.config.js`), et rien dans le
     * build ne les rapproche : le contrôle négatif est un test, comme pour les listes de types.
     */
    private const MAX_ATTESTATION_LENGTH = 512;

    /**
     * @return JsonResponse la forme attendue par `Composables/utils/fetchIceServers.js`
     */
    public function getIceServers(Request $request): JsonResponse
    {
        $iceServers = [];
        $ttl = null;

        foreach (config('socializer.signaling.ice.stun_urls', ['stun:stun.l.google.com:19302']) as $url) {
            $iceServers[] = ['urls' => $url];
        }

        if ($turn = $this->turnServer()) {
            $iceServers[] = $turn['server'];
            $ttl = $turn['ttl'];
        }

        $payload = ['iceServers' => $iceServers];

        // `credential_ttl` — combien de SECONDES le credential ci-dessus reste valide, et le signal
        // qui autorise le client à programmer son rafraîchissement
        // (`_scheduleIceRefresh` dans `usePeerTransport`).
        //
        // ⚠️ À LA RACINE, jamais dans l'entrée TURN : celle-ci est une liste blanche de trois clés
        // (cf. le docblock de classe), et
        // `IceServersTest::la_charge_utile_ne_relaie_que_les_trois_cles_attendues` doit rester
        // verte sans modification — c'est le contrôle d'inertie de cet ajout.
        //
        // Une DURÉE et non un horodatage d'expiration : le client n'a alors aucune horloge à
        // partager avec le serveur. Un poste dont l'heure est en retard de deux heures
        // programmerait un rafraîchissement deux heures après l'expiration, ce qui reproduirait
        // exactement la panne qu'on ferme.
        //
        // ABSENTE plutôt que `null` quand il n'y a rien à rafraîchir — invité, mode statique, hôte
        // TURN non configuré : côté front, `typeof payload.credential_ttl === 'number'` est alors
        // le seul prédicat, et il couvre les trois cas d'un coup.
        if ($ttl !== null) {
            $payload['credential_ttl'] = $ttl;
        }

        // `no-store` explicite : une MÊME URL rend deux charges utiles selon la session, et celle
        // de l'authentifié porte un identifiant. Symfony pose déjà `no-cache, private` par défaut,
        // mais un reverse-proxy se configure, et ce défaut-là ne se relit pas.
        return response()->json($payload, 200)
            ->header('Cache-Control', 'no-store, private');
    }

    /**
     * L'entrée TURN, ou `null` — jamais une entrée à moitié remplie.
     *
     * DEUX MODES, et c'est la PRÉSENCE du secret qui commute, jamais une clé de mode :
     *
     *  - `static_auth_secret` posé ⇒ TURN REST API. coturn tourne en `--use-auth-secret
     *    --static-auth-secret <même valeur>`, le credential est signé ici et expire seul.
     *  - secret vide ⇒ le couple statique d'origine, inchangé. C'est un chemin de
     *    COMPATIBILITÉ, et il n'est pas décoratif : un hôte dont le coturn tourne encore en
     *    `--user` ne doit pas perdre son relais sur un `composer update`. Un refus sec ici
     *    serait une panne muette offerte à toute installation existante.
     *
     * Secret ET couple présents : le secret gagne, sans avertissement. Ce n'est pas une erreur
     * mais l'état normal d'une machine qui n'a pas encore nettoyé son `.env` — et un couple
     * statique servi à un coturn passé en `--use-auth-secret` serait refusé de toute façon.
     *
     * `Auth::check()` reste la PREMIÈRE instruction et la lecture du secret vient après, de sorte
     * qu'une requête d'invité ne touche jamais le secret — utile le jour où quelqu'un ajoute un
     * `Log::debug()` en tête de méthode.
     *
     * ⚠️ Mais AUCUN TEST N'ÉPINGLE CET ORDRE, et c'est une limite, pas un oubli : une fuite par
     * journal n'est pas observable dans un corps de réponse. Déplacer le garde plus bas laisse la
     * suite entière verte — vérifié. Ce que les tests épinglent est plus étroit : que le secret
     * n'atteigne jamais la réponse. Sur le chemin authentifié par
     * `la_charge_utile_ne_relaie_que_les_trois_cles_attendues` (contre-épreuve : un splat de
     * `config('...turn')` la fait rougir en montrant le secret dans le corps), sur le chemin
     * invité par l'`assertDontSee` du premier test. L'ordre, lui, est une convention à tenir à la
     * relecture.
     *
     * Cast en `string` plutôt que `blank()` : `blank(false)` rend **false**,
     * `config(...turn.host)` peut valoir `false` si `parse_url()` a échoué, et un
     * `COTURN_STATIC_AUTH_SECRET=false` serait rendu en BOOLÉEN par `env()`. `(string) false` et
     * `(string) null` valent tous deux `''`, ce qui couvre ces absences d'un coup.
     *
     * REND LA PAIRE (entrée, durée de vie) et non l'entrée seule. Le TTL n'a de sens que dans la
     * branche « secret posé », et c'est ici — et nulle part ailleurs — que le mode est tranché : le
     * recalculer dans `getIceServers` demanderait d'y recopier le prédicat entier (`Auth::check()`,
     * hôte non vide, secret non vide), soit deux copies d'une même règle, qui divergeraient. Le
     * `ttl` est donc `null` sur le chemin de compatibilité : un couple longue durée ne se
     * rafraîchit pas, et le client ne doit pas programmer un rafraîchissement pour lui.
     *
     * @return array{server: array{urls: string, username: string, credential: string}, ttl: int|null}|null
     */
    private function turnServer(): ?array
    {
        if (! Auth::check()) {
            return null;
        }

        $host = (string) config('socializer.signaling.ice.turn.host');

        if ($host === '') {
            return null;
        }

        // Une seule URL, sans `?transport=`, comme le bundle l'écrivait. Ajouter la variante TCP
        // serait une vraie amélioration — et un changement du chemin ICE, à mesurer à part.
        $urls = 'turn:'.$host.':'.(int) config('socializer.signaling.ice.turn.port', 3478);

        $secret = (string) config('socializer.signaling.ice.turn.static_auth_secret');

        if ($secret !== '') {
            // `<expiration epoch>:<identifiant>`, dans CET ORDRE. Vérifié contre le binaire en
            // place et non contre un souvenir : `turnutils_uclient` porte la chaîne de format
            // `%lu%c%s`, soit <horodatage><séparateur><utilisateur>, le séparateur étant
            // `--rest-api-separator` (`:` par défaut). L'ordre inverse ne lèverait rien — il
            // donnerait `strtol("<identifiant>") == 0`, donc un credential expiré depuis 1970,
            // refusé sans autre symptôme que « ça ne relaie pas ». Le HMAC porte sur la chaîne
            // ENTIÈRE, séparateur et identifiant compris.
            //
            // `now()` et non `time()` : `Carbon::setTestNow()` n'intercepte que le premier, ce qui
            // rend l'expiration assertable AU SECONDE PRÈS. Un test à fenêtre
            // (`assertGreaterThan(time(), ...)`) resterait vert sur un TTL faux d'un facteur 60.
            // Lu UNE fois et rendu à l'appelant : ce qui expire l'`username` ci-dessous et ce que
            // le client reçoit dans `credential_ttl` sont la même valeur par construction. Deux
            // lectures se laisseraient désynchroniser par un `config()->set` entre les deux.
            $ttl = (int) config('socializer.signaling.ice.turn.credential_ttl', 86400);

            $expiresAt = now()->addSeconds($ttl)->getTimestamp();

            // `Auth::id()` et non le slug : c'est ce que coturn journalise et ce sur quoi portent
            // `--user-quota` / `--total-quota`, donc la seule chose qui rattache une allocation à
            // quelqu'un. Un identifiant contenant le séparateur ne casse rien (coturn coupe au
            // premier `:` et le HMAC couvre la chaîne entière) ; en revanche un hôte dont
            // `getAuthIdentifierName()` serait `email` ferait entrer des adresses dans les
            // journaux du conteneur coturn — le correctif, ce jour-là, est une liste blanche de
            // caractères, comme partout ici.
            $username = $expiresAt.':'.Auth::id();

            return [
                'server' => [
                    'urls' => $urls,
                    'username' => $username,
                    // HMAC-SHA1 BRUT (4ᵉ argument `true`) puis base64. `hash_hmac(..., false)`
                    // rendrait l'hexadécimal, que coturn base64-erait différemment : credential
                    // refusé, sans autre symptôme que « la visio ne relaie pas ».
                    'credential' => base64_encode(hash_hmac('sha1', $username, $secret, true)),
                ],
                'ttl' => $ttl,
            ];
        }

        $username = (string) config('socializer.signaling.ice.turn.username');
        $password = (string) config('socializer.signaling.ice.turn.password');

        if ($username === '' || $password === '') {
            return null;
        }

        return [
            'server' => [
                'urls' => $urls,
                'username' => $username,
                'credential' => $password,
            ],
            // Aucune expiration à annoncer : ce couple est valide tant que coturn le porte dans son
            // `--user`. Le client ne programme donc aucun rafraîchissement, et l'absence de la clé
            // dans la réponse est ce qui le lui dit.
            'ttl' => null,
        ];
    }

    /**
     * Signe le couple (peerId, identité authentifiée) présenté par le porteur.
     *
     * `POST /attest-peer-id`, appelée UNE FOIS par cycle de vie du `Peer` puis une fois par
     * échéance de TTL (`_scheduleAttestationRefresh` dans `usePeerTransport`). Elle ne relaie rien
     * vers un tiers : aucun `Broadcast::...->sendNow()`, donc aucune victime à protéger d'une
     * cadence — le `throttle` qu'elle porte est celui du groupe, pas une borne dimensionnée pour
     * elle.
     *
     * @return JsonResponse la forme attendue par `Composables/utils/fetchPeerAttestation.js`
     */
    public function attestPeerId(Request $request): JsonResponse
    {
        // ⚠️ EN PREMIER et hors de tout `try`, comme les cinq méthodes de signalisation
        // d'`UserController` : `ValidationException` étend `\Exception`, et un `validate()` posé
        // sous un `catch` fourre-tout repartirait en 500.
        $data = $request->validate([
            // Même règle qu'à l'autre bout de la chaîne (`UserController::responseToPeerId`) : les
            // peerId sont des UUID générés par le serveur PeerJS. Un format libre ici ferait signer
            // n'importe quelle chaîne, et l'attestation servirait alors à authentifier autre chose
            // qu'un pair.
            'peerId' => ['required', 'uuid'],
        ]);

        $secret = $this->attestationSecret();

        // Aucun secret disponible — ni clé dédiée, ni `APP_KEY`. Le mécanisme est INACTIF et il le
        // dit, plutôt que de signer sur une clé vide : une telle signature serait reproductible par
        // n'importe qui, et le vérificateur la validerait pour tout le monde.
        //
        // ⚠️ `enforce` est forcé à FAUX sur ce chemin, quelle que soit la config. Servir `true`
        // sans pouvoir délivrer d'attestation ferait refuser des pairs parfaitement légitimes en se
        // réclamant d'un contrôle qui n'existe pas — un fail-closed sur une panne de configuration,
        // c'est-à-dire la panne la plus difficile à diagnostiquer depuis un navigateur.
        if ($secret === '') {
            return $this->attestationResponse(null, null, false);
        }

        $ttl = (int) config('socializer.signaling.attestation.ttl', 300);

        // `now()` et non `time()`, pour la raison écrite au credential TURN : `Carbon::setTestNow()`
        // n'intercepte que le premier, ce qui rend l'expiration assertable À LA SECONDE PRÈS. Lu
        // UNE fois et servi tel quel au client : ce qui expire la charge et ce que le client reçoit
        // dans `attestation_ttl` sont la même valeur par construction.
        $expiresAt = now()->addSeconds($ttl)->getTimestamp();

        $payload = $this->base64UrlEncode((string) json_encode([
            'v' => self::ATTESTATION_VERSION,
            'p' => $data['peerId'],
            // ⚠️ `Auth::user()->slug`, JAMAIS un champ du corps. Invariant 1 de la signalisation —
            // et ici ce n'est pas une précaution parmi d'autres, c'est le mécanisme ENTIER : un
            // attaquant n'obtient jamais qu'une attestation à SON nom, qui contredit dès qu'il la
            // présente sous le `from` d'un autre.
            's' => Auth::user()->slug,
            'e' => $expiresAt,
        ]));

        return $this->attestationResponse(
            $payload.'.'.$this->base64UrlEncode(hash_hmac('sha256', $payload, $secret, true)),
            $ttl,
            (bool) config('socializer.signaling.attestation.enforce', false)
        );
    }

    /**
     * À qui appartient le peerId que cette attestation couvre ?
     *
     * `POST /verify-peer-attestation`, appelée par le RÉCEPTEUR d'une connexion entrante, une fois
     * par peerId inconnu (le verdict est mis en cache côté client jusqu'à l'échéance).
     *
     * ⚠️ TOUJOURS 200, y compris sur une attestation invalide. Un 4xx serait faux à deux titres :
     * une attestation refusée n'est pas une erreur de transport, et `AjaxService.load` d'estarter
     * RECHARGE la page sur 401/419 — un refus deviendrait une boucle de rechargement. Le verdict
     * est donc dans le corps : `slug` non nul, ou `null`.
     *
     * ⚠️ Le `null` ne distingue PAS signature invalide, expiration, mauvaise version et peerId
     * discordant. Même doctrine que le 403 uniforme du garde de relation : nommer la cause offrirait
     * un oracle à qui cherche à forger.
     *
     * Aucun garde de relation ici, et c'est délibéré : cette route ne relaie rien et ne révèle que
     * l'identité inscrite dans une attestation que l'appelant détient DÉJÀ — il l'a reçue par la
     * connexion entrante qu'il cherche à qualifier. Y poser `mayReach` bornerait la vérification à
     * un sous-ensemble des pairs légitimement joignables, donc ferait refuser des connexions
     * valides.
     */
    public function verifyPeerAttestation(Request $request): JsonResponse
    {
        $data = $request->validate([
            'attestation' => ['required', 'string', 'max:'.self::MAX_ATTESTATION_LENGTH],
            // Le peerId RÉEL de la connexion entrante (`conn.peer`), pas celui que l'attestation
            // annonce : c'est leur confrontation qui fait tout le travail (cf. `attestedSlug`).
            'peerId' => ['required', 'uuid'],
        ]);

        return response()->json(
            ['slug' => $this->attestedSlug($data['attestation'], $data['peerId'])],
            200
        )->header('Cache-Control', 'no-store, private');
    }

    /**
     * La réponse d'attestation — LISTE BLANCHE de trois clés, jamais un splat.
     *
     * La doctrine de `turnServer()` s'applique telle quelle et pour la même raison : la section
     * `signaling.attestation` porte le secret de signature, et ce qui fuiterait ici ne serait pas un
     * mot de passe de relais mais **de quoi forger l'identité de n'importe quel utilisateur**.
     *
     * `attestation_ttl` est ABSENTE plutôt que nulle quand il n'y a rien à rafraîchir — exactement
     * comme `credential_ttl` : côté client, `typeof payload.attestation_ttl === 'number'` est alors
     * le seul prédicat à écrire.
     *
     * `enforce` sort d'ici et non d'une constante compilée : c'est la politique du SERVEUR. Un
     * `VITE_*` la figerait à la construction de l'image, et la promettrait éditable dans un `.env`
     * qu'elle ne lirait jamais.
     */
    private function attestationResponse(?string $attestation, ?int $ttl, bool $enforce): JsonResponse
    {
        $payload = [
            'attestation' => $attestation,
            'enforce' => $enforce,
        ];

        if ($ttl !== null) {
            $payload['attestation_ttl'] = $ttl;
        }

        // `no-store` explicite, comme `getIceServers` : une MÊME URL rend une charge utile
        // différente par session, et celle-ci porte une identité signée.
        return response()->json($payload, 200)
            ->header('Cache-Control', 'no-store, private');
    }

    /**
     * Le slug attesté pour ce peerId, ou `null` — jamais une raison.
     *
     * Cinq contrôles, et aucun n'est redondant :
     *  1. la signature, en `hash_equals` (cas d'école de l'attaque temporelle, et gratuit ici) ;
     *  2. la charge est du JSON exploitable ;
     *  3. la version du format — c'est ce qui permettra à un format futur de REFUSER les anciennes
     *     attestations plutôt que de les mal lire ;
     *  4. **le peerId signé est celui de la connexion présentée**. Sans lui, l'attestation d'un pair
     *     suffirait à en admettre un autre : elle prouverait « ce couple a été signé », jamais
     *     « c'est CE pair-ci » ;
     *  5. l'échéance, seule borne du rejeu (cf. le docblock de classe).
     */
    private function attestedSlug(string $attestation, string $peerId): ?string
    {
        $secret = $this->attestationSecret();

        if ($secret === '') {
            return null;
        }

        $parts = explode('.', $attestation);

        if (count($parts) !== 2) {
            return null;
        }

        [$payload, $signature] = $parts;

        if (! hash_equals($this->base64UrlEncode(hash_hmac('sha256', $payload, $secret, true)), $signature)) {
            return null;
        }

        $claims = json_decode($this->base64UrlDecode($payload), true);

        if (! is_array($claims) || ($claims['v'] ?? null) !== self::ATTESTATION_VERSION) {
            return null;
        }

        // Comparaison INSENSIBLE À LA CASSE : un UUID l'est par sa RFC, les deux extrémités le
        // recopient de mains différentes (le signataire depuis le corps du POST, le vérificateur
        // depuis `conn.peer`), et un refus sur une casse divergente serait indistinguable d'une
        // usurpation — c'est-à-dire le pire mode de panne possible sur ce chemin.
        if (! is_string($claims['p'] ?? null) || strcasecmp($claims['p'], $peerId) !== 0) {
            return null;
        }

        if (! is_int($claims['e'] ?? null) || $claims['e'] < now()->getTimestamp()) {
            return null;
        }

        return is_string($claims['s'] ?? null) && $claims['s'] !== ''
            ? $claims['s']
            : null;
    }

    /**
     * Le secret de signature, ou `''` quand le mécanisme n'a pas de quoi fonctionner.
     *
     * Repli sur une clé DÉRIVÉE d'`APP_KEY`, jamais `APP_KEY` elle-même : la dérivation par
     * étiquette de domaine empêche qu'une signature d'attestation vaille ailleurs, et le mécanisme
     * marche alors sans exiger une variable de déploiement neuve d'une installation existante.
     *
     * Cast en `string` plutôt que `blank()`, pour la raison écrite à `turnServer()` :
     * `blank(false)` rend **false**, et un `SOCIALIZER_PEER_ATTESTATION_SECRET=false` serait rendu
     * en BOOLÉEN par `env()`. `(string) false` et `(string) null` valent tous deux `''`.
     */
    private function attestationSecret(): string
    {
        $secret = (string) config('socializer.signaling.attestation.secret');

        if ($secret !== '') {
            return $secret;
        }

        $appKey = (string) config('app.key');

        if ($appKey === '') {
            return '';
        }

        return hash_hmac('sha256', self::ATTESTATION_KEY_LABEL, $appKey, true);
    }

    /**
     * Base64 « URL-safe », sans remplissage.
     *
     * L'attestation voyage dans la `metadata` d'une connexion PeerJS (donc du JSON) puis dans un
     * corps de requête : le `+`, le `/` et le `=` du base64 standard y survivent, mais ils ne
     * survivent pas à un journal, à une URL de débogage ou à un copier-coller. Le format est le même
     * que celui d'un JWT, ce qui rend une attestation lisible à l'œil avec les outils habituels.
     */
    private function base64UrlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $encoded): string
    {
        return (string) base64_decode(strtr($encoded, '-_', '+/'), true);
    }
}
