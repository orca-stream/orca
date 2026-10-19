import * as z from "zod";

export const LoginBody = z.object({ username: z.string().min(1), password: z.string().min(1) });
export type LoginBody = z.infer<typeof LoginBody>;

export const Me = z.object({ userId: z.string(), userName: z.string() });
export type Me = z.infer<typeof Me>;
