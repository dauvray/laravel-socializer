import originalState from './peers2/state.js'
import actionsPeers from './peers2/actions.js'
import gettersPeers from './peers2/getters.js'

import { defineStore } from 'pinia'

export const usePeer2Store = defineStore('peers2', {
  state: originalState,
  getters: gettersPeers,
  actions: actionsPeers,
})
