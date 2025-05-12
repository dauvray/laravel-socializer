import originalState from './wall/state.js'
import actionsWall from './wall/actions.js'
import gettersWall from './wall/getters.js'

import { defineStore } from 'pinia'

export const useWallStore = defineStore('wall', {
  state: originalState,
  getters: gettersWall,
  actions: actionsWall,
})
