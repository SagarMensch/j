"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function KnowledgeBasePage() {
  const router = useRouter();

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).toString();
    router.replace(query ? `/operator?${query}` : "/operator");
  }, [router]);

  return null;
}
