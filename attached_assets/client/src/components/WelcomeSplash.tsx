import { useState, useEffect, useCallback, useRef } from "react";
import { useTenantBranding } from "@/components/TenantBrandingProvider";

interface WelcomeSplashProps {
  onComplete: () => void;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  emoji: string;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
}

function darkenColor(hex: string, amount: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  const r = Math.max(0, parseInt(result[1], 16) - amount);
  const g = Math.max(0, parseInt(result[2], 16) - amount);
  const b = Math.max(0, parseInt(result[3], 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

const PARTICLE_EMOJIS = ["😊", "🎉", "✨", "⭐", "💫", "🌟", "😄", "🙌", "👋", "🎊", "💚", "🚀"];
const PARTICLE_COLORS = ["#FFD700", "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DFE6E9", "#A29BFE", "#FD79A8", "#00CEC9"];

export function WelcomeSplash({ onComplete }: WelcomeSplashProps) {
  const [phase, setPhase] = useState<"grow" | "pulse" | "explode" | "fade">("grow");
  const [smileyScale, setSmileyScale] = useState(0);
  const [particles, setParticles] = useState<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const { branding } = useTenantBranding();

  const defaultPrimaries = ["#3B82F6", "#1B4B6B"];
  const hasCustomColor = !!(branding?.primaryColor && !defaultPrimaries.includes(branding.primaryColor));
  const hasAnyBranding = !!(branding && (branding.logoUrl || branding.companyName || branding.tagline || hasCustomColor));
  const customPrimary = hasAnyBranding && branding?.primaryColor ? branding.primaryColor : null;
  const bgColor = customPrimary || "#1B4B6B";
  const bgDark = customPrimary ? darkenColor(customPrimary, 30) : "#2C3E50";

  const createParticles = useCallback(() => {
    const newParticles: Particle[] = [];
    const count = 60;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 3 + Math.random() * 8;
      newParticles.push({
        id: i,
        x: 50,
        y: 50,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 16 + Math.random() * 28,
        color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
        emoji: PARTICLE_EMOJIS[Math.floor(Math.random() * PARTICLE_EMOJIS.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 20,
        opacity: 1,
      });
    }
    return newParticles;
  }, []);

  useEffect(() => {
    const growDuration = 800;
    const growStart = performance.now();

    const animateGrow = (now: number) => {
      const elapsed = now - growStart;
      const progress = Math.min(elapsed / growDuration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setSmileyScale(eased);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animateGrow);
      }
    };
    animFrameRef.current = requestAnimationFrame(animateGrow);

    const pulseTimer = setTimeout(() => setPhase("pulse"), growDuration);
    const explodeTimer = setTimeout(() => {
      setPhase("explode");
      setParticles(createParticles());
    }, growDuration + 600);
    const fadeTimer = setTimeout(() => setPhase("fade"), growDuration + 600 + 800);
    const completeTimer = setTimeout(() => onComplete(), growDuration + 600 + 800 + 500);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      clearTimeout(pulseTimer);
      clearTimeout(explodeTimer);
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete, createParticles]);

  useEffect(() => {
    if (phase !== "explode" && phase !== "fade") return;

    let lastTime = performance.now();
    const animate = (now: number) => {
      const dt = (now - lastTime) / 16;
      lastTime = now;

      setParticles(prev =>
        prev.map(p => ({
          ...p,
          x: p.x + p.vx * dt,
          y: p.y + p.vy * dt,
          vy: p.vy + 0.15 * dt,
          rotation: p.rotation + p.rotationSpeed * dt,
          opacity: Math.max(0, p.opacity - 0.012 * dt),
        })).filter(p => p.opacity > 0)
      );

      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [phase]);

  const smileySize = phase === "pulse" ? "scale-[3.5]" : "";
  const pulseAnim = phase === "pulse" ? "animate-bounce" : "";

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-opacity duration-500 ease-out ${
        phase === "fade" ? "opacity-0" : "opacity-100"
      }`}
      style={{
        background: `linear-gradient(135deg, ${bgColor} 0%, ${bgDark} 50%, ${bgColor} 100%)`,
      }}
      data-testid="welcome-splash"
    >
      {phase !== "explode" && phase !== "fade" && (
        <div
          className={`transition-transform duration-300 ease-out ${smileySize} ${pulseAnim}`}
          style={{
            transform: phase === "grow" ? `scale(${smileyScale * 3.5})` : undefined,
          }}
        >
          <div className="relative" data-testid="splash-smiley">
            <svg width="120" height="120" viewBox="0 0 120 120" className="drop-shadow-2xl">
              <defs>
                <radialGradient id="faceGrad" cx="40%" cy="35%">
                  <stop offset="0%" stopColor="#FFE066" />
                  <stop offset="100%" stopColor="#FFD700" />
                </radialGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <circle cx="60" cy="60" r="55" fill="url(#faceGrad)" stroke="#E6B800" strokeWidth="2" filter="url(#glow)" />
              <ellipse cx="42" cy="45" rx="7" ry="9" fill="#4A3728" />
              <ellipse cx="78" cy="45" rx="7" ry="9" fill="#4A3728" />
              <ellipse cx="44" cy="42" rx="2.5" ry="3" fill="white" />
              <ellipse cx="80" cy="42" rx="2.5" ry="3" fill="white" />
              <path
                d="M 30 70 Q 60 100 90 70"
                fill="none"
                stroke="#4A3728"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <ellipse cx="25" cy="65" rx="10" ry="7" fill="#FFB3B3" opacity="0.5" />
              <ellipse cx="95" cy="65" rx="10" ry="7" fill="#FFB3B3" opacity="0.5" />
            </svg>
          </div>
        </div>
      )}

      {(phase === "explode" || phase === "fade") && particles.map(p => (
        <div
          key={p.id}
          className="absolute pointer-events-none"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            transform: `translate(-50%, -50%) rotate(${p.rotation}deg)`,
            fontSize: `${p.size}px`,
            opacity: p.opacity,
            willChange: "transform, opacity, left, top",
          }}
        >
          {p.emoji}
        </div>
      ))}
    </div>
  );
}
