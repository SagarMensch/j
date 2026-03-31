'use client';

import React from 'react';
import Image from 'next/image';

interface LogoProps {
  variant?: 'full' | 'icon' | 'white';
  size?: 'sm' | 'md' | 'lg';
}

export function Logo({ variant = 'full', size = 'md' }: LogoProps) {
  const sizes = {
    sm: { height: 24 },
    md: { height: 32 },
    lg: { height: 48 },
  };

  const { height } = sizes[size];

  return (
    <Image
      src="/logo.png"
      alt="Jubilant Ingrevia"
      width={height * 2.5}
      height={height}
      className="h-auto w-auto"
      priority
    />
  );
}
