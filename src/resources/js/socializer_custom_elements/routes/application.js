import SocializerRoutes from '~socializer/routes/application.js'
import CustomRoomsConfig from '../rooms/config.js'

function addCustomRouteToRoom(roomType, componentName) {
    // Trouver la route server
    const serverRoute = SocializerRoutes.find(route => route.name === 'server');
    
    if (serverRoute) {
        // Trouver la route room qui est un enfant de server
        const roomRoute = serverRoute.children.find(route => route.name === 'room');

        if (roomRoute) {
            // Création de la nouvelle route
            const newRoute = {
                path: `${roomType}/:vertexId`,
                name: roomType,
                component: () => import(`../rooms/components/${componentName}.vue`),
                meta: {
                    breadcrumb: [
                        { name: 'Accueil', link: '/' },
                        { name: 'Room', link: null },
                        { name: componentName, link: null }
                    ]
                }
            };

            // Ajout de la nouvelle route aux enfants de la route room
            roomRoute.children = roomRoute.children || [];
            roomRoute.children.push(newRoute);

        }
    }
}

for (const property in CustomRoomsConfig.componentMapping) {
    addCustomRouteToRoom(property, CustomRoomsConfig.componentMapping[property].component)
}

export default [...SocializerRoutes]