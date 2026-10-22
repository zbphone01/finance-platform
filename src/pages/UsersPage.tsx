import { Fragment, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Copy, HardDrive, LockOpen, Pencil, Plus, RotateCcw, Search, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROLE_PERMISSION_ROLE_LABELS, type PermissionKey, type PermissionRole } from "@contracts/permissions";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Label as PieLabel, Pie, PieChart } from "recharts";

type UserRole = "admin" | "operator" | "finance";

const roleMeta: Record<UserRole, { label: string; className: string }> = {
  admin: { label: "管理员", className: "bg-purple-100 text-purple-800" },
  operator: { label: "运营人员", className: "bg-blue-100 text-blue-800" },
  finance: { label: "财务人员", className: "bg-emerald-100 text-emerald-800" },
};

const storageChartConfig = {
  used: {
    label: "已占用",
    color: "#2563eb",
  },
  available: {
    label: "可用",
    color: "#dbeafe",
  },
} satisfies ChartConfig;

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "-";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** unitIndex).toLocaleString("zh-CN", {
    minimumFractionDigits: unitIndex === 0 ? 0 : 2,
    maximumFractionDigits: unitIndex === 0 ? 0 : 2,
  })} ${units[unitIndex]}`;
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDateOnly(value: Date | string | null | undefined) {
  if (!value) return "-";
  if (typeof value === "string") return value.slice(0, 10);
  return value.toLocaleDateString("zh-CN");
}

function SystemInfoPanel() {
  const storageQuery = trpc.systemInfo.storage.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const data = storageQuery.data;
  const snapshot = data?.snapshot;
  const chartData = snapshot ? [
    { name: "used", value: snapshot.usedBytes, fill: "var(--color-used)" },
    { name: "available", value: snapshot.availableBytes, fill: "var(--color-available)" },
  ] : [];

  if (storageQuery.isLoading) {
    return <Card><CardContent className="py-12 text-center text-gray-500">系统信息加载中...</CardContent></Card>;
  }

  if (storageQuery.isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-red-600">
          系统信息加载失败，请确认磁盘快照数据库迁移已执行。
        </CardContent>
      </Card>
    );
  }

  const statusMeta = data?.status === "completed"
    ? { label: "已更新", className: "bg-emerald-100 text-emerald-800" }
    : data?.status === "pending"
      ? { label: "待采集", className: "bg-amber-100 text-amber-800" }
      : data?.status === "capturing"
        ? { label: "采集中", className: "bg-blue-100 text-blue-800" }
        : data?.status === "failed"
          ? { label: "采集失败", className: "bg-red-100 text-red-800" }
          : { label: "暂无数据", className: "bg-gray-100 text-gray-700" };

  return (
    <div className="space-y-4">
      {(data?.status === "pending" || data?.status === "capturing") && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          每日归档任务已发起磁盘采集，当前展示上一次成功快照。
        </div>
      )}
      {data?.status === "failed" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          最新磁盘采集失败，当前展示上一次成功快照。{data.errorMessage ? `失败原因：${data.errorMessage}` : ""}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <HardDrive className="h-4 w-4 text-blue-600" />
                数据盘使用量
              </h2>
              <p className="mt-1 text-sm text-gray-500">每日 bill_details 归档完成后覆盖更新最新快照</p>
            </div>
            <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
          </div>

          {!snapshot ? (
            <div className="py-16 text-center text-gray-400">
              暂无磁盘使用量快照，完成数据库迁移并等待下一次每日归档。
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(320px,460px)_1fr] lg:items-center">
              <ChartContainer config={storageChartConfig} className="mx-auto h-[300px] w-full max-w-[460px] aspect-auto">
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        hideLabel
                        formatter={(value, name) => (
                          <div className="flex min-w-[140px] items-center justify-between gap-4">
                            <span className="text-gray-500">
                              {storageChartConfig[name as keyof typeof storageChartConfig]?.label || String(name)}
                            </span>
                            <span className="font-mono font-medium text-gray-900">{formatBytes(Number(value))}</span>
                          </div>
                        )}
                      />
                    }
                  />
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={78}
                    outerRadius={118}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    <PieLabel
                      content={({ viewBox }) => {
                        if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;
                        return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                            <tspan x={viewBox.cx} y={viewBox.cy} className="fill-gray-900 text-3xl font-semibold">
                              {snapshot.usagePercent.toFixed(2)}%
                            </tspan>
                            <tspan x={viewBox.cx} y={Number(viewBox.cy) + 26} className="fill-gray-500 text-xs">
                              已占用
                            </tspan>
                          </text>
                        );
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>

              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border bg-gray-50 p-4">
                    <p className="text-sm text-gray-500">总容量</p>
                    <p className="mt-2 text-xl font-semibold">{formatBytes(snapshot.totalBytes)}</p>
                  </div>
                  <div className="rounded-lg border bg-blue-50 p-4">
                    <p className="text-sm text-blue-700">已占用</p>
                    <p className="mt-2 text-xl font-semibold text-blue-800">{formatBytes(snapshot.usedBytes)}</p>
                  </div>
                  <div className="rounded-lg border bg-emerald-50 p-4">
                    <p className="text-sm text-emerald-700">可用</p>
                    <p className="mt-2 text-xl font-semibold text-emerald-800">{formatBytes(snapshot.availableBytes)}</p>
                  </div>
                </div>

                <div className="grid gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
                  <div><span className="text-gray-500">统计路径：</span><span className="font-mono">{snapshot.mountPath}</span></div>
                  <div><span className="text-gray-500">统计时间：</span>{formatDateTime(snapshot.capturedAt)}</div>
                  <div><span className="text-gray-500">快照日期：</span>{formatDateOnly(snapshot.snapshotDate)}</div>
                  <div><span className="text-gray-500">对应归档日期：</span>{formatDateOnly(snapshot.archiveDate)}</div>
                </div>
                <p className="text-xs text-gray-400">“已占用”按总容量减去普通用户可用容量计算，包含文件系统保留空间。</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editRole, setEditRole] = useState<UserRole>("operator");
  const [editIsActive, setEditIsActive] = useState(true);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordUser, setResetPasswordUser] = useState("");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sectionTab, setSectionTab] = useState("account-management");
  const [activeTab, setActiveTab] = useState("accounts");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("operator");

  const utils = trpc.useUtils();
  const usersQuery = trpc.user.list.useQuery(
    { search: searchQuery || undefined, pageSize: 100 },
    { enabled: sectionTab === "account-management" },
  );
  const permissionsQuery = trpc.permission.list.useQuery(undefined, {
    enabled: sectionTab === "account-management" && currentUser?.role === "admin",
  });
  const createUser = trpc.user.create.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
      setCreateOpen(false);
      resetForm();
      toast.success("账号已创建");
    },
    onError: (err: any) => toast.error(err.message || "创建失败"),
  });
  const deleteUser = trpc.user.delete.useMutation({
    onSuccess: () => utils.user.list.invalidate(),
  });
  const updateUser = trpc.user.update.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
      toast.success("账号已更新");
    },
    onError: (err: any) => toast.error(err.message || "更新失败"),
  });
  const unlockUser = trpc.user.unlock.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
      toast.success("账号已解锁");
    },
    onError: (err: any) => toast.error(err.message || "解锁失败"),
  });
  const resetTwoFactor = trpc.user.resetTwoFactor.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
      toast.success("验证器绑定已重置");
    },
    onError: (err: any) => toast.error(err.message || "重置失败"),
  });
  const updatePermission = trpc.permission.update.useMutation({
    onMutate: async (variables) => {
      await utils.permission.list.cancel();
      const previous = utils.permission.list.getData();
      if (previous) {
        utils.permission.list.setData(undefined, {
          ...previous,
          matrix: {
            ...previous.matrix,
            [variables.role]: {
              ...previous.matrix[variables.role],
              [variables.permissionKey]: variables.allowed,
            },
          },
        });
      }
      return { previous };
    },
    onError: (err: any, _variables, context) => {
      if (context?.previous) utils.permission.list.setData(undefined, context.previous);
      toast.error(err.message || "权限保存失败");
    },
    onSuccess: () => toast.success("权限已保存"),
    onSettled: () => {
      utils.permission.list.invalidate();
      utils.permission.current.invalidate();
    },
  });

  function resetForm() {
    setUsername("");
    setPassword("");
    setName("");
    setRole("operator");
  }

  const handleSubmit = () => {
    if (!username || !password || !name) return;
    createUser.mutate({ username, password, name, role });
  };

  const handleDelete = async (id: number) => {
    if (confirm("确定删除此账号？此操作不可撤销。")) {
      await deleteUser.mutateAsync({ id });
    }
  };

  const openEdit = (u: any) => {
    setEditingUser(u);
    setEditRole((u.role as UserRole) || "operator");
    setEditIsActive(Boolean(u.isActive));
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    await updateUser.mutateAsync({
      id: Number(editingUser.id),
      role: editRole,
      isActive: editIsActive,
    });
    setEditOpen(false);
    setEditingUser(null);
  };

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let value = "";
    const bytes = new Uint32Array(6);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) value += chars[byte % chars.length];
    return value;
  };

  const handleResetPassword = async () => {
    if (!editingUser) return;
    const newPassword = generatePassword();
    await updateUser.mutateAsync({ id: Number(editingUser.id), password: newPassword });
    setResetPasswordValue(newPassword);
    setResetPasswordUser(editingUser.username);
    setResetPasswordOpen(true);
  };

  const handleUnlock = async (id: number) => {
    await unlockUser.mutateAsync({ id });
  };

  const handleResetTwoFactor = async (id: number) => {
    if (confirm("确定重置此账号的验证器绑定？该账号下次登录后可重新绑定。")) {
      await resetTwoFactor.mutateAsync({ id });
    }
  };

  const writeClipboardText = async (value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Fall back for embedded browsers that block the Clipboard API.
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  };

  const copyResetPassword = async () => {
    if (await writeClipboardText(resetPasswordValue)) {
      toast.success("密码已复制");
      return;
    }
    toast.error("复制失败，请手动复制");
  };

  const users = usersQuery.data?.items || [];
  const permissionRoles = permissionsQuery.data?.roles || [];
  const permissionGroups = permissionsQuery.data?.groups || [];

  const handlePermissionChange = (role: PermissionRole, permissionKey: PermissionKey, allowed: boolean) => {
    updatePermission.mutate({ role, permissionKey, allowed });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-3">
          <h1 className="text-xl font-semibold">管理员功能</h1>
          <Tabs value={sectionTab} onValueChange={setSectionTab}>
            <TabsList className="grid w-[260px] grid-cols-2">
              <TabsTrigger value="account-management">账号管理</TabsTrigger>
              <TabsTrigger value="system-info">系统信息</TabsTrigger>
            </TabsList>
          </Tabs>
          {sectionTab === "account-management" && (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="accounts">账号</TabsTrigger>
                {currentUser?.role === "admin" && <TabsTrigger value="permissions">权限管理</TabsTrigger>}
              </TabsList>
            </Tabs>
          )}
        </div>
        {sectionTab === "account-management" && activeTab === "accounts" && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" />新建账号</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>新建账号</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>用户名 <span className="text-red-500">*</span></Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="3-50位字符" />
                </div>
                <div className="space-y-2">
                  <Label>密码 <span className="text-red-500">*</span></Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少6位" />
                </div>
                <div className="space-y-2">
                  <Label>姓名 <span className="text-red-500">*</span></Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>角色 <span className="text-red-500">*</span></Label>
                  <Select value={role} onValueChange={(v: UserRole) => setRole(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">管理员</SelectItem>
                      <SelectItem value="operator">运营人员</SelectItem>
                      <SelectItem value="finance">财务人员</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
                <Button onClick={handleSubmit} disabled={createUser.isPending}>
                  {createUser.isPending ? "创建中..." : "创建"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {sectionTab === "account-management" ? (
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsContent value="accounts" className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="搜索用户名或姓名" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
            <Button variant="outline" onClick={() => setSearchQuery(search)}>
              <Search className="h-4 w-4 mr-1" />搜索
            </Button>
            <Button variant="ghost" onClick={() => { setSearch(""); setSearchQuery(""); }}>重置</Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>用户名</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>验证器</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersQuery.isLoading ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8">加载中...</TableCell></TableRow>
                  ) : users.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">暂无数据</TableCell></TableRow>
                  ) : users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono text-xs">{u.id}</TableCell>
                      <TableCell className="font-medium">{u.username}</TableCell>
                      <TableCell>{u.name || "-"}</TableCell>
                      <TableCell>
                        <Badge className={(roleMeta[u.role as UserRole] || roleMeta.operator).className}>
                          {(roleMeta[u.role as UserRole] || roleMeta.operator).label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.lockedAt ? (
                          <Badge className="bg-red-100 text-red-800">已锁定</Badge>
                        ) : (
                          <Badge className={u.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
                            {u.isActive ? "正常" : "停用"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={u.twoFactorEnabled ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800"}>
                          {u.twoFactorEnabled ? "已绑定" : "未绑定"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {currentUser?.role === "admin" && u.lockedAt && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleUnlock(Number(u.id))}
                              disabled={unlockUser.isPending}
                              title="解锁"
                              aria-label="解锁"
                            >
                              <LockOpen className="h-3 w-3" />
                            </Button>
                          )}
                          {currentUser?.role === "admin" && u.twoFactorEnabled && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleResetTwoFactor(Number(u.id))}
                              disabled={resetTwoFactor.isPending}
                              title="重置验证器"
                              aria-label="重置验证器"
                            >
                              <ShieldOff className="h-3 w-3" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => openEdit(u)} title="编辑" aria-label="编辑">
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleDelete(u.id)} title="删除" aria-label="删除">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {currentUser?.role === "admin" && (
          <TabsContent value="permissions">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>权限</TableHead>
                      {permissionRoles.map((item) => (
                        <TableHead key={item.role} className="w-40 text-center">{item.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {permissionsQuery.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={permissionRoles.length + 1} className="py-8 text-center">加载中...</TableCell>
                      </TableRow>
                    ) : permissionGroups.map((group) => (
                      <Fragment key={group.label}>
                        <TableRow className="bg-slate-50 hover:bg-slate-50">
                          <TableCell colSpan={permissionRoles.length + 1} className="py-2 text-sm font-semibold text-slate-700">
                            {group.label}
                          </TableCell>
                        </TableRow>
                        {group.permissions.map((permission) => (
                          <TableRow key={permission.key}>
                            <TableCell className="font-medium">{permission.label}</TableCell>
                            {permissionRoles.map((item) => {
                              const roleKey = item.role as PermissionRole;
                              return (
                                <TableCell key={item.role} className="text-center">
                                  <Checkbox
                                    checked={Boolean(permissionsQuery.data?.matrix[roleKey]?.[permission.key])}
                                    disabled={updatePermission.isPending}
                                    aria-label={`${permission.label}-${ROLE_PERMISSION_ROLE_LABELS[roleKey]}`}
                                    onCheckedChange={(checked) => handlePermissionChange(roleKey, permission.key, checked === true)}
                                  />
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
      ) : (
        <SystemInfoPanel />
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑账号</DialogTitle>
            <DialogDescription>{editingUser?.username} {editingUser?.name ? `（${editingUser.name}）` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>角色</Label>
              <Select
                value={editRole}
                onValueChange={(v: UserRole) => setEditRole(v)}
                disabled={Number(editingUser?.id || 0) === currentUser?.id}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">管理员</SelectItem>
                  <SelectItem value="operator">运营人员</SelectItem>
                  <SelectItem value="finance">财务人员</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>状态</Label>
              <Select
                value={editIsActive ? "active" : "inactive"}
                onValueChange={(v) => setEditIsActive(v === "active")}
                disabled={Number(editingUser?.id || 0) === currentUser?.id}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">正常</SelectItem>
                  <SelectItem value="inactive">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="mb-2 text-sm text-amber-800">重置密码会生成随机 6 位英文数字混合密码。</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetPassword}
                disabled={updateUser.isPending || !editingUser}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />重置密码
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleSaveEdit} disabled={updateUser.isPending}>
              {updateUser.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>密码已重置</DialogTitle>
            <DialogDescription>账号 {resetPasswordUser} 的新密码如下，请及时告知使用人。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-gray-50 p-3">
            <div className="flex-1 font-mono text-lg font-semibold tracking-wider">{resetPasswordValue}</div>
            <Button variant="outline" size="sm" onClick={copyResetPassword}>
              <Copy className="mr-1 h-3.5 w-3.5" />复制
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setResetPasswordOpen(false)}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
