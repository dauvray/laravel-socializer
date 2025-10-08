export default [
    {
        path: `/${router_base_url}/wall/:slug?`,
        name: 'WallUser',
        component: () => import('~socializer/components/views/WallUser.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', link: '/'},
                { name: 'Mur', link: null },
            ]
        }
    },
    {
        path: `/${router_base_url}/feed`,
        name: 'FeedUser',
        component: () => import('~socializer/components/views/FeedUser.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', link: '/'},
                { name: 'Fil', link: null },
            ]
        }
    },
    {
        path: `/${router_base_url}/store`,
        name: 'Store',
        component: () => import('~socializer/components/views/Store.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', link: '/'},
                { name: 'Store', link: null },
            ]
        }
    },
    {
        path: `/${router_base_url}/teams`,
        name: 'Teams',
        component: () => import('~socializer/components/views/Teams.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', link: '/'},
                { name: 'Conversations', link: null },
            ]
        }
    },
    {
        path: `/${router_base_url}/users`,
        name: 'userList',
        component: () => import('~socializer/components/views/UserList.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', link: '/'},
                { name: 'Membres', link: null },
            ]
        }
    },
    {
        path: `/${router_base_url}/servers`,
        name: 'serverList',
        component: () => import('~socializer/components/views/Servers.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', link: '/'},
                { name: 'Domaines', link: null },
            ]
        },
    },
    {
        path: `/${router_base_url}/server/:serverId?`,
        name: 'server',
        component: () => import('~socializer/components/Server/Server.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', link: '/'},
                { name: 'Domaines', link: `/${router_base_url}/servers` },
                { name: 'Server_name', link: null},
            ]
        },
        children: [
            {
                path: `room/:roomId`,
                name: 'room',
                component: () => import('~socializer/components/Server/Room.vue'),
                meta: {
                    breadcrumb: [
                        { name: 'Accueil', link: '/'},
                        { name: 'Salon', link: null },
                    ]
                },
                children: [
                    {
                        path: `page/:vertexId`,
                        name: 'page',
                        component: () => import('~socializer/components/Page/PageComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', link: '/'},
                                { name: 'Page', link: null },
                            ]
                        }
                    },
                     {
                        path: `audio/:vertexId`,
                        name: 'audio',
                        component: () => import('~socializer/components/AudioRoom/AudioComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', link: '/'},
                                { name: 'Salon audio', link: null },
                            ]
                        }
                    },
                    {
                        path: `chat/:vertexId`,
                        name: 'chat',
                        component: () => import('~socializer/components/Chat/ChatComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', link: '/'},
                                { name: 'Chat', link: null },
                            ]
                        }
                    },
                    {
                        path: `form/:vertexId`,
                        name: 'form',
                        component: () => import('~socializer/components/Data/QuestionnaireComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', link: '/'},
                                { name: 'Formulaire', link: null },
                            ]
                        }
                    },
                    {
                        path: `data/:vertexId`,
                        name: 'data',
                        component: () => import('~socializer/components/Data/DataComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', link: '/'},
                                { name: 'Data', link: null },
                            ]
                        },
                        children: [
                            {
                                path: `viewer/:answerId`,
                                name: 'viewer',
                                component: () => import('~formdesigner/application/formCreator/QuestionnaireViewer.vue'),
                                meta: {
                                    breadcrumb: [
                                        {name: 'Accueil', link: '/'},
                                        { name: 'Consultation des données', link: null },
                                    ],
                                    rendererQuestionnaireLink: "/renderer-server-questionnaire"
                                },
                            }
                        ]
                    },
                    {
                        path: `admin/:vertexId`,
                        name: 'admin',
                        component: () => import('~socializer/components/Data/AdminComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', link: '/'},
                                { name: 'Adminstration data', link: null },
                            ]
                        },
                    },
                    {
                        path: `whiteboard/:vertexId`,
                        name: 'whiteboard',
                        component: () => import('~socializer/components/Whiteboard/WhiteboardComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', link: '/'},
                                { name: 'Tableau blanc', link: null },
                            ]
                        }
                    },
                    {
                        path: `classroom/:vertexId`,
                        name: 'classroom',
                        component: () => import('~socializer/components/ClassRoom/ClassRoomComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', link: '/'},
                                { name: 'Conference', link: null },
                            ]
                        }
                    },
                    {
                        path: `application/:vertexId`,
                        name: 'application',
                        component: () => import('~socializer/components/Application/ApplicationComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', link: '/'},
                                { name: 'Application', link: null },
                            ]
                        }
                    },
                ]
            },
            {
                path: `questionnaires`,
                name: 'questionnaire-manager',
                component: () => import('~socializer/components/Data/QuestionnaireManager.vue'),
                meta: {
                    breadcrumb: [
                        {name: 'Accueil', link: '/'},
                        { name: 'Gestion des formulaires', link: null },
                    ]
                }
            },
        ]
    },

]