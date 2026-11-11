/** Re-raisse le routage vers la vue courante (utilisé après des opérations qui reconstruisent). */
export function reroute() {
  window.dispatchEvent(new CustomEvent('reviz:reroute'));
}
