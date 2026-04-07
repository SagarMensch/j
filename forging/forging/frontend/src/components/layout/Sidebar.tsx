"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AUTH_PROFILE_COOKIE,
  getProfileFromPathname,
  type UserProfile,
} from "@/lib/auth";
import { cn } from "@/lib/utils";

type SidebarItem = {
  name: string;
  icon: string;
  href: string;
};

const profileItems: Record<UserProfile, SidebarItem[]> = {
  analyst: [
    { name: "Review Queue", icon: "manage_search", href: "/analyst/queue" },
    { name: "Forensic Lab", icon: "biotech", href: "/analyst/forensics" },
    {
      name: "Override History",
      icon: "history",
      href: "/analyst/override-history",
    },
  ],
  submitter: [
    {
      name: "My Submissions",
      icon: "inventory_2",
      href: "/submitter/my-submissions",
    },
    { name: "Upload Center", icon: "upload_file", href: "/submitter/upload" },
    {
      name: "Certificates",
      icon: "workspace_premium",
      href: "/submitter/certificates",
    },
  ],
  compliance: [
    {
      name: "Global Overview",
      icon: "dashboard",
      href: "/compliance/overview",
    },
    {
      name: "Audit Log",
      icon: "fact_check",
      href: "/compliance/audit-log",
    },
    {
      name: "Policy Config",
      icon: "policy",
      href: "/compliance/policy-config",
    },
    {
      name: "Reports",
      icon: "lab_profile",
      href: "/compliance/reports",
    },
  ],
  devops: [{ name: "System Health", icon: "hub", href: "/devops/dashboard" }],
};

const bottomItems: SidebarItem[] = [
  { name: "Settings", icon: "settings", href: "#" },
  { name: "Help", icon: "help_outline", href: "#" },
];

