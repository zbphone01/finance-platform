import { AlertTriangle, CheckCircle, Clock, type LucideIcon } from "lucide-react";

export type RecognitionStatusMeta = {
  label: string;
  color: string;
  icon: LucideIcon;
};

export const recognitionStatusMap: Record<string, RecognitionStatusMeta> = {
  pending_recognition: { label: "待认账", color: "bg-yellow-100 text-yellow-800", icon: Clock },
  pending_details: { label: "待认账", color: "bg-yellow-100 text-yellow-800", icon: Clock },
  processing: { label: "认账执行中", color: "bg-blue-100 text-blue-800", icon: Clock },
  large_variance: { label: "差异大", color: "bg-red-100 text-red-800", icon: AlertTriangle },
  partial_matched: { label: "部分认账", color: "bg-orange-100 text-orange-800", icon: Clock },
  completed: { label: "已完成认账", color: "bg-green-100 text-green-800", icon: CheckCircle },
  failed: { label: "失败", color: "bg-gray-100 text-gray-800", icon: AlertTriangle },
};

export function getRecognitionStatusMeta(status: string | null | undefined) {
  return recognitionStatusMap[String(status || "")] || recognitionStatusMap.failed;
}
