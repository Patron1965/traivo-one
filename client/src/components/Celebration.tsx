import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CelebrationProps {
  show: boolean;
  onComplete?: () => void;
}

export function Celebration({ show, onComplete }: CelebrationProps) {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; color: string }>>([]);

  useEffect(() => {
    if (show) {
      const newParticles = Array.from({ length: 12 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        color: ["#8B5CF6", "#3B82F6", "#10B981", "#F59E0B", "#EC4899"][Math.floor(Math.random() * 5)],
      }));
      setParticles(newParticles);

      const timer = setTimeout(() => {
        setParticles([]);
        onComplete?.();
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  return (
    <AnimatePresence>
      {particles.length > 0 && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {particles.map((particle) => (
            <motion.div
              key={particle.id}
              initial={{ 
                y: "100vh", 
                x: `${particle.x}vw`, 
                scale: 0,
                rotate: 0 
              }}
              animate={{ 
                y: "-10vh", 
                scale: [0, 1, 1, 0.5],
                rotate: 360 
              }}
              exit={{ opacity: 0 }}
              transition={{ 
                duration: 1.5, 
                ease: "easeOut",
                delay: Math.random() * 0.3 
              }}
              style={{ backgroundColor: particle.color }}
              className="absolute w-3 h-3 rounded-full"
            />
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}

export function SuccessCheckmark({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none"
        >
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: [0.8, 1.1, 1] }}
            transition={{ duration: 0.4 }}
            className="bg-primary/10 backdrop-blur-sm rounded-full p-8"
          >
            <motion.svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            >
              <motion.path
                d="M20 6 9 17l-5-5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              />
            </motion.svg>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
