import originalState from './conversations/state.js'
import actionsConversations from './conversations/actions.js'
import gettersConversations from './conversations/getters.js'

import { defineStore } from 'pinia'

export const useConversationsStore = defineStore('conversations', {
  state: originalState,
  getters: gettersConversations,
  actions: actionsConversations,
})
