import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { Suspense } from "react";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthGuard } from "./lib/AuthContext";
import { LoginPage } from "./modules/auth/LoginPage";
import { DashboardPage } from "./modules/dashboard/DashboardPage";
import { UploadPage } from "./modules/upload/UploadPage";
import { DocumentsPage } from "./modules/documents/DocumentsPage";
import { ResolutionsPage } from "./modules/resolutions/ResolutionsPage";
import { ShipmentsPage } from "./modules/shipments/ShipmentsPage";
import { AdminPanel } from "./modules/settings/AdminPanel";
import { ComingSoonPage } from "./components/layout/ComingSoonPage";

function Loading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-[#6B778C]">
        <div className="h-4 w-4 rounded-full border-2 border-[#0EA5A4] border-t-transparent animate-spin" />
        Memuat...
      </div>
    </div>
  );
}

function ProtectedLayout() {
  return (
    <AuthGuard>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </AuthGuard>
  );
}

export default function App() {
  return (
    <Router>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/resolutions" element={<ResolutionsPage />} />
            <Route path="/shipments" element={<ShipmentsPage />} />
            <Route path="/analytics" element={<ComingSoonPage />} />
            <Route path="/settings" element={<AdminPanel />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}
