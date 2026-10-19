/**
 * The shapes the panel needs before the contract exists in this branch. They mirror the ones in
 * `@orca/hm-contract` (Me, LoginBody) and will be replaced by imports from it.
 */
export interface Me {
  userId: string;
  userName: string;
}

export interface LoginBody {
  username: string;
  password: string;
}

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
