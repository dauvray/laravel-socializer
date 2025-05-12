import originalState from './applicationAI/state.js'
import actionsChat from './applicationAI/actions.js'
import gettersChat from './applicationAI/getters.js'

import { defineStore } from 'pinia'

export const useApplicationAIStore = defineStore('applicationAI', {
  state: originalState,
  getters: gettersChat,
  actions: actionsChat,
})
