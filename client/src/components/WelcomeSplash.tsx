import { useState, useEffect } from "react";
import { useTenantBranding } from "@/components/TenantBrandingProvider";
import traivoLogo from "@assets/traivo_logo_transparent.png";

interface WelcomeSplashProps {
  onComplete: () => void;
}

function lightenColor(hex: string, amount: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  const r = Math.min(255, parseInt(result[1], 16) + amount);
  const g = Math.min(255, parseInt(result[2], 16) + amount);
  const b = Math.min(255, parseInt(result[3], 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function darkenColor(hex: string, amount: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  const r = Math.max(0, parseInt(result[1], 16) - amount);
  const g = Math.max(0, parseInt(result[2], 16) - amount);
  const b = Math.max(0, parseInt(result[3], 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

const DEFAULT_PRIMARY = "#1B4B6B";
const DEFAULT_ORB1 = "#4A9B9B";
const DEFAULT_ORB2 = "#7DBFB0";

export function WelcomeSplash({ onComplete }: WelcomeSplashProps) {
  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");
  const { branding } = useTenantBranding();

  const hasBrandingConfig = !!(branding && (branding.logoUrl || branding.companyName || branding.tagline));
  const customPrimary = branding?.primaryColor && hasBrandingConfig ? branding.primaryColor : null;
  const gradientStart = customPrimary || DEFAULT_PRIMARY;
  const gradientMid = customPrimary ? darkenColor(customPrimary, 30) : "#2C3E50";

  const orbColor1 = customPrimary ? lightenColor(customPrimary, 40) : DEFAULT_ORB1;
  const orbColor2 = customPrimary ? lightenColor(customPrimary, 60) : DEFAULT_ORB2;

  const customLogo = branding?.logoUrl || null;
  const customName = branding?.companyName || null;
  const displayTagline = branding?.tagline || "Intelligent fältservice";

  useEffect(() => {
    const enterTimer = setTimeout(() => setPhase("visible"), 50);
    const exitTimer = setTimeout(() => setPhase("exit"), 2800);
    const completeTimer = setTimeout(() => onComplete(), 3600);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-opacity duration-700 ease-out ${
        phase === "exit" ? "opacity-0" : phase === "visible" ? "opacity-100" : "opacity-0"
      }`}
      style={{
        background: `linear-gradient(135deg, ${gradientStart} 0%, ${gradientMid} 50%, ${gradientStart} 100%)`,
      }}
      data-testid="welcome-splash"
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className={`absolute -top-32 -right-32 w-96 h-96 rounded-full transition-all ease-out ${
            phase !== "enter" ? "opacity-20 scale-100" : "opacity-0 scale-50"
          }`}
          style={{
            background: `radial-gradient(circle, ${orbColor1} 0%, transparent 70%)`,
            transitionDuration: "2000ms",
          }}
        />
        <div
          className={`absolute -bottom-24 -left-24 w-80 h-80 rounded-full transition-all ease-out delay-300 ${
            phase !== "enter" ? "opacity-15 scale-100" : "opacity-0 scale-50"
          }`}
          style={{
            background: `radial-gradient(circle, ${orbColor2} 0%, transparent 70%)`,
            transitionDuration: "2500ms",
          }}
        />
      </div>

      <div className="relative flex flex-col items-center gap-6">
        <div
          className={`transition-all duration-1000 ease-out ${
            phase !== "enter"
              ? "opacity-100 translate-y-0 scale-100"
              : "opacity-0 translate-y-6 scale-90"
          }`}
        >
          {customLogo ? (
            <img
              src={customLogo}
              alt={customName || "Logo"}
              className="h-24 md:h-32 w-auto object-contain drop-shadow-2xl"
              style={{ filter: "brightness(1.1) contrast(1.05)", maxWidth: "320px" }}
              data-testid="img-splash-logo"
            />
          ) : customName ? (
            <h1
              className="text-4xl md:text-5xl font-bold text-white drop-shadow-2xl tracking-tight"
              data-testid="text-splash-company-name"
            >
              {customName}
            </h1>
          ) : (
            <img
              src={traivoLogo}
              alt="Traivo"
              className="h-24 md:h-32 w-auto object-contain drop-shadow-2xl"
              style={{ filter: "brightness(1.1) contrast(1.05)" }}
              data-testid="img-splash-logo"
            />
          )}
        </div>

        <div
          className={`transition-all duration-1000 ease-out delay-500 ${
            phase !== "enter"
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-4"
          }`}
        >
          <p className="text-white/90 text-lg md:text-xl font-light tracking-wide text-center">
            {displayTagline}
          </p>
        </div>

        <div
          className={`mt-4 transition-all duration-1000 ease-out delay-700 ${
            phase !== "enter"
              ? "opacity-100 scale-x-100"
              : "opacity-0 scale-x-0"
          }`}
        >
          <div className="w-16 h-0.5 rounded-full bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>
      </div>
    </div>
  );
}
