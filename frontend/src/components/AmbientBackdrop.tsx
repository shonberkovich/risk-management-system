/** Fixed, decorative scene behind the whole app: drifting aurora orbs (with a pure-CSS
 * scroll parallax), a receding 3D perspective grid "floor", a dot field, film grain and
 * a vignette. aria-hidden and pointer-events: none — it never intercepts interaction.
 * All styling lives in ui/spatial.css (.rmis-backdrop*). */
export default function AmbientBackdrop() {
  return (
    <div className="rmis-backdrop" aria-hidden="true">
      <div className="rmis-backdrop__mesh">
        <span className="rmis-orb rmis-orb--violet" />
        <span className="rmis-orb rmis-orb--cyan" />
        <span className="rmis-orb rmis-orb--magenta" />
        <span className="rmis-orb rmis-orb--sky" />
      </div>
      <div className="rmis-backdrop__dots" />
      <div className="rmis-backdrop__floor" />
      <div className="rmis-backdrop__grain" />
      <div className="rmis-backdrop__vignette" />
    </div>
  );
}
