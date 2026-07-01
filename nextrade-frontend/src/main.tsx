import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider } from "./lib/AuthContext";
import { TenantProvider } from "./store/tenantContext";
import App from "./App";
import "./i18n";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <TenantProvider>
        <App />
      </TenantProvider>
    </AuthProvider>
  </React.StrictMode>
);

