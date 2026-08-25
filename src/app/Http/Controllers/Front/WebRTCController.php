<?php

namespace Dauvray\Socializer\app\Http\Controllers\Front;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * Configuration ICE servie au navigateur — la seule raison d'être de ce contrôleur.
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
 * en dur.
 */
class WebRTCController extends Controller
{
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
}
