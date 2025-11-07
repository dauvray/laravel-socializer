import CustomRoomConfig from '~/socializer_custom_elements/rooms/config.js'

const streamableComponents = ['chat', 'classroom']

// used custom field room selector
const coreComponentMapping = Object.assign({
    locked: {
       component: 'LockedRoom',
       description: 'Affichage pour salon non autorisés',
       name: 'Salon privé',
       selectable: false
    },
    page: {
        component: 'PageComponent',
        description: 'Affiche une page',
        name: 'Page',
        selectable: true
     },
     audio: {
         component: 'AudioComponent',
         description: 'Salon audio',
         name: 'Audio',
         selectable: true
     },
     chat: {
        component: 'ChatComponent',
        description: 'Chat, visio et call',
        name: 'Chat',
        selectable: true
     },
     form: {
        component: 'Questionnaire',
        description: 'Affiche un questionnaire',
        name: 'Collecte de données',
        selectable: true
     },
     data: {
        component: 'DataComponent',
        description: 'Consultation des données',
        name: 'Affichage des données',
        selectable: true
     },
     admin: {
         component: 'AdminComponent',
         description: 'Administration des données',
         name: 'Administration des données',
         selectable: true
      },
      whiteboard: {
        component: 'WhiteboardComponent',
        description: 'Tableau blanc collaboratif',
        name: 'Tableau blanc',
        selectable: true
      },
      application: {
         component: 'ApplicationComponent',
         description: 'Application générée par lÌA',
         name: 'Application IA',
         selectable: true
       },
      classroom: {
         component: 'ClassRoomComponent',
         description: 'Salle de conférence virtuelle',
         name: 'Salle de conférence',
         selectable: true
       },
      wall: {
         component: 'Wall',
         description: 'Fil d\'actualités',
         name: 'Mur social',
         selectable: true
       },
}, CustomRoomConfig.componentMapping)

export {
    coreComponentMapping,
    streamableComponents,
}