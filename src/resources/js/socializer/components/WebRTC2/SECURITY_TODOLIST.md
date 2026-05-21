## 🔐 Sécurisation de l'application

> Failles identifiées le 20 mai 2026 par audit de sécurité de `usePeerOrchestrator`, `usePeerTransport`, `usePeerCore`.  
> Sévérité : 🔴 Critique · 🟠 Haute · 🟡 Faible

### usePeerTransport — Topologie star

- [ ] 🔴 **[CRITIQUE] Usurpation d'identité `envelope.from`** `[M]` : le champ `from` de l'enveloppe star est auto-déclaré par le client (`ctx.mySlug.value`) et jamais vérifié par le hub — un client malveillant peut usurper le slug d'un autre utilisateur et faire croire que ses messages proviennent de lui → le hub doit résoudre le slug réel de l'expéditeur depuis le `contextRegistry` (identité PeerJS de la connexion entrante) et ignorer `envelope.from` comme source de vérité

- [ ] 🟠 **[HAUTE] Rate limiting contournable par rotation de `envelope.from`** `[S]` : `_isHubRateLimited(envelope.from)` est basé sur le slug auto-déclaré — un client peut changer librement `envelope.from` pour éviter le plafond → appliquer le rate limiting sur l'identité PeerJS réelle de la connexion (côté récepteur hub), pas sur le champ déclaratif de l'enveloppe

- [ ] 🟠 **[HAUTE] Aucune limite de taille sur les messages forwardés (amplification DoS)** `[S]` : `conn.send(envelope.payload)` est appelé sans vérification de taille — un client peut envoyer un payload de plusieurs Mo que le hub retransmet à tous les membres → ajouter une constante `MAX_PAYLOAD_BYTES` dans `webrtc2.config.js` et rejeter l'enveloppe si `JSON.stringify(envelope.payload).length > MAX_PAYLOAD_BYTES`

- [ ] 🟠 **[HAUTE] `envelope.to` non validé ni restreint aux membres de la room** `[S]` : `forwardStarMessage` utilise `envelope.to` sans passer les slugs par `_isValidSlug()` ni vérifier qu'ils font partie de `ctx.connection.usersInRoom` — un client peut cibler des slugs arbitraires → filtrer `envelope.to` avec `_isValidSlug` ET croiser avec la liste des membres réels de la room avant retransmission

- [ ] 🟠 **[MOYENNE] `_hubRateWindows` : fuite mémoire sur slugs déconnectés** `[S]` : après purge des timestamps expirés, la clé Map du slug est conservée même si le tableau est vide — avec de nombreuses rotations de room, la Map grossit indéfiniment → après `timestamps = timestamps.filter(...)`, ajouter `if (timestamps.length === 0) { _hubRateWindows.delete(senderSlug); return false }` avant de réinsérer

### usePeerTransport — Connexions entrantes

- [ ] 🔴 **[HAUTE] Aucune authentification des connexions WebRTC entrantes** `[M]` : dans `localPeer.on('connection', ...)` et `localPeer.on('call', ...)`, toute personne connaissant un `peerId` peut ouvrir une connexion data ou déclencher un appel et recevoir le stream local sans aucune vérification → avant d'appeler `targetCtx.setUpConnectionListeners(conn)` ou `call.answer(localStream)`, vérifier que `conn.metadata.from` (ou `call.metadata.from`) figure dans la liste des membres autorisés de la room (`ctx.connection.usersInRoom`)

- [ ] 🟡 **[FAIBLE] `contextRegistry` : collision de `contextId` possible** `[S]` : si deux contextes partagent le même `contextId` (même `type` + même `room`), le second écrase le premier dans le registre global — un peer connaissant le schéma de nommage des IDs pourrait envoyer un `callbackKey` ciblant un contexte existant → garantir l'unicité du `contextId` en y intégrant un suffixe aléatoire (`crypto.randomUUID()` partiel) ou en refusant l'enregistrement si l'ID est déjà présent

### usePeerCore — Signalisation

- [ ] 🟡 **[FAIBLE] `conn.metadata` non sanitisé avant usage** `[S]` : les métadonnées PeerJS viennent du réseau et sont utilisées directement (`metadata.from`, `metadata.type`, `metadata.room`) sans validation de format ni de longueur → valider chaque champ consommé avec les guards existants (`_isValidSlug`, `_isValidCallType`) et tronquer/rejeter les valeurs inattendues

### Backend Laravel — UserController (signalisation)

- [ ] 🔴 **[CRITIQUE] Usurpation d'identité via `closeConnectionToPeerId`** `[S]` : `fromUserSlug` est lu depuis la requête (`$request->get('fromUserSlug')`) puis broadcasté tel quel, sans le lier à l'utilisateur authentifié — un client peut forger ce champ et déclencher une fermeture de connexion en se faisant passer pour un autre utilisateur → remplacer par `Auth::user()->slug`, ignorer/refuser toute valeur cliente pour `fromUserSlug`, et journaliser les tentatives de mismatch

### Architecture — Absence de chiffrement E2E

- [ ] 🟡 **[INFO] Pas de chiffrement E2E en topologie star** `[L]` : par architecture, le hub lit en clair `envelope.payload` avant retransmission — si le hub est compromis, il a accès à toutes les conversations → documenter explicitement cette limitation dans le README WebRTC2 ; pour les données sensibles, envisager un chiffrement symétrique côté client (ex: AES-GCM via Web Crypto API) avant mise en enveloppe
