import originalState from './chat/state.js'
import actionsChat from './chat/actions.js'
import gettersChat from './chat/getters.js'

import { defineStore } from 'pinia'

export const useChatStore = defineStore('chat', {
  state: originalState,
  getters: gettersChat,
  actions: actionsChat,
})