function ForensicBrandMark() {
  return (
    <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-[18px] border border-white/8 bg-white/[0.03] shadow-[0_14px_40px_rgba(0,0,0,0.38)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_24%,rgba(86,212,255,0.62),transparent_34%),radial-gradient(circle_at_74%_24%,rgba(80,111,255,0.72),transparent_38%),radial-gradient(circle_at_56%_76%,rgba(255,180,82,0.64),transparent_40%)] blur-[12px]" />
      <div className="absolute inset-[10px] rounded-[14px] bg-[linear-gradient(145deg,rgba(28,40,92,0.86),rgba(7,9,21,0.98))]" />
      <svg
        aria-hidden="true"
        className="relative z-10 h-10 w-10"
        viewBox="0 0 64 64"
      >
        <defs>
          <linearGradient
            id="fingerprint-stroke"
            x1="12"
            x2="52"
            y1="10"
            y2="56"
          >
            <stop offset="0%" stopColor="#6AE2FF" />
            <stop offset="45%" stopColor="#5A6CFF" />
            <stop offset="100%" stopColor="#FFB14A" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" fill="rgba(255,255,255,0.06)" r="25" />
        <path
          d="M23 42c0-6.2 3.9-11.6 9-11.6 5.3 0 9 5.1 9 11.6"
          fill="none"
          stroke="url(#fingerprint-stroke)"
          strokeLinecap="round"
          strokeWidth="3.4"
        />
        <path
          d="M19 38.4c0-9.2 5.4-17 13-17 7.8 0 13 7.6 13 17"
          fill="none"
          stroke="url(#fingerprint-stroke)"
          strokeLinecap="round"
          strokeWidth="3"
        />
        <path
          d="M17.4 28.7C20 20.7 25.6 15.5 32 15.5c6.5 0 12.1 5.2 14.6 13.2"
          fill="none"
          stroke="url(#fingerprint-stroke)"
          strokeLinecap="round"
          strokeWidth="2.8"
        />
        <path
          d="M28.5 24.7c1.3-2 2.3-2.9 3.5-2.9 1.2 0 2.3 0.9 3.4 2.9"
          fill="none"
          stroke="url(#fingerprint-stroke)"
          strokeLinecap="round"
          strokeWidth="2.7"
        />
        <path
          d="M27.3 48.2v-6.8c0-2.8 2.1-5 4.7-5s4.7 2.2 4.7 5v6.8"
          fill="none"
          stroke="#F7FBFF"
          strokeLinecap="round"
          strokeWidth="2.7"
        />
        <circle cx="47.5" cy="18.5" fill="#FFB14A" r="4.5" />
        <path
          d="M45.7 18.5h3.6M47.5 16.7v3.6"
          stroke="#201631"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </svg>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const profile = getProfileFromPathname(pathname) ?? "analyst";
  const items = profileItems[profile];
  const utilityItems =
    profile === "analyst" || profile === "submitter" || profile === "compliance"
      ? []
      : bottomItems;

  const handleLogout = () => {
    document.cookie = `${AUTH_PROFILE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    router.push("/login");
    router.refresh();
  };

  return (
    <aside
      className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col"
      style={{
        background:
          "linear-gradient(180deg, #020202 0%, #07070a 42%, #0c0c10 100%)",
        borderRight: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="border-b border-white/6 px-6 py-6">
        <div className="flex items-center gap-4">
          <ForensicBrandMark />
          <div className="min-w-0">
            <span
              className="block text-[11px] font-bold uppercase tracking-[0.3em]"
              style={{ color: "rgba(255,255,255,0.42)" }}
            >
              Forensic Suite
            </span>
            <span
              className="block truncate text-lg font-bold tracking-[-0.03em] text-white"
              style={{ whiteSpace: "nowrap" }}
            >
              SequelForensics
            </span>
          </div>
        </div>
      </div>

      <div
        className="mx-4 mb-4 mt-6 rounded-full px-4 py-2"
        style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
      >
        <p
          className="text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{ color: "rgba(255,255,255,0.45)" }}
        >
          Active Profile
        </p>
        <p className="text-sm font-bold capitalize text-white">{profile}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <ul className="mt-2 space-y-1">
          {items.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all duration-150",
                    isActive ? "bg-[#1540d6] text-white" : "hover:text-white",
                  )}
                  style={!isActive ? { color: "rgba(255,255,255,0.60)" } : {}}
                  onMouseEnter={(event) => {
                    if (!isActive) {
                      event.currentTarget.style.backgroundColor =
                        "rgba(255,255,255,0.05)";
                    }
                  }}
                  onMouseLeave={(event) => {
                    if (!isActive) {
                      event.currentTarget.style.backgroundColor = "";
                    }
                  }}
                >
                  {isActive ? (
                    <span
                      className="absolute bottom-2 left-0 top-2 w-1 rounded-r-md"
                      style={{ backgroundColor: "#5f86ff" }}
                    />
                  ) : null}

                  <span
                    className="material-symbols-outlined shrink-0 transition-colors"
                    style={{
                      fontSize: "20px",
                      color: isActive ? "#ffffff" : "rgba(255,255,255,0.50)",
                      fontVariationSettings:
                        "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24",
                    }}
                  >
                    {item.icon}
                  </span>

                  <span className="tracking-wide">{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {utilityItems.length > 0 ? (
          <>
            <div
              className="mx-2 my-6"
              style={{
                height: "1px",
                backgroundColor: "rgba(255,255,255,0.08)",
              }}
            />

            <ul className="space-y-1">
              {utilityItems.map((item) => (
                <li key={`bottom-${item.name}`}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-all duration-150"
                    style={{ color: "rgba(255,255,255,0.40)" }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.backgroundColor =
                        "rgba(255,255,255,0.05)";
                      event.currentTarget.style.color = "rgba(255,255,255,0.80)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.backgroundColor = "";
                      event.currentTarget.style.color = "rgba(255,255,255,0.40)";
                    }}
                  >
                    <span
                      className="material-symbols-outlined shrink-0 text-white/50"
                      style={{
                        fontSize: "20px",
                        fontVariationSettings:
                          "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
                      }}
                    >
                      {item.icon}
                    </span>
                    <span>{item.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </nav>

      <div
        className="space-y-3 px-4 py-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
      >
        <button
          className="flex w-full items-center justify-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold text-white transition-colors"
          onClick={handleLogout}
          style={{
            borderColor: "rgba(255,255,255,0.10)",
            backgroundColor: "rgba(255,255,255,0.04)",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.backgroundColor = "rgba(255,255,255,0.10)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.backgroundColor = "rgba(255,255,255,0.04)";
          }}
          type="button"
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: "20px",
              fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
            }}
          >
            logout
          </span>
          <span>Log Out</span>
        </button>
      </div>
    </aside>
  );
}
