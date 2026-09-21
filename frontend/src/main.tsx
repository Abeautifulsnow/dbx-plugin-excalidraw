import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installHostListeners } from "./host";
import "./styles.css";

// Registered before the first render so the host's init message cannot arrive
// ahead of the listeners. See host.ts for why this is not done at module scope.
installHostListeners();

createRoot(document.getElementById("root")!).render(<App />);
