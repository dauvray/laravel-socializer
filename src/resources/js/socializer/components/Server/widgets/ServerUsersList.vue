<template>
    <ul class="server-users-list">
        <li v-for="user in users"
            :key="user.id"
            class="server-user">
                <Gravatar
                    size="small"
                    style="width: 30px;"
                    :user="user"
                    :showStatus="false"
                ></Gravatar>
                <UserWallLink :user="user" :dropdown="false"></UserWallLink>
                <span v-if="isMe(user)" class="server-user-me">vous</span>
        </li>
    </ul>
</template>

<script>
    import { mapState } from 'pinia'
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'
    import { useMeStore } from '~estarter/stores/me.js'

    export default {
        name: 'ServerUsersList',
        components: {
            Gravatar,
            UserWallLink,
        },
        props: {
            /**
             * Membres actuellement souscrits au canal de présence du serveur — le `users` de
             * `useReverbChannel`, pas la liste des membres inscrits. Chaque entrée est une
             * `UserResource` produite par `channels.php`.
             *
             * @type {import('vue').PropType<Array<{id: number, name: string, slug: string}>>}
             */
            users: {
                type: Array,
                required: true
            }
        },
        computed: {
            ...mapState(useMeStore, {
                getMe: 'getMe',
            }),
        },
        methods: {
            /**
             * ⚠️ Ne JAMAIS se fier à `user.is_me` sur une charge utile de présence : il vaut
             * `true` pour TOUT LE MONDE. Chaque `user_info` est construite pendant la requête
             * `/broadcasting/auth` de SON propre membre, donc `Auth::user()` y est toujours ce
             * membre-là, et `EstarterUserResource` conclut « c'est moi ». Le seul juge fiable de
             * « moi » côté client est le store `me`.
             *
             * @param {{id: number}} user
             * @return {boolean}
             */
            isMe(user) {
                return user.id === this.getMe?.id
            }
        }
    }
</script>
