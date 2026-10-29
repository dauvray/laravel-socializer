# laravel-socializer

> **Ce fichier couvre l'installation et la configuration.**
> Architecture, conventions et documentation des modules : [`docs/INDEX.md`](docs/INDEX.md).
> Chantiers en cours : [`work/README.md`](work/README.md).

## Requirements

This package needs Redis

    // php-ext
    pecl install redis

    // server
    sudo dnf install redis
    sudo apt install php-redis
    sudo systemctl enable redis
    sudo systemctl start redis
    sudo systemctl restart php-fpm

## Installation

    composer config repositories.dauvray/laravel-socializer vcs https://github.com/dauvray/laravel-socializer.git
    composer require dauvray/laravel-socializer:dev-master


Add to config/database.php

    'connections' => [
        'nebula' => [
            'driver' => 'nebula',
            'host' => env('DB_HOST_NEBULA', '127.0.0.1'),
            'port' => env('DB_PORT_NEBULA', '9669'),
            'username' => env('DB_USERNAME_NEBULA', 'root'),
            'password' => env('DB_PASSWORD_NEBULA', 'nebula'),
            'space' => env('DB_GRAPH_SPACE', 'infrastructure'),
            'partition' => env('DB_GRAPH_PARTITION', 5),
            'replica_factor' => env('DB_GRAPH_REPLICA_FACTOR', 3),
            'options' => [],
        ],
    ]

Add Commentable trait to model who can be commented e.g : /app/Article.php
And change config/eblogger

    <?php

        namespace App\Models;

        use Dauvray\Eblogger\app\Models\Article as EbloggerArticle;
        use Dauvray\Socializer\app\Helpers\ModelTraits\Commentable;

        class Article extends EbloggerArticle
        {
            use Commentable;
        }


Add SocializerUser trait to /app/user.php

    use Dauvray\Socializer\app\Helpers\ModelTraits\Socializable;
     
     class User extends EstarterUser
     {
         use Socializable;   <-- here
     }

Add overwrite method in /app/User.php

    public function getConnectedAttribute()
    {
        if ($this->is_bot === 0) {
            return parent::getConnectedAttribute();
        }
        return 1;
    }

Overwrites views with comments components on blades

    <div class="eb-comments">
        @include('socializer::widgets.comments')
    </div>

Add SocializerHelperTrait to all needed CRUD  

    use Dauvray\Socializer\app\Helpers\ControllerTraits\SocializerHelperTrait;

    class ArticleCrudController extends CrudController
    {
        use SocializerHelperTrait;

        public function setFields()
        {
            // ... 
            $this->socializerFields();
        }
    }

Add to vite.config.js

    import react from '@vitejs/plugin-react'

    define: {
        'process.env': {}, // pour React
    },
    plugins: [
    ....
        react(),
    ....
    ],
    vue({
    template: {
    ....
        compilerOptions: {
            isCustomElement: (tag) => tag === 'excalidraw-element'
        }
    ....    
    },
}),
     alias: {
    ...
        'react': "react",
        "react-dom": "react-dom",
    ...

     }

Add to bootstrap/app.php ( n8n )

    ->withMiddleware(function (Middleware $middleware) {
        $middleware->validateCsrfTokens(except: [
            '/bot-response-answer',
        ]);
    })


Build the component
     
    php artisan socializer:build
    npm run dev

Register the components — /resources/js/vue.js (Vue 3 + Pinia)

Le package expose des composants Vue 3 via l'alias `~socializer`. Les stores sont des
stores **Pinia** auto-enregistrés par `defineStore` : il n'y a rien à brancher côté store,
il suffit que `createPinia()` soit installé sur l'app.

    import { createApp } from 'vue/dist/vue.esm-bundler'
    import { createPinia } from 'pinia'

    window.estarterApp = createApp()
    window.estarterApp.use(createPinia()).use(router)

    // socializer
    import SeverWidget from '~socializer/components/System/Server.vue'
    import CommentWidget from '~socializer/components/Comment/Comments.vue'

    window.estarterApp
        .component('server-widget', SeverWidget)
        .component('socializer-comments', CommentWidget)

Add somewhere in the template

`System/Notifications.vue` doit être **monté en permanence** : c'est lui qui traduit les
événements Reverb en signaux WebRTC2 et qui porte le contexte `data-app`. Sans lui, aucune
signalisation n'arrive.

    <socializer-notifications style="position:absolute;top:-2000px;"></socializer-notifications>

## Configuration

Add to .env

    MIX_FORMDESIGNER_CREATE_ROOM_ID=__ID__
    MIX_FORMDESIGNER_UPDATE_ROOM_ID=__ID__


Add to resources/js/bootstrap.js

    import './echo.js';

## Relais TURN — les identifiants servis au navigateur

Le navigateur ne reçoit **jamais** d'identifiant compilé dans le bundle : il les demande à
`GET /get-ice-servers` (route publique, toujours 200 — STUN seul pour un invité, STUN + TURN pour
une session authentifiée). Ce sont donc des variables lues par **PHP**, modifiables sans
`npm run build`.

### Mode recommandé — credentials éphémères (TURN REST API)

