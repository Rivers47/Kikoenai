/*
 * Looking up the service worker without hanging.
 *
 * `navigator.serviceWorker.ready` only settles once a worker is *active*, so
 * with none registered it stays pending forever -- no resolve, no reject, no
 * timeout. Every caller that awaited it inherited that: a whole-work download
 * showed a spinner that never stopped, the outbox blocked on registering a sync,
 * and reconcile-on-boot silently never ran.
 *
 * That is not a hypothetical. `npm run dev` unregisters the worker outright
 * (src-pwa/register-service-worker.js), a plain-HTTP origin registers none, and
 * a registration can simply fail.
 */

/**
 * The active registration, or null. Never hangs: getRegistration() resolves with
 * undefined when there is nothing registered.
 */
export async function activeRegistration () {
  if (!('serviceWorker' in navigator)) return null
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    return registration && registration.active ? registration : null
  } catch (err) {
    console.error('service worker lookup failed:', err)
    return null
  }
}
