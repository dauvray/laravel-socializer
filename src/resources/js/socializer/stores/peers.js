import originalState from './peers/state.js'
import actionsPeers from './peers/actions.js'
import gettersPeers from './peers/getters.js'

import { defineStore } from 'pinia'

export const usePeerStore = defineStore('peers', {
  state: originalState,
  getters: gettersPeers,
  actions: actionsPeers,
})
