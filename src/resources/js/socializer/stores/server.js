import originalState from './server/state.js'
import actionsServer from './server/actions.js'
import gettersServer from './server/getters.js'

import { defineStore } from 'pinia'

export const useServerStore = defineStore('server', {
  state: originalState,
  getters: gettersServer,
  actions: actionsServer,
})
