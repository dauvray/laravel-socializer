<template>
    <div ref="userLink" 
        class="user-link-container" >
            <span class="user-link" @click="viewProfile">{{ user.name }}</span>
            <IconWidget icon="user-circle"  
                @click="showDropdown" 
                @touch="showDropdown"
            ></IconWidget>
            <!-- Dropdown -->
            <div v-if="isDropdownVisible" 
                ref="userCover" 
                :style="coverStyle"
                class="user-dropdown" 
                @mouseenter="keepDropdown" 
                @mouseleave="hideDropdown">
                <div class="dropdown-content">

                    <CoverUser
                        class="mb-5"
                        :user="user"
                    ></CoverUser>

                    <div class="user-info">
                        <h4 class="user-name">{{ user.name }}</h4>
                        <p v-if="user.email" class="user-email">{{ user.email }}</p>
                        <p v-if="user.role" class="user-role">{{ user.role }}</p>
                        <p v-if="user.lastSeen" class="user-last-seen">
                            Dernière connexion: {{ formatDate(user.lastSeen) }}
                        </p>
                        <p v-if="user.status" class="user-status" :class="statusClass">
                            <span class="status-dot"></span>
                            {{ user.status }}
                        </p>
                    </div>

                    <div v-if="user.slug" class="dropdown-actions">
                        <button @click="viewProfile" class="btn-action">
                            Voir le profil
                        </button>
                        <button v-if="canSendMessage" @click="sendMessage" class="btn-action">
                            Envoyer un message
                        </button>
                    </div>
                </div>
            </div>
    </div>
</template>

<script>
import { mapState } from 'pinia'
import { useApplicationStore } from '~estarter/stores/application.js'
import { computePosition, offset, flip, shift } from '@floating-ui/dom'
import CoverUser from '~socializer/components/User/Cover.vue'
import IconWidget from '~estarter/components/widgets/IconWidget.vue'

export default {
    name: 'WallLink',
    props: {
        user: {
            type: Object,
            required: true
        },
        reloadPage: {
            type: Boolean,
            required: true,
        }
    },
    components: {
       CoverUser,
       IconWidget,
    },
    data() {
        return {
            isDropdownVisible: false,
            coverStyle: {},
        }
    },
    computed: {
        ...mapState(useApplicationStore, {
            isSpa: 'getIsSpa',
        }),
        statusClass() {
            return {
                'status-online': this.user.status === 'online',
                'status-away': this.user.status === 'away',
                'status-offline': this.user.status === 'offline'
            }
        },
        canSendMessage() {
            return this.user.slug && this.user.id !== this.currentUserId
        }
    },
    mounted() {
       
    },
    methods: {
        showDropdown() {
            this.isDropdownVisible = true
             this.updatePosition()
        },
        hideDropdown() {
            this.isDropdownVisible = false
        },
        keepDropdown() {

        },
        formatDate(date) {
            if (!date) return ''
            return new Date(date).toLocaleString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
        },
        viewProfile() {
            if (this.user.slug) {
                if (this.isSpa) {
                    this.$router.push({ name: 'WallUser', params: { slug: this.user.slug } })
                } else {
                    window.location.href = this.$router.resolve({ name: 'WallUser', params: { slug: this.user.slug } }).href
                }
            }
        },
        sendMessage() {
            // Logique pour envoyer un message
            this.$emit('send-message', this.user)
        },
        async updatePosition() {
            await this.$nextTick()

            if (!this.$refs.userLink || !this.$refs.userCover) return

            // pour utiliser le ref de MessageTools
            const referenceEl = this.$refs.userCover

            const { x, y } = await computePosition(this.$refs.userLink, referenceEl, {
                placement: 'right',
                middleware: [
                    offset(3),
                    flip(),
                    shift({ padding: 8 }),
                ]
            })

            this.coverStyle = {
                top: `${y}px`,
                left: `${x}px`,
            }

        },
    },

}
</script>

<style lang="scss" scoped>
.user-link-container {
    position: relative;
    display: inline-block;
    cursor: pointer;
}

.user-link {
    color: #007bff;
    text-decoration: none;
    padding: 2px 4px;
    border-radius: 3px;
    transition: background-color 0.2s;

    &:hover {
        text-decoration: underline;
    }   
}



.user-dropdown {
    position: absolute;
    overflow: hidden;
    z-index: 5;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    min-width: 280px;
    padding: 16px;
    margin-top: 4px;
    animation: fadeIn 0.2s ease-in-out;
}

@keyframes fadeIn {
    from {
        opacity: 0;
        transform: translateY(-8px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.dropdown-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.user-avatar {
    display: flex;
    justify-content: center;
    margin-bottom: 8px;
}

.user-avatar img {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    object-fit: cover;
}

.avatar-placeholder {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: #007bff;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 18px;
}

.user-info {
    text-align: center;
}

.user-name {
    margin: 0 0 8px 0;
    font-size: 16px;
    font-weight: 600;
    color: #333;
}

.user-email {
    margin: 4px 0;
    font-size: 14px;
    color: #666;
}

.user-role {
    margin: 4px 0;
    font-size: 12px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.user-last-seen {
    margin: 4px 0;
    font-size: 12px;
    color: #888;
}

.user-status {
    margin: 8px 0;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ccc;
}

.status-online .status-dot {
    background: #28a745;
}

.status-away .status-dot {
    background: #ffc107;
}

.status-offline .status-dot {
    background: #dc3545;
}

.dropdown-actions {
    display: flex;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid #eee;
}

.btn-action {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    color: #333;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
}

.btn-action:hover {
    background: #f8f9fa;
    border-color: #007bff;
    color: #007bff;
}

.btn-action:first-child {
    background: #007bff;
    color: white;
    border-color: #007bff;
}

.btn-action:first-child:hover {
    background: #0056b3;
}
</style>