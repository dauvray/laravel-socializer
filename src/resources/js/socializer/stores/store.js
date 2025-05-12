import originalState from './store/state.js'
import actionsStore from './store/actions.js'
import gettersStore from './store/getters.js'

import { defineStore } from 'pinia'

export const useStoreStore = defineStore('store', {
  state: originalState,
  getters: gettersStore,
  actions: actionsStore,
})
