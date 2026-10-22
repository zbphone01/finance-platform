import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Receipt,
  ListChecks,
  Settings,
  Users,
  LogOut,
  Menu,
  X,
  Landmark,
  FileText,
  ChevronDown,
  ChevronRight,
  Building,
  FolderOpen,
  FileCode,
  HeartHandshake,
  RefreshCw,
  BarChart3,
  FileCheck2,
  KeyRound,
  ClipboardList,
  ShieldCheck,
  BookOpenText,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { trpc } from "@/providers/trpc";
import { getDefaultRolePermissions, type PermissionKey } from "@contracts/permissions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type NavItem = {
  path?: string;
  label: string;
  icon: any;
  children?: { path: string; label: string; icon: any }[];
  permissionKey?: PermissionKey;
  disabled?: boolean;
};

const APP_VERSION = "v10.85";

const navItems: NavItem[] = [
  { path: "/", label: "认账及分账", icon: Receipt },
  { path: "/order-files", label: "订单明细包", icon: FileText },
  { path: "/detail-split-files", label: "明细分账", icon: ListChecks },
  { path: "/results", label: "入账结果", icon: ListChecks },
  { path: "/result-summary", label: "入账汇总", icon: BarChart3, permissionKey: "result_summary_menu_access" },
  { path: "/voucher-results", label: "凭证汇总", icon: FileCheck2 },
  {
    label: "自动认账规则",
    icon: Settings,
    children: [
      { path: "/income-recognition", label: "到账认账", icon: Landmark },
      { path: "/rules", label: "明细认账", icon: ListChecks },
      { path: "/invoice-only-rules", label: "不认账明细", icon: FileText },
      { path: "/rule-updates", label: "同步认账字段", icon: RefreshCw },
    ],
  },
  { path: "/counterparty-summary", label: "到账信息汇总", icon: Landmark },
  {
    label: "认账信息设置",
    icon: Settings,
    permissionKey: "recognition_info_menu_access",
    children: [
      { path: "/settings/departments", label: "部门", icon: Building },
      { path: "/settings/projects", label: "项目", icon: FolderOpen },
      { path: "/settings/fundraising-platforms", label: "公益平台", icon: Landmark },
      { path: "/settings/budget-codes", label: "预算编码", icon: FileCode },
      { path: "/settings/donation-activities", label: "捐赠活动", icon: HeartHandshake },
    ],
  },
  {
    label: "财务凭证信息",
    icon: ClipboardList,
    permissionKey: "financial_voucher_info_menu_access",
    children: [
      { path: "/financial-voucher-info/templates", label: "凭证模板", icon: ClipboardList },
      { path: "/financial-voucher-info/income-channels", label: "收款渠道管理", icon: Landmark },
      { path: "/financial-voucher-info/bank-accounts", label: "银行/到账账号", icon: Landmark },
    ],
  },
  { path: "/operation-guide", label: "操作指引", icon: BookOpenText },
  { path: "/users", label: "管理员功能", icon: Users, permissionKey: "account_management_menu_access" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [twoFactorPromptOpen, setTwoFactorPromptOpen] = useState(false);
  const [twoFactorDismissed, setTwoFactorDismissed] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const utils = trpc.useUtils();
  const permissionsQuery = trpc.permission.current.useQuery(undefined, { enabled: Boolean(user) });
  const rolePermissions = permissionsQuery.data?.permissions || getDefaultRolePermissions(user?.role || "");

  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("密码修改成功");
      setPasswordDialogOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: any) => toast.error(err.message || "密码修改失败"),
  });

  const startTwoFactorSetup = trpc.auth.startTwoFactorSetup.useMutation({
    onSuccess: (data) => {
      setTwoFactorSetup(data);
      setTwoFactorCode("");
    },
    onError: (err: any) => toast.error(err.message || "创建绑定二维码失败"),
  });

  const enableTwoFactor = trpc.auth.enableTwoFactor.useMutation({
    onSuccess: () => {
      toast.success("验证器 App 已绑定");
      setTwoFactorPromptOpen(false);
      setTwoFactorDismissed(true);
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      utils.auth.me.invalidate();
    },
    onError: (err: any) => toast.error(err.message || "绑定失败"),
  });

  useEffect(() => {
    if (user && !user.twoFactorEnabled && !twoFactorDismissed) {
      setTwoFactorPromptOpen(true);
    }
  }, [user, twoFactorDismissed]);

  // 判断哪些一级菜单需要默认展开
  const defaultExpanded = navItems
    .filter((item) =>
      item.children?.some((child) => location.pathname.startsWith(child.path))
    )
    .map((item) => item.label);

  const [expandedMenus, setExpandedMenus] = useState<string[]>(defaultExpanded);

  const toggleMenu = (label: string) => {
    setExpandedMenus((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("请完整填写密码信息");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("新密码至少6位");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    changePassword.mutate({ currentPassword, newPassword });
  };

  const handleIgnoreTwoFactor = () => {
    setTwoFactorDismissed(true);
    setTwoFactorPromptOpen(false);
    setTwoFactorSetup(null);
    setTwoFactorCode("");
  };

  const handleEnableTwoFactor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorSetup) {
      startTwoFactorSetup.mutate();
      return;
    }
    if (!twoFactorCode) {
      toast.error("请输入动态验证码");
      return;
    }
    enableTwoFactor.mutate({ secret: twoFactorSetup.secret, code: twoFactorCode });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Dialog
        open={twoFactorPromptOpen}
        onOpenChange={(open) => {
          setTwoFactorPromptOpen(open);
          if (!open) handleIgnoreTwoFactor();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>绑定验证器 App</DialogTitle>
            <DialogDescription>绑定后，下次登录需要输入验证器 App 中的动态验证码。</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEnableTwoFactor} className="space-y-4">
            {!twoFactorSetup ? (
              <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                可使用 Microsoft Authenticator、Google Authenticator、1Password 等应用。
              </div>
            ) : (
              <>
                <div className="flex justify-center rounded-md border bg-white p-3">
                  <img src={twoFactorSetup.qrCodeDataUrl} alt="验证器绑定二维码" className="h-[220px] w-[220px]" />
                </div>
                <div className="rounded-md border bg-gray-50 p-2 font-mono text-xs text-gray-700 break-all">
                  {twoFactorSetup.secret}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="two-factor-setup-code">动态验证码</Label>
                  <Input
                    id="two-factor-setup-code"
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6 位验证码"
                  />
                </div>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleIgnoreTwoFactor}>
                稍后
              </Button>
              <Button type="submit" disabled={startTwoFactorSetup.isPending || enableTwoFactor.isPending}>
                <ShieldCheck className="mr-1 h-4 w-4" />
                {!twoFactorSetup ? "开始绑定" : enableTwoFactor.isPending ? "验证中..." : "完成绑定"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>请输入原密码，并设置新的登录密码。</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">原密码</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">新密码</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">确认新密码</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPasswordDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={changePassword.isPending}>
                {changePassword.isPending ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } flex flex-col`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <div className="flex items-center gap-2">
            <Landmark className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-sm">财务对账平台</span>
          </div>
          <button className="lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {navItems.filter((item) => !item.permissionKey || user?.role === "admin" || rolePermissions[item.permissionKey]).map((item) => {
            const Icon = item.icon;

            // 有子菜单的一级菜单
            if (item.children) {
              const isExpanded = expandedMenus.includes(item.label);
              const isAnyChildActive = item.children.some((child) =>
                location.pathname === child.path || location.pathname.startsWith(child.path + "/")
              );
              return (
                <div key={item.label}>
                  <button
                    onClick={() => toggleMenu(item.label)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      isAnyChildActive
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-gray-200 pl-2">
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        const isChildActive = location.pathname === child.path || location.pathname.startsWith(child.path + "/");
                        return (
                          <button
                            key={child.path}
                            onClick={() => {
                              if (isChildActive) {
                                setSidebarOpen(false);
                                return;
                              }
                              navigate(child.path);
                              setSidebarOpen(false);
                            }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                              isChildActive
                                ? "bg-blue-50 text-blue-700 font-medium"
                                : "text-gray-600 hover:bg-gray-50"
                            }`}
                          >
                            <ChildIcon className="h-3.5 w-3.5" />
                            {child.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            // 普通一级菜单
            const isActive = item.path ? location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path)) : false;
            return (
              <button
                key={item.path || item.label}
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled || !item.path) return;
                  if (isActive) {
                    setSidebarOpen(false);
                    return;
                  }
                  navigate(item.path);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  item.disabled
                    ? "cursor-not-allowed text-gray-400"
                    : isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-gray-600 truncate">
              {user?.name || user?.username}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPasswordDialogOpen(true)}
                className="text-gray-500 hover:text-blue-600"
                title="修改密码"
                aria-label="修改密码"
              >
                <KeyRound className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-gray-500 hover:text-red-600"
                title="退出登录"
                aria-label="退出登录"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Toaster position="top-right" />
        {/* Top bar */}
        <header className="h-16 flex items-center justify-between gap-3 px-4 border-b border-gray-200 bg-white lg:px-6">
          <button
            className="lg:hidden text-gray-600"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="text-sm text-gray-500">
            当前用户: <span className="font-medium text-gray-700">{user?.name || user?.username}</span>
            {user?.role === "admin" && (
              <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">管理员</span>
            )}
            {user?.role === "operator" && (
              <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-700">运营人员</span>
            )}
            {user?.role === "finance" && (
              <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700">财务人员</span>
            )}
          </div>
          <span className="ml-auto shrink-0 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
            {APP_VERSION}
          </span>
        </header>

        {/* Page content */}
        <main className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
