import originalState from './socialUser/state.js'
import actionsUser from './socialUser/actions.js'
import gettersUser from './socialUser/getters.js'

import { defineStore } from 'pinia'

export const useSocialUserStore = defineStore('social-user', {
  state: originalState,
  getters: gettersUser,
  actions: actionsUser,
})
