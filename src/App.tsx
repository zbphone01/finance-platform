import { lazy, Suspense, type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import Login from "./pages/Login";
import Layout from "./components/Layout";
import { getDefaultRolePermissions, type PermissionKey } from "@contracts/permissions";

const RecognitionPage = lazy(() => import("./pages/RecognitionPage"));
const IgnoredOrderDetailsPage = lazy(() => import("./pages/IgnoredOrderDetailsPage"));
const OrderFilesPage = lazy(() => import("./pages/OrderFilesPage"));
const OrderFileDetailPage = lazy(() => import("./pages/OrderFileDetailPage"));
const DetailSplitFilesPage = lazy(() => import("./pages/DetailSplitFilesPage"));
const DetailSplitFileDetailPage = lazy(() => import("./pages/DetailSplitFileDetailPage"));
const ResultsPage = lazy(() => import("./pages/ResultsPage"));
const RecognitionResultEditPage = lazy(() => import("./pages/RecognitionResultEditPage"));
const ResultSummaryPage = lazy(() => import("./pages/ResultSummaryPage"));
const VoucherResultsPage = lazy(() => import("./pages/VoucherResultsPage"));
const VoucherResultDetailPage = lazy(() => import("./pages/VoucherResultDetailPage"));
const FinancialVoucherInfoPage = lazy(() => import("./pages/FinancialVoucherInfoPage"));
const IncomeChannelManagementPage = lazy(() => import("./pages/IncomeChannelManagementPage"));
const BankAccountManagementPage = lazy(() => import("./pages/BankAccountManagementPage"));
const RulesPage = lazy(() => import("./pages/RulesPage"));
const RuleViewPage = lazy(() => import("./pages/RuleViewPage"));
const RuleCreatePage = lazy(() => import("./pages/RuleCreatePage"));
const RuleItemEditPage = lazy(() => import("./pages/RuleItemEditPage"));
const TaskDetailPage = lazy(() => import("./pages/TaskDetailPage"));
const ManualDetailRecognitionPage = lazy(() => import("./pages/ManualDetailRecognitionPage"));
const IncomeRecognitionPage = lazy(() => import("./pages/IncomeRecognitionPage"));
const IncomeRuleViewPage = lazy(() => import("./pages/IncomeRuleViewPage"));
const CounterpartySummaryPage = lazy(() => import("./pages/CounterpartySummaryPage"));
const DepartmentPage = lazy(() => import("./pages/DepartmentPage"));
const ProjectSettingsPage = lazy(() => import("./pages/ProjectSettingsPage"));
const BudgetCodePage = lazy(() => import("./pages/BudgetCodePage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const DonationActivityPage = lazy(() => import("./pages/DonationActivityPage"));
const ManualRecognitionPage = lazy(() => import("./pages/ManualRecognitionPage"));
const FundraisingPlatformPage = lazy(() => import("./pages/FundraisingPlatformPage"));
const RuleUpdatePage = lazy(() => import("./pages/RuleUpdatePage"));
const InvoiceOnlyRulesPage = lazy(() => import("./pages/InvoiceOnlyRulesPage"));
const OperationGuidePage = lazy(() => import("./pages/OperationGuidePage"));

function PageFallback() {
  return <div className="py-8 text-gray-500">加载中...</div>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout><Suspense fallback={<PageFallback />}>{children}</Suspense></Layout>;
}

function PermissionRoute({ permissionKey, children }: { permissionKey: PermissionKey; children: ReactNode }) {
  const { user } = useAuth();
  const permissionsQuery = trpc.permission.current.useQuery(undefined, { enabled: Boolean(user) });
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <>{children}</>;
  if (permissionsQuery.isLoading) return <PageFallback />;
  const permissions = permissionsQuery.data?.permissions || getDefaultRolePermissions(user.role);
  if (!permissions[permissionKey]) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <RecognitionPage />
          </RequireAuth>
        }
      />
      <Route
        path="/order-files"
        element={
          <RequireAuth>
            <OrderFilesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/ignored-order-details"
        element={
          <RequireAuth>
            <IgnoredOrderDetailsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/order-files/:id"
        element={
          <RequireAuth>
            <OrderFileDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/detail-split-files"
        element={
          <RequireAuth>
            <DetailSplitFilesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/detail-split-files/:id"
        element={
          <RequireAuth>
            <DetailSplitFileDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/results"
        element={
          <RequireAuth>
            <ResultsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/results/:id/edit"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="recognition_result_edit">
              <RecognitionResultEditPage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/result-summary"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="result_summary_menu_access">
              <ResultSummaryPage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/voucher-results"
        element={
          <RequireAuth>
            <VoucherResultsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/voucher-results/:flowId"
        element={
          <RequireAuth>
            <VoucherResultDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/financial-voucher-info"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="financial_voucher_info_menu_access">
              <Navigate to="/financial-voucher-info/templates" replace />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/financial-voucher-info/templates"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="financial_voucher_info_menu_access">
              <FinancialVoucherInfoPage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/financial-voucher-info/income-channels"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="financial_voucher_info_menu_access">
              <IncomeChannelManagementPage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/financial-voucher-info/bank-accounts"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="financial_voucher_info_menu_access">
              <BankAccountManagementPage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/rules"
        element={
          <RequireAuth>
            <RulesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/income-recognition"
        element={
          <RequireAuth>
            <IncomeRecognitionPage />
          </RequireAuth>
        }
      />
      <Route
        path="/income-recognition/:id"
        element={
          <RequireAuth>
            <IncomeRuleViewPage />
          </RequireAuth>
        }
      />
      <Route
        path="/rule-updates"
        element={
          <RequireAuth>
            <RuleUpdatePage />
          </RequireAuth>
        }
      />
      <Route
        path="/invoice-only-rules"
        element={
          <RequireAuth>
            <InvoiceOnlyRulesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/rules/:ruleId/items/:itemId/edit"
        element={
          <RequireAuth>
            <RuleItemEditPage />
          </RequireAuth>
        }
      />
      <Route
        path="/rules/:id"
        element={
          <RequireAuth>
            <RuleViewPage />
          </RequireAuth>
        }
      />
      <Route
        path="/rules/edit/:id"
        element={
          <RequireAuth>
            <RuleCreatePage />
          </RequireAuth>
        }
      />
      <Route
        path="/rules/new"
        element={
          <RequireAuth>
            <RuleCreatePage />
          </RequireAuth>
        }
      />
      <Route
        path="/tasks/:taskId/details/:detailId/manual-recognition"
        element={
          <RequireAuth>
            <ManualDetailRecognitionPage />
          </RequireAuth>
        }
      />
      <Route
        path="/tasks/:id"
        element={
          <RequireAuth>
            <TaskDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/counterparty-summary"
        element={
          <RequireAuth>
            <CounterpartySummaryPage />
          </RequireAuth>
        }
      />
      <Route
        path="/operation-guide"
        element={
          <RequireAuth>
            <OperationGuidePage />
          </RequireAuth>
        }
      />
      <Route
        path="/users"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="account_management_menu_access">
              <UsersPage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/settings/departments"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="recognition_info_menu_access">
              <DepartmentPage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/settings/projects"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="recognition_info_menu_access">
              <ProjectSettingsPage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/settings/budget-codes"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="recognition_info_menu_access">
              <BudgetCodePage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/settings/fundraising-platforms"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="recognition_info_menu_access">
              <FundraisingPlatformPage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/settings/donation-activities"
        element={
          <RequireAuth>
            <PermissionRoute permissionKey="recognition_info_menu_access">
              <DonationActivityPage />
            </PermissionRoute>
          </RequireAuth>
        }
      />
      <Route
        path="/tasks/:taskId/flows/:flowId/recognize"
        element={
          <RequireAuth>
            <ManualRecognitionPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
