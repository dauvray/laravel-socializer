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
 * `config('socializer.signaling.ice')` tel quel : le niveau 2 posera un secret HMAC dans ce même
 * bloc, et un splat le publierait à tout visiteur. Trois clés sortent d'ici, nommées une par une.
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

        foreach (config('socializer.signaling.ice.stun_urls', ['stun:stun.l.google.com:19302']) as $url) {
            $iceServers[] = ['urls' => $url];
        }

        if ($turn = $this->turnServer()) {
            $iceServers[] = $turn;
        }

        // `no-store` explicite : une MÊME URL rend deux charges utiles selon la session, et celle
        // de l'authentifié porte un identifiant. Symfony pose déjà `no-cache, private` par défaut,
        // mais un reverse-proxy se configure, et ce défaut-là ne se relit pas.
        return response()->json(['iceServers' => $iceServers], 200)
            ->header('Cache-Control', 'no-store, private');
    }

    /**
     * L'entrée TURN, ou `null` — jamais une entrée à moitié remplie.
     *
     * Cast en `string` plutôt que `blank()` : `blank(false)` rend **false**, et
     * `config(...turn.host)` peut valoir `false` si `parse_url()` a échoué. `(string) false` et
     * `(string) null` valent tous deux `''`, ce qui couvre les trois absences d'un coup.
     *
     * @return array{urls: string, username: string, credential: string}|null
     */
    private function turnServer(): ?array
    {
        if (! Auth::check()) {
            return null;
        }

        $host = (string) config('socializer.signaling.ice.turn.host');
        $username = (string) config('socializer.signaling.ice.turn.username');
        $password = (string) config('socializer.signaling.ice.turn.password');

        if ($host === '' || $username === '' || $password === '') {
            return null;
        }

        return [
            // Une seule URL, sans `?transport=`, comme le bundle l'écrivait. Ajouter la variante
            // TCP serait une vraie amélioration — et un changement du chemin ICE, à mesurer à
            // part : ce chantier ne déplace que le secret.
            'urls' => 'turn:'.$host.':'.(int) config('socializer.signaling.ice.turn.port', 3478),
            'username' => $username,
            'credential' => $password,
        ];
    }
}
