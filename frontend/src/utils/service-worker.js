/*
 * Looking up the service worker without hanging.
 *
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
