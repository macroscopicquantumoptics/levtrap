/** Where the browser tests find the app and the local engine. */
// the sub-path the app was built for (BASE_PATH at build time); /levtrap/next by default
export const BASE = (process.env.BASE_PATH ?? "/levtrap/next").replace(/\/+$/, "");
export const PORT = 4173;
export const API_PORT = 8765;
export const LOCAL_API = `http://127.0.0.1:${API_PORT}/api`;
