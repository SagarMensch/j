"use client";

import { useEffect } from "react";

export function AutoPrintOnLoad({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handle = window.setTimeout(() => {
      window.print();
    }, 700);

    return () => {
      window.clearTimeout(handle);
    };
  }, [enabled]);

  return null;
}
