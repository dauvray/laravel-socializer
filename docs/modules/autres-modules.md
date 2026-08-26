# Les autres modules front

> **À quoi ça sert :** savoir en une ligne ce que fait chaque module et où il vit, sans grep.
> **Quand le lire :** pour situer un module qui n'a pas encore sa doc dédiée.

Ces fiches ne remplacent pas une doc de module — elles évitent d'avoir à explorer pour savoir où
regarder. Quand un module reçoit assez de rationale non déductible du code, il gagne son dossier
sous `docs/modules/` selon le modèle de [ecrire-la-doc.md](../ecrire-la-doc.md), et sa ligne ici
devient un simple lien.

Racine : `src/resources/js/socializer/components/`

Documentés à part : **[WebRTC2](webrtc2/INDEX.md)** · **[Chat](chat.md)**

---

## ⚠️ La v1 WebRTC est morte, et elle est encore dans l'arbre

`components/WebRTC/` (sans le 2) coexiste avec `components/WebRTC2/`, avec des fichiers homonymes :
rien ne doit y être ajouté, et un symbole trouvé au grep peut venir de là. Le détail — ce qui y vit
encore, ce qui l'appelle encore — est dans
[modules/webrtc2/INDEX.md](webrtc2/INDEX.md).

---

## Fiches

| Module | Chemin | Rôle · points d'entrée |
|---|---|---|
| **Comment** | `Comment/` | Commentaires imbriqués : `Comments.vue`, `CommentList(.Wrapper).vue`, `CommentForm.vue`, `Comment.vue`, `widgets/` (Counter, Like, Rate, Report). Injectable dans n'importe quelle vue Blade via `@include('socializer::widgets.comments')`. Côté PHP : trait `Commentable` + service `Comments`. |
| **Server** | `Server/` | « Serveurs » façon Discord : `Server.vue`, `Room.vue`, `RoomHeader.vue`, `roomSettings.js`, `widgets/` (ServerList, RoomSidebar, RoomUsersList, LockedRoom, SettingsModal). Les presets de rooms viennent de `src/config/modules.php`. |
| **System** | `System/` | Notifications et alertes globales. **`Notifications.vue` est monté en permanence** — c'est le pont Reverb → signaux WebRTC2 et le porteur du contexte `data-app` ; `widgets/AlertComponent.vue` (invitations d'appel), `ToasterNewMessage.vue`, `system.config.js`, et `composables/useReverbChannel.js` ([doc](../reference/use-reverb-channel.md)). |
| **User** | `User/` | Profil : `Wall.vue`, `WallLink.vue`, `Cover.vue`, `Badge.vue`, `ThumbnailWidget.vue`, `widgets/` (FollowButton, PublishButton, UserGroups). |
| **Feed** | `Feed/` | Fil d'actualité : `Feed.vue`, `PostList.vue`, `Post.vue`, `widgets/ShareButton.vue`, `SharedThumbnail.vue`. Fan-out serveur par les Jobs `SendPostToFollowers`. |
| **views** | `views/` | Pages routées par vue-router : `WallUser.vue`, `FeedUser.vue`, `Store.vue`, `Teams.vue`, `UserList.vue`, `Servers.vue`. Déclarées dans `routes/application.js`. |
| **Application** | `Application/` | « Store d'applications » IA : `ApplicationComponent.vue`, `settings.js`, `template.html`, `widgets/ApplicationModale.vue`, `Exemples/`. Agents extensibles côté app via `socializer_custom_elements/agents/settings.js`. |
| **Data** | `Data/` | Questionnaires et données de room : `DataComponent.vue`, `AdminComponent.vue`, `QuestionnaireComponent.vue`, `QuestionnaireManager.vue`. S'appuie sur `laravel-formdesigner`. |
| **Whiteboard** | `Whiteboard/` | Tableau blanc collaboratif Excalidraw. `WhiteboardComponent.vue` (Vue) enveloppe `ExcalidrawElement.jsx` (**React**) — seul point React du package, d'où le `@vitejs/plugin-react` et le `isCustomElement` exigés dans le `vite.config.js` de l'app. |
| **Page** | `Page/` | Pages de room : `PageComponent.vue`, `PageWebBuilder.vue` (GrapesJS), `SandboxedPage.vue`. |
| **Users** | `Users/` | Annuaire : `UsersList.vue`, `Widgets/SearchUsers.vue` (⚠️ `Widgets/` en majuscule ici). |
| **ClassRoom** | `ClassRoom/` | Salle de classe : `ClassRoomComponent.vue`, `ConfigPanel.vue`. Cas d'usage type de la topologie **star** de WebRTC2. |
| **AudioRoom** | `AudioRoom/` | Salon audio : `AudioComponent.vue`. |
| **WallRoom** | `WallRoom/` | Mur dans une room : `WallComponent.vue`. |
| **widgets** | `widgets/` | Transverses : `IntersectionObserver.vue`, `PaginationOrIntersection.vue`, `Notifications/` (ServerAccessRequest, ServerAccessResponse). |

---

## Où chercher le reste

- **Logique métier PHP** → `src/app/Services/` : Chat, Feed, Comments, Likes, Users, Page, Server,
  Store, WhiteBoard, ApplicationIA, QuestionnaireIA, RedisService, OnlineUsersService, et
  **GraphProjection** (le réplica graphe — [projection-graphe.md](../architecture/projection-graphe.md)).
  Les contrôleurs sont minces.
- **État front** → `src/resources/js/socializer/stores/`, pattern
  `<nom>.js` + `<nom>/{state,getters,actions}.js`.
- **Extension par l'application hôte** → `socializer_custom_elements/` — voir
  [architecture/package.md](../architecture/package.md#points-dextension-côté-application).
- **Canaux temps réel et présence** → [architecture/signalisation.md](../architecture/signalisation.md).