Le serveur signe un couple horodaté par utilisateur. Un abus devient attribuable, plafonnable par
personne (`--user-quota`) et révocable en bloc par rotation du secret.

Générer le secret, et le poser **dans un fichier non versionné** :

    openssl rand -hex 32

    # .env
    COTURN_STATIC_AUTH_SECRET=<la valeur générée>
    COTURN_CREDENTIAL_TTL=86400       # optionnel, 24 h par défaut — voir la borne ci-dessous
    SOCIALIZER_TURN_HOST=turn.example.org   # optionnel, dérivé d'APP_URL à défaut
    SOCIALIZER_TURN_PORT=3478               # optionnel
    SOCIALIZER_TURN_TCP_FALLBACK=true       # optionnel — voir « Réseaux qui ferment l'UDP »

**La MÊME variable doit atteindre coturn.** Deux variables pour un seul secret, et la panne est
silencieuse des deux côtés : coturn refuse chaque allocation, le navigateur se rabat sur STUN, et le
symptôme est « la visio ne passe que sur le réseau local ». Exemple avec un `docker-compose` :

    coturn:
      image: instrumentisto/coturn:<tag épinglé>
      command: >
        --log-file=stdout
        --use-auth-secret
        --static-auth-secret=${COTURN_STATIC_AUTH_SECRET}
        --realm="${COTURN_REALM:-example}"
        --external-ip=${EXTERNAL_IP}
        --fingerprint
        --min-port=49160 --max-port=49200

⚠️ **`--realm` entre guillemets, et depuis une variable dédiée.** Un scalaire replié YAML est
découpé à la shlex : `--realm ${APP_NAME}` avec `APP_NAME="Ma Super App"` fait recevoir à coturn
quatre arguments, et il refuse de démarrer.

⚠️ **Ce secret est celui de tous les utilisateurs** : le compromettre permet de forger le credential
de n'importe qui. Il ne vit que dans un fichier gitignoré ; les gabarits versionnés portent une
valeur **vide**.

