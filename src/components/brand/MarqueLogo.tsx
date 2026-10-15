import React from "react";
import Image from "next/image";

interface MarqueLogoProps {
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  alt?: string;
}

export const MarqueLogo: React.FC<MarqueLogoProps> = ({
  className,
  width = 160,
  height = 65,
  priority = false,
  alt = "Marque Technologies",
}) => {
  return (
    <Image
      src="/marque-logo.png"
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      className={className}
      sizes="(max-width: 640px) 120px, (max-width: 1024px) 150px, 180px"
      style={{ height: "auto", width: "auto" }}
    />
  );
};
