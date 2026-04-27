<template>
    <div class="mb-3">
        <label for="memberInput" class="form-label">Membre</label>
        <input type="text" class="form-control" id="memberInput" placeholder="Rechercher un membre">
    </div>
</template>

<script>

    import { useSocialUserStore } from '~socializer/stores/socialUser.js'
    import { mapActions, mapState } from 'pinia'

    export default {
        name: 'SearchUsers',
        created() {
            this.loadAllUserGroups()
        },
        methods: {
            ...mapActions(useSocialUserStore, [
                'loadAllUserGroups',
            ]),
        }
    }
</script>