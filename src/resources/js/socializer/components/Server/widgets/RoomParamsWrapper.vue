<template>
    <div class="accordion accordion-flush" id="accordionSideBar">
        <div class="accordion-item" v-for="(moduleGroup, moduleIndex) in groupedRooms" :key="moduleIndex">
            <h6 class="accordion-header" v-if="moduleGroup.moduleId">
                <button class="accordion-button"
                    :class="{ collapsed: !isAccordionOpen(moduleGroup.moduleId) }"
                    type="button" 
                    data-bs-toggle="collapse" 
                    :data-bs-target="`#collapse${moduleIndex}`" 
                    aria-expanded="true" 
                    :aria-controls="`collapse${moduleIndex}`"
                    @click="toggleModule(moduleGroup.moduleId)">
                    Module: {{ moduleGroup.moduleId }}
                </button>
            </h6>
            <div :id="`collapse${moduleIndex}`" 
                class="accordion-collapse collapse" 
                :class="{ show: isAccordionOpen(moduleGroup.moduleId) }"
                data-bs-parent="#accordionSideBar">
                <div class="accordion-body p-0">
                    <ul class="list-group list-group-flush">
                        <li v-for="(room, roomIndex) in moduleGroup.rooms"
                            class="list-group-item list-group-item-action ps-0 pe-0">
                            <RoomParamsButton
                                :key="roomIndex"
                                :server="currentServer"
                                :room="room"
                                @delete-room="onDeleteRoom"
                                @edit-room="onEditRoom"
                                @sort-up-room="onSortUpRoom"
                                @sort-down-room="onSortDownRoom"
                            ></RoomParamsButton>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
    import RoomParamsButton from './RoomParamsButton.vue'

    export default {
        name: 'RoomParamsWrapper',
        emits: [
            'delete-room',
            'edit-room',
            'sort-up-room',
            'sort-down-root',
        ],
        components: {
            RoomParamsButton,
        },
        props: {
            currentServer: {
                type: Object,
                required: true
            },
            rooms: {
                type: Array,
                required: true,
            }
        },
        data() {
            return {
                groupedRooms: [],
                activeModuleIds: [], // Liste des modules ouverts
                activeRoomId: null, // ID de la salle active
            }
        },
        created() {
            // Restaurer l'état des accordéons au chargement
            this.restoreAccordionState();
        },
        mounted() {
            // Appel de la méthode pour grouper les rooms
            this.groupRooms();
        },
        watch: {
            rooms: {
                handler() {
                    this.groupRooms()
                },
                deep: true,
            },
        },
        methods: {
            groupRooms() {
                const result = [];
                let currentModuleId = null;
                let currentGroup = null;

                // Parcours des rooms et regroupement par module_id
                this.rooms.forEach(room => {
                    const moduleId = room.module_id || null;
                    
                    // Si le module_id change ou pour le premier élément
                    if (moduleId !== currentModuleId || currentGroup === null) {
                        // On crée un nouveau groupe
                        currentGroup = {
                            moduleId: moduleId,
                            rooms: []
                        };
                        result.push(currentGroup);
                        currentModuleId = moduleId;
                    }
                    
                    // Ajout de la room au groupe courant
                    currentGroup.rooms.push(room);

                    // Si cette salle est active, on s'assure que son module est ouvert
                    if (this.isRoomActive(room)) {
                        this.ensureAccordionOpen(moduleId);
                    }

                });
                
                this.groupedRooms = [...result];
            },
            onDeleteRoom(roomId) {
                this.$emit('delete-room', roomId)
            },
            onEditRoom(payload) {
                this.$emit('edit-room', payload)     
            },
            onSortUpRoom(index) {
                this.$emit('sort-up-room', index)
            },
            onSortDownRoom(index) {
                this.$emit('sort-down-room', index)
            },
            isRoomActive(room) {
                // À adapter selon votre logique d'identification de salle active
                // Par exemple, si vous utilisez vue-router et que l'URL contient l'ID de la salle
                return room.id === this.activeRoomId;
            },
            toggleModule(moduleId) {
                if (this.isAccordionOpen(moduleId)) {
                    // Ferme le module s'il est déjà ouvert
                    this.activeModuleIds = this.activeModuleIds.filter(id => id !== moduleId);
                } else {
                    // Ouvre le module s'il est fermé
                    this.ensureAccordionOpen(moduleId);
                }
                
                // Option: sauvegarder l'état dans localStorage
                localStorage.setItem('activeModuleIds', JSON.stringify(this.activeModuleIds));
            },
            ensureAccordionOpen(moduleId) {
                if (!this.isAccordionOpen(moduleId)) {
                    this.activeModuleIds.push(moduleId);
                }
            },
            isAccordionOpen(moduleId) {
                return this.activeModuleIds.includes(moduleId) || moduleId === null;
            },
            ensureAccordionOpen(moduleId) {
                if (!this.isAccordionOpen(moduleId)) {
                    this.activeModuleIds.push(moduleId);
                }
            },
            // À appeler lors du chargement du composant
            restoreAccordionState() {
                // Restaurer les modules ouverts
                const savedModuleIds = localStorage.getItem('activeModuleIds');
                if (savedModuleIds) {
                    try {
                        this.activeModuleIds = JSON.parse(savedModuleIds);
                    } catch (e) {
                        console.error('Erreur lors de la restauration des modules actifs', e);
                    }
                }
                
                // Restaurer la salle active
                const savedRoomId = localStorage.getItem('activeRoomId');
                if (savedRoomId) {
                    this.activeRoomId = savedRoomId;
                }
            }
        }
    }
</script>

<style scoped>
    .accordion-item {
        margin-bottom: 10px;
    }
</style>