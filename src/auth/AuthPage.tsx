import type { ReactNode } from "react";
import { Logo } from "../ui/Logo";

/** The backdrop every screen before home shares: the logo over a dark red glow. */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_50%_-10%,#4a0d14_0%,#1c0508_45%,#090909_100%)] px-4 pt-24 pb-12 sm:px-8">
      <Logo className="absolute top-[calc(2rem+env(safe-area-inset-top))] left-4 sm:left-12" />
      {children}
    </main>
  );
}
