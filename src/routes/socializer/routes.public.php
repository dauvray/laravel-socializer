<?php

use Illuminate\Support\Facades\Route;

Route::post('/get-comments',
    config('socializer.controllers_front.comment').'@getComments')
    ->name('comments.get');

Route::post('/get-sub-comments',
    config('socializer.controllers_front.comment').'@getSubComments')
    ->name('subcomments.get');

Route::post('/get-total-comments',
    config('socializer.controllers_front.comment').'@getTotalComments')
    ->name('comments.total');

/*----------------------------------------------------------------------
| WebRTC — configuration ICE
|----------------------------------------------------------------------*/

/*
| Publique et toujours 200, par nécessité et non par facilité : la coquille SPA est publique et
| `Notifications.vue` monte le contexte `data-app` avant tout login. Le raisonnement complet est
| dans le docblock de `WebRTCController`. La garde est dans le contrôleur, pas ici.
|
| GET et non POST, à l'exemple des utilitaires publics d'estarter (`/get-user-data`,
| `/check-user`, `/get-country-list`) : la route ne lit rien du corps, et `ValidateCsrfToken` ne
| s'applique pas aux verbes de lecture. Un POST depuis une page de login restée ouverte au-delà de
| la durée de session partirait avec un jeton périmé → 419 → le MÊME `document.location.reload()`
| d'`AjaxService` que le 401 qu'on évite.
|
| ⚠️ PAS DE `throttle`, et c'est une décision, pas un oubli. Le docblock de
| `ServiceProvider::registerSignalingRateLimiters()` pose que la clé d'un limiteur est l'identité
| de l'ÉMETTEUR, jamais l'IP — or une route ouverte aux invités n'a pas d'émetteur, et la clé IP
| casserait tout un site derrière un NAT unique. Les deux buckets existants ne sont donc PAS
| recopiables ici : `socializer-signaling` et `socializer-call-invite` composent leur clé sur
| `$request->user()?->getAuthIdentifier()`, `null` pour un invité — tous les invités d'Internet
| partageraient une clé unique. Les deux autres raisons : la réponse ne coûte qu'une lecture de
| config et un `hash_hmac` (aucune requête, aucun broadcast — rien à voir avec le `sendNow()` vers
| une victime que les 5 routes de signalisation déclenchent) ; et le mode de panne d'un faux 429
| est la perte silencieuse du relais TURN, c'est-à-dire « l'appel ne passe pas », sans message.
|
| ⚠️ L'ARGUMENT QUI TENAIT ICI EST TOMBÉ DEUX FOIS, et la conclusion tient toujours — mais elle
| tient de moins en moins loin. On lisait d'abord : « le secret servi est STATIQUE, donc une seule
| requête suffit à l'obtenir ». Le credential est devenu éphémère et signé. On lisait ensuite :
| « avec un TTL de 24 h, une seule requête suffit ENCORE, car rien ne la rejoue ». Depuis le
| 25/08/2026, le client REJOUE : `_scheduleIceRefresh` (usePeerTransport) rafraîchit le credential
| avant son échéance.
|
| Ce qui tient encore : la CADENCE. Un onglet émet une requête à l'ouverture, puis une par TTL —
| soit deux par jour au défaut de 24 h — et les reprises sur échec sont bornées par
| `ICE_REFRESH_MAX_RETRIES`, précisément pour que « re-demandé » ne devienne pas « en boucle ».
| Un plafond n'aurait d'objet que si le credential était COURT et re-demandé.
| CONDITION DE RÉOUVERTURE, explicite et désormais à un seul cran : si `turn.credential_ttl`
| descend à l'échelle de l'heure, la question du `throttle` se rouvre. La forme sera alors un
| bucket dédié rendant `Limit::none()` pour l'invité, jamais une clé IP.
|
| ⚠️ L'appelant DOIT envoyer `X-Requested-With: XMLHttpRequest` — c'est-à-dire passer par
| `AjaxService.load` d'estarter, qui le pose. Sans cet en-tête, une session en mode restreint
| (formdesigner, middleware `restrictedMode` du groupe `public`) tombe dans le `abort(403)` final
| de `Innovation\formdesigner\...\Restricted::handle`. Échappatoire côté hôte si l'appel doit un
| jour s'en passer : inscrire `webrtc.ice.get` dans
| `config('formdesigner.restricted_allowed_routes')` — c'est ce qu'estarter a dû faire pour
| `user.data`, en dur dans le middleware.
*/

Route::get('/get-ice-servers',
    config('socializer.controllers_front.webrtc').'@getIceServers')
    ->name('webrtc.ice.get');
