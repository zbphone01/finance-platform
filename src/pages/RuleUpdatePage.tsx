import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

function formatTime(value: string | Date) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function RuleUpdatePage() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const utils = trpc.useUtils();
  const listQuery = trpc.ruleUpdate.list.useQuery();
  const runMutation = trpc.ruleUpdate.run.useMutation({
    onSuccess: (result) => {
      toast.success(`认账字段同步完成：到账认账 ${result.incomeUpdatedCount}/${result.incomeTotalCount}，明细认账 ${result.detailUpdatedCount}/${result.detailTotalCount}`);
      utils.ruleUpdate.list.invalidate();
      setConfirmOpen(false);
    },
    onError: (err: any) => toast.error(err.message || "同步认账字段失败"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">同步认账字段</h1>
        <Button
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => setConfirmOpen(true)}
          disabled={runMutation.isPending}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${runMutation.isPending ? "animate-spin" : ""}`} />
          手动同步
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>操作账号</TableHead>
                <TableHead>到账认账同步（同步条数/总条数）</TableHead>
                <TableHead>明细认账同步（同步条数/总条数）</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-gray-500">加载中...</TableCell>
                </TableRow>
              ) : listQuery.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-gray-400">暂无同步记录</TableCell>
                </TableRow>
              ) : (
                listQuery.data?.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{formatTime(item.createdAt)}</TableCell>
                    <TableCell>{item.operatorName}</TableCell>
                    <TableCell>{item.incomeUpdatedCount}/{item.incomeTotalCount}</TableCell>
                    <TableCell>{item.detailUpdatedCount}/{item.detailTotalCount}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认同步认账字段？</AlertDialogTitle>
            <AlertDialogDescription>
              系统会根据当前预算明细内容和平台项目名称，同步已建立规则中的分账字段。该操作会写入同步记录，是否继续？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={runMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
              {runMutation.isPending ? "同步中..." : "继续操作"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
