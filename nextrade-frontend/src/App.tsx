import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { Suspense } from "react";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthGuard } from "./lib/AuthContext";
import { LoginPage } from "./modules/auth/LoginPage";
import { DashboardPage } from "./modules/dashboard/DashboardPage";
import { DocumentsPage } from "./modules/documents/DocumentsPage";
import { IdpStudioPage } from "./modules/idp-studio/IdpStudioPage";
import { ReviewQueuePage } from "./modules/review-queue/ReviewQueuePage";
import { Bc23WorkflowPage } from "./modules/bc23/Bc23WorkflowPage";
import { AdminPanel } from "./modules/settings/AdminPanel";
import { UploadWorkflowPage } from "./modules/upload-workflow/UploadWorkflowPage";
import { ComingSoonPage } from "./components/layout/ComingSoonPage";
import { EvidenceTimeline } from "./components/ui/EvidenceTimeline";

function Loading() {
  return <div className="flex h-screen items-center justify-center text-surface-muted text-sm">Memuat...</div>;
}

function EvidenceTimelinePage() {
  const params = new URLSearchParams(window.location.search);
  const entityId = params.get("entity_id") ?? undefined;
  return (
    <div className="page-container">
      <div className="mb-5">
        <h1 className="page-title">Evidence Timeline</h1>
        <p className="page-subtitle">Riwayat kronologis semua kejadian</p>
      </div>
      <div className="card p-4">
        <EvidenceTimeline entityId={entityId} limit={100} />
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
            <Route index element={<DashboardPage />} />
            <Route path="/upload" element={<UploadWorkflowPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/idp-studio/:id" element={<IdpStudioPage />} />
            <Route path="/bc23" element={<Bc23WorkflowPage />} />
            <Route path="/bc23/:shipmentId" element={<Bc23WorkflowPage />} />
            <Route path="/review-queue" element={<ReviewQueuePage />} />
            <Route path="/settings" element={<AdminPanel />} />
            <Route path="/evidence-timeline" element={<EvidenceTimelinePage />} />
            <Route path="/audit-trail" element={<EvidenceTimelinePage />} />
            <Route path="/trade-intelligence" element={<ComingSoonPage moduleKey="tradeIntelligence" />} />
            <Route path="/compliance" element={<ComingSoonPage moduleKey="compliance" />} />
            <Route path="/evidence-registry" element={<ComingSoonPage moduleKey="evidenceRegistry" />} />
            <Route path="/ceisa-mapping" element={<ComingSoonPage moduleKey="ceisaMapping" />} />
            <Route path="/erp" element={<ComingSoonPage moduleKey="erp" />} />
            <Route path="/it-inventory" element={<ComingSoonPage moduleKey="itInventory" />} />
            <Route path="/email-intake" element={<ComingSoonPage moduleKey="emailIntake" />} />
            <Route path="/analytics" element={<ComingSoonPage moduleKey="analytics" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </Router>
  );
}
