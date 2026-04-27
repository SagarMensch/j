"use client";

import React from "react";
import Image from "next/image";

interface LogoProps {
  variant?: "full" | "icon" | "white";
  size?: "sm" | "md" | "lg";
  withBackdrop?: boolean;
}

export function Logo({
  variant = "full",
  size = "md",
  withBackdrop = true,
}: LogoProps) {
  const sizeMap = {
    sm: {
      image: 52,
      title: "text-[13px]",
      subtitle: "text-[10px]",
      gap: "gap-1.5",
      padding: "px-1.5 py-1",
    },
    md: {
      image: 70,
      title: "text-base",
      subtitle: "text-[11px]",
      gap: "gap-2.5",
      padding: "px-2 py-1.5",
    },
    lg: {
      image: 96,
      title: "text-lg",
      subtitle: "text-xs",
      gap: "gap-3",
      padding: "px-2.5 py-2",
    },
  } as const;

  const palette =
    variant === "white"
      ? {
          title: "text-white",
          subtitle: "text-white/75",
          card: "border-white/18 bg-[rgba(255,255,255,0.12)]",
        }
      : {
          title: "text-foreground",
          subtitle: "text-muted",
          card: "border-border bg-[rgba(239,242,243,0.85)]",
        };

  const currentSize = sizeMap[size];

  const imageNode = (
    <Image
      src="/brand/jubilantingrevia-logo.jpg"
      alt="Jubilant Ingrevia"
      width={currentSize.image}
      height={currentSize.image}
      className="h-auto w-auto object-contain"
    />
  );

  if (variant === "icon") {
    return (
      <div
        className={`inline-flex items-center justify-center rounded-[9px] border ${palette.card} ${currentSize.padding} ${withBackdrop ? "backdrop-blur-sm" : "bg-transparent border-transparent p-0"}`}
      >
        {imageNode}
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center rounded-[10px] border ${palette.card} ${currentSize.padding} ${withBackdrop ? "backdrop-blur-sm" : "bg-transparent border-transparent p-0"} ${currentSize.gap}`}
    >
      {imageNode}
      <div className="leading-tight">
        <p
          className={`${currentSize.title} font-bold tracking-[-0.01em] ${palette.title}`}
        >
          Plant Assistant
        </p>
      </div>
    </div>
  );
}
