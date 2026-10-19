import { useMemo } from "react";
import { encode } from "uqr";

interface Props {
  value: string;
  className?: string;
}

/**
 * A QR code drawn as one SVG path, dark on white with the quiet zone the standard asks for, so phone
 * cameras read it on any TV whatever the app's colours.
 */
export function QrCode({ value, className }: Props) {
  const { size, path } = useMemo(() => {
    const { size, data } = encode(value, { ecc: "M", border: 2 });
    let path = "";
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size, path };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={value}
      className={className}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
