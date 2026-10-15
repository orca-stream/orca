/** orca's wordmark, in Netflix's red. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <p
      className={`text-[28px] leading-none font-black tracking-tight text-[#e50914] uppercase sm:text-[26px] ${className}`}
    >
      orca
    </p>
  );
}
