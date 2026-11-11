import { onScopeDispose, ref } from 'vue'

// One interval for the whole app. The seek-undo pill and the markers on the two
// seek bars all need the same "has it expired yet" answer, and a per-component
// timer would let them disagree.
const now = ref(Date.now())
let timer = 0
let users = 0

export function useNow (intervalMs = 500) {
  if (users === 0) {
    now.value = Date.now()
    timer = setInterval(() => { now.value = Date.now() }, intervalMs)
  }
  users += 1

  onScopeDispose(() => {
    users -= 1
    if (users === 0) {
      clearInterval(timer)
      timer = 0
    }
  })

  return now
}
