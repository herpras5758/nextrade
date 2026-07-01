import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider } from "./lib/AuthContext";
import { TenantProvider } from "./store/tenantContext";
import App from "./App";
import "./i18n";
import i18n from "./i18n";
import "./styles/globals.css";

const persistedLanguage = "id";
i18n.changeLanguage(persistedLanguage);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <TenantProvider>
        <App />
      </TenantProvider>
    </AuthProvider>
  </React.StrictMode>
);
