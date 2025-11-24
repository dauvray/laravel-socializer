export default [
    {
        path: `/${router_base_url}/wall/:slug?`,
        name: 'WallUser',
        component: () => import('~socializer/components/views/WallUser.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', id:'home', link: '/'},
                { name: 'Mur', id:'wall', link: null },
            ]
        }
    },
    {
        path: `/${router_base_url}/feed`,
        name: 'FeedUser',
        component: () => import('~socializer/components/views/FeedUser.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', id:'home', link: '/'},
                { name: 'Fil', id:'feed', link: null },
            ]
        }
    },
    {
        path: `/${router_base_url}/store`,
        name: 'Store',
        component: () => import('~socializer/components/views/Store.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', id:'home', link: '/'},
                { name: 'Store', id:'store', link: null },
            ]
        }
    },
    {
        path: `/${router_base_url}/teams`,
        name: 'Teams',
        component: () => import('~socializer/components/views/Teams.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', id:'home', link: '/'},
                { name: 'Conversations', id:'teams', link: null },
            ]
        }
    },
    {
        path: `/${router_base_url}/users`,
        name: 'userList',
        component: () => import('~socializer/components/views/UserList.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', id:'home', link: '/'},
                { name: 'Membres', id:'members', link: null },
            ]
        }
    },
    {
        path: `/${router_base_url}/servers`,
        name: 'serverList',
        component: () => import('~socializer/components/views/Servers.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', id:'home', link: '/'},
                { name: 'Domaines', id:'servers', link: null },
            ]
        },
    },
    {
        path: `/${router_base_url}/server/:serverId?`,
        name: 'server',
        component: () => import('~socializer/components/Server/Server.vue'),
        meta: {
            breadcrumb: [
                { name: 'Accueil', id:'home', link: '/'},
                { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                { name: null, id:'server_name', link: null},
            ]
        },
        children: [
            {
                path: `room/:roomId`,
                name: 'room',
                component: () => import('~socializer/components/Server/Room.vue'),
                meta: {
                    breadcrumb: [
                        { name: 'Accueil', id:'home', link: '/'},
                        { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                        { name: null, id:'server_name', link: null},
                        { name: null, id:'content', link: null },
                    ]
                },
                children: [
                    {
                        path: `page/:vertexId`,
                        name: 'page',
                        component: () => import('~socializer/components/Page/PageComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', id:'home', link: '/'},
                                { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                                { name: null, id:'server_name', link: null},
                                { name: null, id:'content', link: null },
                            ]
                        }
                    },
                     {
                        path: `audio/:vertexId`,
                        name: 'audio',
                        component: () => import('~socializer/components/AudioRoom/AudioComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', id:'home', link: '/'},
                                { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                                { name: null, id:'server_name', link: null},
                                { name: null, id:'content', link: null },
                            ]
                        }
                    },
                    {
                        path: `chat/:vertexId`,
                        name: 'chat',
                        component: () => import('~socializer/components/Chat/ChatComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', id:'home', link: '/'},
                                { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                                { name: null, id:'server_name', link: null},   
                                { name: null, id:'content', link: null },
                            ]
                        }
                    },
                    {
                        path: `form/:vertexId`,
                        name: 'form',
                        component: () => import('~socializer/components/Data/QuestionnaireComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', id:'home', link: '/'},
                                { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                                { name: null, id:'server_name', link: null},
                                { name: null, id:'content', link: null },
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
                                { name: 'Accueil', id:'home', link: '/'},
                                { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                                { name: null, id:'server_name', link: null},
                                { name: null, id:'content', link: null },
                            ]
                        },
                    },
                    {
                        path: `whiteboard/:vertexId`,
                        name: 'whiteboard',
                        component: () => import('~socializer/components/Whiteboard/WhiteboardComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', id:'home', link: '/'},
                                 { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                                { name: null, id:'server_name', link: null},
                                { name: null, id:'content', link: null },
                            ]
                        }
                    },
                    {
                        path: `classroom/:vertexId`,
                        name: 'classroom',
                        component: () => import('~socializer/components/ClassRoom/ClassRoomComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', id:'home', link: '/'},
                                { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                                { name: null, id:'server_name', link: null},
                                { name: null, id:'content', link: null },
                            ]
                        }
                    },
                    {
                        path: `application/:vertexId`,
                        name: 'application',
                        component: () => import('~socializer/components/Application/ApplicationComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', id:'home', link: '/'},
                                { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                                { name: null, id:'server_name', link: null},
                                { name: null, id:'content', link: null },
                            ]
                        }
                    },
                    {
                        path: `wall/:vertexId`,
                        name: 'wall',
                        component: () => import('~socializer/components/WallRoom/WallComponent.vue'),
                        meta: {
                            breadcrumb: [
                                { name: 'Accueil', id:'home', link: '/'},
                                 { name: 'Domaines', id:'servers', link: {name :'serverList'}, internal: true},
                                { name: null, id:'server_name', link: null},
                                { name: null, id:'content', link: null },
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
                        {name: 'Accueil', id:'home', link: '/'},
                        { name: 'Gestion des formulaires', id:'form_manager', link: null },
                    ]
                }
            },
        ]
    },

]