⚠️ **Tourner le secret, c'est recréer des conteneurs, pas vider un cache.** Nouvelle valeur dans
`.env`, puis recréer coturn **et** tout conteneur qui exécute l'application Laravel — le web et les
workers (queue, scheduler, Reverb). Deux raisons, chacune suffisante : l'environnement d'un
conteneur est figé à sa création et Dotenv n'écrase jamais une variable déjà présente ; et ces
conteneurs réécrivent au démarrage un cache de configuration commun — en recréer un seul laisse les
autres y remettre l'ancien secret plus tard, sans bruit. `config:clear` ne touche à aucun des deux.
Le désaccord se lit dans le journal coturn : `check_stun_auth: Cannot find credentials of user
<exp:id>` à chaque tentative d'appel. Contrôle sans afficher le secret, une empreinte par
exemplaire, toutes égales ou rien ne relaie (`echo` ajouterait un saut de ligne et une fausse
alerte, d'où `tr -d`) :

    sed -n 's/^COTURN_STATIC_AUTH_SECRET=//p' .env | tr -d '"\n' | sha256sum
    docker inspect <conteneur app> -f '{{range .Config.Env}}{{println .}}{{end}}' \
      | sed -n 's/^COTURN_STATIC_AUTH_SECRET=//p' | tr -d '\n' | sha256sum
    docker inspect <conteneur coturn> -f '{{join .Args " "}}' \
      | grep -oE -- '--static-auth-secret=[^ ]+' | cut -d= -f2- | tr -d '\n' | sha256sum
    php artisan tinker --execute 'echo hash("sha256", (string) config("socializer.signaling.ice.turn.static_auth_secret"));'

ℹ️ **Un STUN qui répond ne prouve pas que coturn alloue.** La preuve est une allocation
authentifiée : la contre-épreuve n°1 écrite en tête de `tests/Feature/Signaling/IceServersTest.php`
(`turnutils_uclient`, livré dans l'image coturn), à rejouer après tout redémarrage du relais — en
UDP, puis avec `-t` pour le repli TCP.

ℹ️ **Le TTL est raccourcissable.** Le client rafraîchit son credential avant l'échéance : la réponse
de `/get-ice-servers` porte un `credential_ttl` et le transport réécrit la configuration ICE du
`Peer` avant qu'elle expire, sans rechargement de page ni coupure des appels en cours. Les 24 h par
défaut ne sont donc plus une contrainte technique, mais un choix conservateur.

⚠️ **Deux réserves avant de descendre à l'échelle de l'heure.** Le rafraîchissement est **borné** :
après quelques tentatives infructueuses (route en panne), il abandonne et l'onglet retombe sur le
comportement d'avant — un F5 renouvelle. Et `GET /get-ice-servers` n'a **pas** de `throttle`, par une
décision documentée dans `routes.public.php` dont la condition de réouverture est précisément « un
credential court **et** re-demandé ». Un TTL horaire rouvre donc cette question.

### Réseaux qui ferment l'UDP — le repli TCP

L'entrée TURN annonce la même adresse deux fois, en UDP puis en `?transport=tcp`. Le navigateur
alloue sur les deux à chaque connexion ; seule la sélection ICE préfère l'UDP, et la variante TCP
n'est retenue qu'en dernier recours. Sans elle, un réseau qui ferme l'UDP (VPN d'entreprise, poste
nomade) tue d'un coup les trois sortes de candidats ICE — direct, STUN, relais — et la négociation
reste en `checking` sans aucune erreur : « A diffuse, B reste sur le spinner ». Ce repli exige que
coturn écoute aussi en TCP sur le port (le compose de l'hôte publie `3478:3478` **et**
`3478:3478/udp`) et que le réseau laisse passer TCP 3478. Il ne couvre pas un réseau qui ne laisse
sortir que le 443 : ce cas demande TURNS sur 443, que ce paquet ne sert pas.

Vérifier depuis le poste qui a le symptôme, sans toucher au code : la page
`https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/` avec les valeurs de
`GET /get-ice-servers` et `IceTransports` sur `relay`. Un candidat `relay` doit apparaître ; s'il
n'apparaît qu'avec l'URL `?transport=tcp`, l'UDP est fermé sur ce chemin.

⚠️ Le coût se paie **par connexion pair-à-pair**, pas par onglet : chaque `RTCPeerConnection`
alloue sur chaque URL TURN, et une allocation en TCP consomme elle aussi un port UDP de la plage
`--min-port`/`--max-port`, le relais vers le pair restant en UDP. Un appel à deux ouvre deux
`RTCPeerConnection` par côté (flux et données), donc environ huit allocations : une plage de 41 ports
ne porte plus qu'environ cinq appels relayés simultanés sur tout le serveur, et `--user-quota` se
divise de même. Élargir la plage, ou `SOCIALIZER_TURN_TCP_FALLBACK=false` sur un déploiement dont
tous les postes portent l'UDP.

ℹ️ Un hôte qui a **publié** `config/socializer.php` avant ce repli doit y ajouter la clé
`signaling.ice.turn.tcp_fallback` : le merge de configuration est peu profond, le repli y est actif
par le défaut du contrôleur, et `SOCIALIZER_TURN_TCP_FALLBACK=false` y est alors ignoré sans bruit.

### Mode statique — couple partagé (déploiements existants)

Si `COTURN_STATIC_AUTH_SECRET` est **vide**, le paquet sert un couple longue durée, partagé par tous
les utilisateurs. Il correspond à un coturn en `--user ${COTURN_USER}:${COTURN_PASS}` :

    # .env
    COTURN_USER=<utilisateur>
    COTURN_PASS=<mot de passe>

Conservé pour ne pas couper le relais d'une installation existante lors d'une mise à jour. **Aucun
abus n'y est attribuable** — préférer le mode ci-dessus dès que possible. Les deux variables sont
ignorées dès qu'un secret est posé.

### Sans relais du tout

Ni secret, ni couple, ni hôte : aucune entrée TURN n'est émise, et le navigateur travaille en STUN
seul. C'est un déploiement valide — la visio passe en direct, mais pas derrière un NAT symétrique.

### Durcissement de coturn — hors du paquet, et à ne pas sauter

Ces gardes appartiennent au déploiement, pas au paquet, et ils tiennent **même si le credential
fuite** : `--no-tcp-relay` (un navigateur ne demande jamais d'allocation TCP relay, alors que sans ce
drapeau un client authentifié auprès de coturn ouvre des sessions TCP complètes vers vos services
internes), `--no-multicast-peers`, `--denied-peer-ip` sur vos réseaux d'infrastructure, `--user-quota`
et `--total-quota`. Vérifier chaque drapeau contre le binaire réellement en place
(`turnserver -h`) : ils varient d'une version à l'autre.

⚠️ **Publier la plage `--min-port`/`--max-port`** dans les ports du conteneur. Sans elle,
l'allocation réussit, coturn annonce une adresse relais que rien ne route, et le relais ne relaie
pas — la visio échoue précisément dans le cas où l'on en avait besoin.

## NGINX & Turn server

Ce qui suit ne concerne que le **canal de contrôle TCP/3478**, et n'aide en rien la plage de ports
de relais ci-dessus.

1. Créer le fichier turn.conf

    sudo nano /etc/nginx/streams-enabled/turn.conf

Ajoute ceci :

    stream {
        upstream turn_server_tcp {
            server 127.0.0.1:3478;
        }

        server {
            listen 3478;
            proxy_pass turn_server_tcp;
        }
    }

2. Inclure ce fichier dans nginx.conf global
Ouvre /etc/nginx/nginx.conf (ou /usr/local/nginx/conf/nginx.conf selon ta distro).

Dans le bloc de niveau supérieur (pas dans http), ajoute :

    include /etc/nginx/streams-enabled/*.conf;

Cela doit être hors du bloc http {} :


# nginx.conf

worker_processes auto;
events { worker_connections 1024; }

# Inclure les streams TURN ici
include /etc/nginx/streams-enabled/*.conf;

http {
    ...
}

3. Tester et redémarrer Nginx

sudo nginx -t
sudo systemctl reload nginx



                
