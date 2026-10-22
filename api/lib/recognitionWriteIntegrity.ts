export const RECOGNITION_DETAILS_CHANGED_MESSAGE =
  "订单明细在认账期间发生变化，本次入账结果已回滚，请刷新后重试";

// MySQL 8.0 can choose an index_merge intersection for the incremental
// detail-split UPDATE and then report zero changed rows even though the same
// predicate finds rows. Keep this existing, narrow index as the deterministic
// write path; do not add another bill_details index for this case.
export const DETAIL_SPLIT_RECOGNITION_WRITE_INDEX =
  "bd_rule_detail_split_status_idx";

export function summarizeRecognitionWriteCoverage(
  assignments: Array<{ detailCount: number | null | undefined }>,
  actualUpdatedDetailCount: number,
) {
  const expectedDetailCount = assignments.reduce(
    (sum, assignment) => sum + Number(assignment.detailCount || 0),
    0,
  );
  const updatedDetailCount = Number(actualUpdatedDetailCount || 0);
  return {
    expectedDetailCount,
    updatedDetailCount,
    isComplete: expectedDetailCount === updatedDetailCount,
  };
}
