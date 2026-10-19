import * as z from "zod";

export const LoginBody = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
});
export type LoginBody = z.infer<typeof LoginBody>;

export const Me = z.object({ userId: z.string(), userName: z.string() });
export type Me = z.infer<typeof Me>;
