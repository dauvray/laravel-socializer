<template>
    <button 
       v-if="!followed"
        type="button" 
        class="btn follow-btn"
        @click="onFollow"
        ><IconWidget icon="splotch"></IconWidget> Suivre
    </button>
    <button v-else
        type="button" 
        class="btn follow-btn"
        :class="{followed: 'followed'}"
        @click="onUnfollow"
        ><IconWidget icon="splotch"></IconWidget> Ne plus suivre
    </button>
</template>

<script>
    import { mapActions } from 'pinia'
    import { useCommunityStore } from '~socializer/stores/community.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'FollowButton',
        components: {
            IconWidget,
        },
        props: {
            user: {
                type: Object,
                required: true
            }
        },
        data() {
            return {
                followed: this.user.followed
            }
        },  
        methods: {
            ...mapActions(useCommunityStore, [
                'followUser',
                'unfollowUser',
            ]),
            onFollow() {
                this.followUser(this.user.identifier)
                .then(status => {
                    if(status === 'success') {
                        this.followed = true
                    }
                })
            },
            onUnfollow() {
                this.unfollowUser(this.user.identifier)
                .then(status => {
                    if(status === 'success') {
                        this.followed = false
                    }
                })
            }
        }
    }
</script>