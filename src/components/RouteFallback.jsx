// Minimal placeholder while a lazy chunk loads. Reuses the existing spinner
// styles so the visual register matches the rest of the app. Shared by App
// and the views that lazy() the builder chunk (was three identical copies).
import { s } from "../ui/styles.js";

const RouteFallback = () => (
  <div style={{ padding: "40px 16px", display: "flex", justifyContent: "center" }}>
    <span style={s.spinner}/>
  </div>
);

export default RouteFallback;
