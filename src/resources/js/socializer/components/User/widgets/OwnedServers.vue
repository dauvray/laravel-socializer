<template>
  <section class="owned-servers-widget" v-if="hasServers">
    <h2>Domaines</h2>
    <ul>
      <li v-for="(server, idx) in ownedServers" :key="server.id">
        <button type="button" @click="onCheckAccess(server.id)">
            {{ server.name }}
            <IconWidget v-if="server.privacy ===1" class="icon-widget" icon="key"></IconWidget> 
        </button>
      </li>
    </ul>
  </section>
</template>

<script>
  import { mapState } from 'pinia'
  import { useWallStore } from '~socializer/stores/wall.js'
  import IconWidget from '~estarter/components/widgets/IconWidget.vue'
  import { checkServerAccess } from '~socializer/services/helpers.js'

  export default {
      name: 'OwnedServers',
      components: {
          IconWidget,
      },
      emits: [
          'check-server-access',
      ],
      computed: {
          ...mapState(useWallStore, {
              ownedServers: 'getOwnedServers',
          }),
          hasServers() {
            if(!this.ownedServers) {
                return false
            }
            return this.ownedServers.length > 0
          },
      },
      methods: {
          async onCheckAccess(serverId) {
              const hasAccess = await checkServerAccess(serverId)
              this.$emit('check-server-access', hasAccess)
              if(hasAccess) {
                  this.$router.push({ name: 'server', params: { serverId }})
              }
          },
      },
  }
</script>