import originalState from './community/state.js'
import actionsCommunity from './community/actions.js'
import gettersCommunity from './community/getters.js'

import { defineStore } from 'pinia'

export const useCommunityStore = defineStore('community', {
  state: originalState,
  getters: gettersCommunity,
  actions: actionsCommunity,
})
