export type ThemeChangeStatus =
  | "PREPARED"
  | "SUBMITTED"
  | "APPLIED"
  | "ROLLBACK_SUBMITTED"
  | "ROLLED_BACK"
  | "CONFLICT"
  | "FAILED";

export type ThemeChangeVerification =
  | "retry-apply"
  | "applied"
  | "pending"
  | "rolled-back"
  | "conflict"
  | "not-pending";

export function canWriteThemeRole(role: string) {
  return role === "UNPUBLISHED" || role === "DEVELOPMENT";
}

export function verifyThemeChangeState(
  status: ThemeChangeStatus,
  currentHash: string,
  sourceHash: string,
  optimizedHash: string,
): ThemeChangeVerification {
  if (status === "PREPARED") {
    if (currentHash === optimizedHash) return "applied";
    if (currentHash === sourceHash) return "retry-apply";
    return "conflict";
  }
  if (status === "SUBMITTED") {
    if (currentHash === optimizedHash) return "applied";
    if (currentHash === sourceHash) return "pending";
    return "conflict";
  }
  if (status === "ROLLBACK_SUBMITTED") {
    if (currentHash === sourceHash) return "rolled-back";
    if (currentHash === optimizedHash) return "pending";
    return "conflict";
  }
  return "not-pending";
}
