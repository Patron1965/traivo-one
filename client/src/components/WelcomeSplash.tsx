import { useState, useEffect } from "react";
import traivoLogo from "@assets/traivo_logo_transparent.png";

interface WelcomeSplashProps {
  onComplete: () => void;
}

export function WelcomeSplash({ onComplete }: WelcomeSplashProps) {
  const [phase, setPhase] = useState<"enter" | "visible" | "exit">("enter");

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
        background: "linear-gradient(135deg, #1B4B6B 0%, #2C3E50 50%, #1B4B6B 100%)",
      }}
      data-testid="welcome-splash"
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className={`absolute -top-32 -right-32 w-96 h-96 rounded-full transition-all ease-out ${
            phase !== "enter" ? "opacity-20 scale-100" : "opacity-0 scale-50"
          }`}
          style={{
            background: "radial-gradient(circle, #4A9B9B 0%, transparent 70%)",
            transitionDuration: "2000ms",
          }}
        />
        <div
          className={`absolute -bottom-24 -left-24 w-80 h-80 rounded-full transition-all ease-out delay-300 ${
            phase !== "enter" ? "opacity-15 scale-100" : "opacity-0 scale-50"
          }`}
          style={{
            background: "radial-gradient(circle, #7DBFB0 0%, transparent 70%)",
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
          <img
            src={traivoLogo}
            alt="Traivo"
            className="h-24 md:h-32 w-auto object-contain drop-shadow-2xl"
            style={{ filter: "brightness(1.1) contrast(1.05)" }}
            data-testid="img-splash-logo"
          />
        </div>

        <div
          className={`transition-all duration-1000 ease-out delay-500 ${
            phase !== "enter"
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-4"
          }`}
        >
          <p className="text-white/90 text-lg md:text-xl font-light tracking-wide text-center">
            Intelligent fältservice
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
