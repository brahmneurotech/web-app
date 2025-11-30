// App.tsx
import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Matter from 'matter-js';

const { Engine, World, Bodies, Body, Sleeping, Events } = Matter;

// ===============================
// Types
// ===============================

type Position = {
  top: string;
  left: string;
};

type SphereConfig = {
  id: number;
  size: number;        // Desktop size (px)
  mobileSize: number;  // Mobile size (px)
  delay: number;
  className: string;
};

type Burst = {
  id: number;
  x: number;
  y: number;
  timestamp: number;
};

type PhysicsPosition = {
  x: number;
  y: number;
};

// ===============================
// GLOBAL AUDIO CONTEXT (for pops)
// ===============================

let audioCtx: AudioContext | null = null;

const playPopSound = (size: number = 50) => {
  try {
    if (typeof window === 'undefined') return;

    const AudioContextCtor =
      (window as any).AudioContext || (window as any).webkitAudioContext;

    if (!AudioContextCtor) return;

    if (!audioCtx) {
      audioCtx = new AudioContextCtor();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const t = audioCtx.currentTime;

    // Dynamic pitch based on size
    let baseFreq = 600 - size * 2;
    baseFreq = Math.max(200, Math.min(900, baseFreq));
    baseFreq += Math.random() * 40 - 20;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.1, t + 0.1);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.start(t);
    osc.stop(t + 0.1);

    // Noise "mist" layer
    const bufferSize = audioCtx.sampleRate * 0.1;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.15;
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 3000;

    const noiseGain = audioCtx.createGain();

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);

    noiseGain.gain.setValueAtTime(0.1, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    noise.start(t);
    noise.stop(t + 0.1);
  } catch (e) {
    console.error('Audio playback failed', e);
  }
};

// ===============================
// Bubble Config – base set (up to 7)
// ===============================

const SPHERE_BASE: SphereConfig[] = [
  {
    id: 1,
    size: 140,
    mobileSize: 96,
    delay: 0,
    className: 'w-24 h-24 md:w-[140px] md:h-[140px]',
  },
  {
    id: 2,
    size: 100,
    mobileSize: 80,
    delay: 0.3,
    className: 'w-20 h-20 md:w-[100px] md:h-[100px]',
  },
  {
    id: 3,
    size: 80,
    mobileSize: 64,
    delay: 0.6,
    className: 'w-16 h-16 md:w-[80px] md:h-[80px]',
  },
  {
    id: 4,
    size: 60,
    mobileSize: 56,
    delay: 0.9,
    className: 'w-14 h-14 md:w-[60px] md:h-[60px]',
  },
  {
    id: 5,
    size: 40,
    mobileSize: 40,
    delay: 1.2,
    className: 'w-10 h-10 md:w-[40px] md:h-[40px]',
  },
  {
    id: 6,
    size: 30,
    mobileSize: 32,
    delay: 1.5,
    className: 'w-8 h-8 md:w-[30px] md:h-[30px]',
  },
  {
    id: 7,
    size: 20,
    mobileSize: 24,
    delay: 1.8,
    className: 'w-6 h-6 md:w-[20px] md:h-[20px]',
  },
];

// ===============================
// Hooks & Utilities
// ===============================

const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
};

const generateDistributedPositions = (count: number): Position[] => {
  const sectors = [
    { yMin: 10, yMax: 30, xMin: 10, xMax: 30 },
    { yMin: 10, yMax: 30, xMin: 70, xMax: 90 },
    { yMin: 35, yMax: 55, xMin: 5, xMax: 25 },
    { yMin: 35, yMax: 55, xMin: 75, xMax: 95 },
    { yMin: 60, yMax: 80, xMin: 15, xMax: 35 },
    { yMin: 60, yMax: 80, xMin: 65, xMax: 85 },
    { yMin: 40, yMax: 70, xMin: 45, xMax: 55 },
  ];

  const shuffled = [...sectors].sort(() => Math.random() - 0.5);
  const chosen = shuffled.slice(0, count);

  return chosen.map((sector) => {
    const t = sector.yMin + Math.random() * (sector.yMax - sector.yMin);
    const l = sector.xMin + Math.random() * (sector.xMax - sector.xMin);
    return { top: `${t}%`, left: `${l}%` };
  });
};

// Unlock audio on first real user gesture
const useAudioUnlock = () => {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      const AudioContextCtor =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;

      if (!audioCtx) {
        audioCtx = new AudioContextCtor();
      }

      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    };

    window.addEventListener('touchstart', unlock, { once: true });
    window.addEventListener('mousedown', unlock, { once: true });

    return () => {
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('mousedown', unlock);
    };
  }, []);
};

// ===============================
// Navbar
// ===============================

const Navbar: React.FC = () => (
  <nav className="fixed top-0 left-0 w-full z-40 bg-transparent pointer-events-none">
    <div className="flex justify-center items-center px-6 py-8 md:px-12 pointer-events-auto">
      <div className="text-[32px] font-medium tracking-tight text-[#151515] font-logo">
        Brahm Neurotech
      </div>
    </div>
  </nav>
);

// ===============================
// InteractiveGrid (Canvas background)
// ===============================

interface InteractiveGridProps {
  bursts: Burst[];
}

const InteractiveGrid: React.FC<InteractiveGridProps> = ({ bursts }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const updateSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', updateSize);
    updateSize();

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', handleMouseMove);

    const draw = () => {
      if (!canvas || !ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const time = Date.now();

      ctx.clearRect(0, 0, width, height);

      const cols = 4;
      const cellSize = width / cols;
      const rows = Math.ceil(height / cellSize);

      const baseColor = '#f3f4f6';
      const activeColor = '#4B9CD3';
      const highlightColor = '#d1d5db';

      ctx.lineWidth = 1;

      // Vertical lines + ripple
      for (let i = 0; i <= cols; i++) {
        const x = i * cellSize;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.strokeStyle = baseColor;
        ctx.stroke();

        bursts.forEach((burst) => {
          const age = time - burst.timestamp;
          const radius = age * 0.5;
          const maxRadius = Math.max(width, height) * 1.2;

          if (radius < maxRadius) {
            const distX = Math.abs(x - burst.x);
            if (distX < radius) {
              const dy = Math.sqrt(radius * radius - distX * distX);
              const y1 = burst.y - dy;
              const y2 = burst.y + dy;
              const alpha = Math.max(0, 1 - radius / maxRadius);

              ctx.beginPath();
              ctx.moveTo(x, y1 - 50);
              ctx.lineTo(x, y1 + 50);
              ctx.strokeStyle = activeColor;
              ctx.globalAlpha = alpha;
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(x, y2 - 50);
              ctx.lineTo(x, y2 + 50);
              ctx.stroke();
              ctx.globalAlpha = 1;
            }
          }
        });
      }

      // Horizontal lines + ripple
      for (let i = 0; i <= rows; i++) {
        const y = i * cellSize;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.strokeStyle = baseColor;
        ctx.stroke();

        bursts.forEach((burst) => {
          const age = time - burst.timestamp;
          const radius = age * 0.5;
          const maxRadius = Math.max(width, height) * 1.2;

          if (radius < maxRadius) {
            const distY = Math.abs(y - burst.y);
            if (distY < radius) {
              const dx = Math.sqrt(radius * radius - distY * distY);
              const x1 = burst.x - dx;
              const x2 = burst.x + dx;
              const alpha = Math.max(0, 1 - radius / maxRadius);

              ctx.beginPath();
              ctx.moveTo(x1 - 50, y);
              ctx.lineTo(x1 + 50, y);
              ctx.strokeStyle = activeColor;
              ctx.globalAlpha = alpha;
              ctx.stroke();

              ctx.beginPath();
              ctx.moveTo(x2 - 50, y);
              ctx.lineTo(x2 + 50, y);
              ctx.stroke();
              ctx.globalAlpha = 1;
            }
          }
        });
      }

      // Mouse crosshair highlights
      for (let c = 0; c <= cols; c++) {
        for (let r = 0; r <= rows; r++) {
          const px = c * cellSize;
          const py = r * cellSize;

          const dx = px - mouseRef.current.x;
          const dy = py - mouseRef.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 150) {
            const alpha = 1 - dist / 150;
            ctx.strokeStyle = highlightColor;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 1.5;

            const size = 6;
            ctx.beginPath();
            ctx.moveTo(px - size, py);
            ctx.lineTo(px + size, py);
            ctx.moveTo(px, py - size);
            ctx.lineTo(px, py + size);
            ctx.stroke();

            if (dist < 100) {
              ctx.fillStyle = '#9ca3af';
              ctx.font = '10px sans-serif';
              ctx.fillText(`[ ${c}, ${r} ]`, px + 8, py - 8);
            }

            ctx.lineWidth = 1;
            ctx.globalAlpha = 1;
          }
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animationFrameId);
    };
  }, [bursts]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-0 pointer-events-none opacity-60"
    />
  );
};

// ===============================
// Burst Particle
// ===============================

const Particle: React.FC<{ size: number; index: number; total: number }> = ({
  size,
  index,
  total,
}) => {
  const baseAngle = (index / total) * 360;
  const randomOffset = (Math.random() - 0.5) * 80;
  const angle = ((baseAngle + randomOffset) * Math.PI) / 180;

  const distance = size * 0.5 + Math.random() * (size * 0.3);

  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;

  const dotSize = Math.max(3, size * 0.08);

  return (
    <motion.div
      className="absolute rounded-full bg-[#4B9CD3] pointer-events-none top-1/2 left-1/2 shadow-sm blur-[1px]"
      initial={{ x: 0, y: 0, opacity: 0.8, scale: 0.6 }}
      animate={{
        x: x * 1.8,
        y: y * 1.8,
        opacity: 0,
        scale: 0,
      }}
      transition={{
        duration: 0.4,
        ease: 'easeOut',
      }}
      style={{
        width: dotSize,
        height: dotSize,
        zIndex: 15,
        marginTop: -dotSize / 2,
        marginLeft: -dotSize / 2,
      }}
    />
  );
};

// ===============================
// Subscribe Button
// ===============================

const SubscribeButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
}> = ({ onClick, disabled }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (status !== 'idle' || disabled) return;

    setStatus('loading');

    setTimeout(() => {
      onClick();
      setStatus('success');
    }, 400);
  };

  if (status === 'success') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full h-full flex items-center justify-center text-white font-sans font-normal text-lg text-center bg-[#4B9CD3] rounded-full"
      >
        Subscribed!
      </motion.div>
    );
  }

  return (
    <div className="relative w-full h-[60px]">
      <button
        onClick={handleClick}
        disabled={status === 'loading' || disabled}
        className={`w-full h-full bg-[#151515] rounded-full text-white font-sans font-normal text-lg tracking-wide capitalize transition-all duration-300
          ${
            status === 'loading' || disabled
              ? 'opacity-50 cursor-not-allowed bg-gray-400'
              : 'hover:bg-[#252525] pointer-events-auto'
          }
        `}
      >
        Subscribe
      </button>
    </div>
  );
};

// ===============================
// Sphere – physics-driven visual
// ===============================

interface SphereProps {
  config: SphereConfig;
  position: Position;
  physicsPosition?: PhysicsPosition;
  isMobile: boolean;
  onBurst: (x: number, y: number) => void;
  wave: number;
  collisionTrigger?: number;
}

const Sphere: React.FC<SphereProps> = ({
  config,
  position,
  physicsPosition,
  isMobile,
  onBurst,
  wave,
  collisionTrigger,
}) => {
  const [isBurst, setIsBurst] = useState(false);
  const activeSize = isMobile ? config.mobileSize : config.size;
  const elementRef = useRef<HTMLDivElement>(null);

  // Reset burst on new wave
  useEffect(() => {
    setIsBurst(false);
  }, [wave]);

  // Compute CSS top/left from physics or percentage fallback
  const { topPx, leftPx } = useMemo(() => {
    if (typeof window === 'undefined') {
      return { topPx: 0, leftPx: 0 };
    }
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (physicsPosition) {
      return {
        topPx: physicsPosition.y - activeSize / 2,
        leftPx: physicsPosition.x - activeSize / 2,
      };
    }

    const topPercent = parseFloat(position.top);
    const leftPercent = parseFloat(position.left);
    const y = (topPercent / 100) * height - activeSize / 2;
    const x = (leftPercent / 100) * width - activeSize / 2;
    return { topPx: y, leftPx: x };
  }, [physicsPosition, position, activeSize]);

  const triggerBurst = () => {
    if (!elementRef.current) return;
    const rect = elementRef.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    onBurst(x, y);
  };

  // Collision-triggered burst
  useEffect(() => {
    if (!collisionTrigger) return;
    if (isBurst) return;
    setIsBurst(true);
    triggerBurst();
    playPopSound(activeSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collisionTrigger]);

  // Subtle breathing (scale-only, physics does the motion)
  const idleAnimation = useMemo(() => {
    const duration = 3 + Math.random() * 3;
    return {
      scale: [1, 1.05, 0.95, 1],
      transition: {
        duration,
        repeat: Infinity as const,
        repeatType: 'mirror' as const,
        ease: 'easeInOut' as const,
      },
    };
  }, [wave]);

  const initial = { opacity: 0, scale: 0.7, y: 40 };
  const animate = isBurst
    ? { scale: 1.2, opacity: 0 }
    : { opacity: 1, scale: idleAnimation.scale, y: 0 };

  const transition = isBurst
    ? { duration: 0.12, ease: 'easeOut' as const }
    : {
        ...idleAnimation.transition,
        opacity: { duration: 0.6, ease: 'easeOut' },
        y: { duration: 0.6, ease: 'easeOut' },
      };

  return (
    <motion.div
      ref={elementRef}
      className={`absolute flex items-center justify-center ${config.className} pointer-events-auto`}
      style={{
        zIndex: 10,
        top: topPx,
        left: leftPx,
      }}
      initial={initial}
      animate={animate}
      transition={transition}
    >
      {!isBurst && (
        <motion.div
          className="w-full h-full rounded-full sphere-gradient cursor-pointer relative z-20"
          onClick={(e) => {
            if (isBurst) return;
            e.stopPropagation();
            playPopSound(activeSize);
            setIsBurst(true);
            triggerBurst();
          }}
          whileHover={{ scale: 1.05, y: -5 }}
          whileTap={{ scale: 0.95 }}
        />
      )}
      {isBurst &&
        [...Array(8)].map((_, i) => (
          <Particle key={i} index={i} total={8} size={activeSize} />
        ))}
    </motion.div>
  );
};

// ===============================
// Main App
// ===============================

const App: React.FC = () => {
  useAudioUnlock();
  const isMobile = useIsMobile();

  const [wave, setWave] = useState(0);
  const [burstCount, setBurstCount] = useState(0);
  const [burstTotal, setBurstTotal] = useState(0);

  const [email, setEmail] = useState('');
  const [isEmailValid, setIsEmailValid] = useState(false);
  const [isTouched, setIsTouched] = useState(false);

  const [activeBursts, setActiveBursts] = useState<Burst[]>([]);
  const [bubblePositions, setBubblePositions] = useState<
    Record<number, PhysicsPosition>
  >({});
  const [collisionBursts, setCollisionBursts] = useState<
    Record<number, number>
  >({});

  // Gentle chaos energy mode after subscribe
  const [energyMode, setEnergyMode] = useState(false);
  const energyRef = useRef(false);
  const chaosBurstCounterRef = useRef(0);

  useEffect(() => {
    energyRef.current = energyMode;
    if (energyMode) {
      chaosBurstCounterRef.current = 0;
    }
  }, [energyMode]);

  // Dynamic bubble configs (5–7 bubbles)
  const [bubbleConfigs, setBubbleConfigs] = useState<SphereConfig[]>(() => {
    const count = 5 + Math.floor(Math.random() * 3); // 5–7
    return SPHERE_BASE.slice(0, count);
  });

  // When wave changes → regenerate configs & reset counters
  useEffect(() => {
    const count = 5 + Math.floor(Math.random() * 3); // 5–7 each wave
    const configs = SPHERE_BASE.slice(0, count);
    setBubbleConfigs(configs);
    setBurstTotal(configs.length);
    setBurstCount(0);
    setCollisionBursts({});
    setBubblePositions({});
  }, [wave]);

  const currentPositions = useMemo(
    () => generateDistributedPositions(bubbleConfigs.length),
    [wave, bubbleConfigs.length]
  );

  // Physics engine & bodies
  const physicsRef = useRef<{
    engine: Matter.Engine;
    bubbles: Record<number, Matter.Body & { sphereId?: number; shouldBurst?: boolean }>;
    walls: Matter.Body[];
  } | null>(null);

  // =========================
  // Matter.js Physics Engine
  // =========================
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const setupPhysics = () => {
      if (cancelled) return;

      const width = window.innerWidth;
      const height = window.innerHeight;

      const engine = Engine.create({ enableSleeping: true });
      engine.world.gravity.y = 0;

      // Walls
      const walls = [
        Bodies.rectangle(width / 2, -100, width * 2, 200, {
          isStatic: true,
          restitution: 1,
        }),
        Bodies.rectangle(width / 2, height + 100, width * 2, 200, {
          isStatic: true,
          restitution: 1,
        }),
        Bodies.rectangle(-100, height / 2, 200, height * 2, {
          isStatic: true,
          restitution: 1,
        }),
        Bodies.rectangle(width + 100, height / 2, 200, height * 2, {
          isStatic: true,
          restitution: 1,
        }),
      ];
      World.add(engine.world, walls);

      const bubbleBodies: Record<number, Matter.Body & { sphereId?: number; shouldBurst?: boolean }> = {};

      // Spawn bodies at arranged positions
      bubbleConfigs.forEach((config, index) => {
        const pos = currentPositions[index];
        const topPercent = parseFloat(pos.top);
        const leftPercent = parseFloat(pos.left);

        const xRaw = (leftPercent / 100) * width;
        const yRaw = (topPercent / 100) * height;

        const x = isNaN(xRaw) ? width / 2 : xRaw;
        const y = isNaN(yRaw) ? height / 2 : yRaw;

        const radius = (isMobile ? config.mobileSize : config.size) / 2;

        const body = Bodies.circle(x, y, radius, {
          restitution: 0.9,
          friction: 0,
          frictionAir: 0.01,
          density: 0.001,
        }) as Matter.Body & { sphereId?: number; shouldBurst?: boolean };

        body.sphereId = config.id;

        // Slight randomness to avoid perfect overlap
        Body.setPosition(body, {
          x: x + (Math.random() - 0.5) * 8,
          y: y + (Math.random() - 0.5) * 8,
        });

        // Small initial velocity
        Body.setVelocity(body, {
          x: (Math.random() - 0.5) * 0.6,
          y: (Math.random() - 0.5) * 0.6,
        });

        bubbleBodies[config.id] = body;
      });

      World.add(engine.world, Object.values(bubbleBodies));

      physicsRef.current = {
        engine,
        bubbles: bubbleBodies,
        walls,
      };

      // ===== Elastic + energetic collision logic (any bubble can burst) =====
      const collisionHandler = (event: Matter.IEventCollision<Matter.Engine>) => {
        event.pairs.forEach((pair) => {
          const A = pair.bodyA as any;
          const B = pair.bodyB as any;

          if (!A.circleRadius || !B.circleRadius) return;

          const idA = A.sphereId as number | undefined;
          const idB = B.sphereId as number | undefined;
          if (!idA || !idB) return;

          const speedA = Math.hypot(A.velocity.x, A.velocity.y);
          const speedB = Math.hypot(B.velocity.x, B.velocity.y);
          const impactSpeed = Math.max(speedA, speedB);

          const candidateBodies: any[] = [A, B];

          // Base threshold for "strong" collision
          const baseThreshold = 0.9;
          const chaosThreshold = 0.55;

          if (energyRef.current) {
            // Gentle chaos: random 2–3 bursts when subscribed
            if (
              impactSpeed > chaosThreshold &&
              chaosBurstCounterRef.current < 3 &&
              Math.random() < 0.6
            ) {
              const toBurst =
                candidateBodies[Math.floor(Math.random() * candidateBodies.length)];
              toBurst.shouldBurst = true;
              chaosBurstCounterRef.current += 1;
            }
          } else {
            // Normal mode: rare bursts only on strong hits
            if (impactSpeed > baseThreshold && Math.random() < 0.15) {
              const toBurst =
                candidateBodies[Math.floor(Math.random() * candidateBodies.length)];
              toBurst.shouldBurst = true;
            }
          }
        });
      };

      Events.on(engine, 'collisionStart', collisionHandler);

      let animationFrameId: number;

      const tick = () => {
        if (cancelled) return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        // === Base Motion Constants (medium speed, always moving) ===
        let DRIFT_FORCE = 0.00018;
        let NOISE_FORCE = 0.00006;
        let BUOYANCY_FORCE = 0.00012;

        // Energy mode: slightly more chaos for collision bursts
        if (energyRef.current) {
          DRIFT_FORCE *= 2.0;
          NOISE_FORCE *= 2.1;
          BUOYANCY_FORCE *= 1.6;
        }

        // === High-energy bouncing ===
        const WALL_PUSH = 0.0022;
        const WALL_DAMPING = 1.1;
        const WALL_MARGIN = 26;
        const MIN_WALL_SPEED = 0.9;

        // === Velocity Clamp ===
        const MAX_SPEED = 2.2;

        const t = performance.now() * 0.00012;

        for (const body of Object.values(bubbleBodies)) {
          if (body.isSleeping) Sleeping.set(body, false);

          const r = body.circleRadius || 0;

          // 1. Gentle sinusoidal drift
          const id = (body as any).sphereId || 0;
          const driftX = Math.cos(t + id * 0.7) * DRIFT_FORCE;
          const driftY =
            Math.sin(t * 0.8 + id * 1.3) * DRIFT_FORCE * 0.7;

          Body.applyForce(body, body.position, { x: driftX, y: driftY });

          // 2. Subtle Brownian jitter
          Body.applyForce(body, body.position, {
            x: (Math.random() - 0.5) * NOISE_FORCE,
            y: (Math.random() - 0.5) * NOISE_FORCE,
          });

          // 3. Gentle upward buoyancy
          Body.applyForce(body, body.position, { x: 0, y: -BUOYANCY_FORCE });

          // 4. Energy-mode extra impulses
          if (energyRef.current) {
            const ENERGY_FORCE = 0.0008;
            Body.applyForce(body, body.position, {
              x: (Math.random() - 0.5) * ENERGY_FORCE,
              y: (Math.random() - 0.5) * ENERGY_FORCE,
            });
          }

          // 5. Strong wall bounces

          // LEFT
          if (body.position.x - r < WALL_MARGIN) {
            Body.applyForce(body, body.position, { x: WALL_PUSH, y: 0 });

            const newVX = Math.max(
              MIN_WALL_SPEED,
              Math.abs(body.velocity.x * WALL_DAMPING)
            );

            Body.setVelocity(body, {
              x: newVX,
              y: body.velocity.y,
            });
          }

          // RIGHT
          if (body.position.x + r > width - WALL_MARGIN) {
            Body.applyForce(body, body.position, { x: -WALL_PUSH, y: 0 });

            const newVX = -Math.max(
              MIN_WALL_SPEED,
              Math.abs(body.velocity.x * WALL_DAMPING)
            );

            Body.setVelocity(body, {
              x: newVX,
              y: body.velocity.y,
            });
          }

          // TOP
          if (body.position.y - r < WALL_MARGIN) {
            Body.applyForce(body, body.position, { x: 0, y: WALL_PUSH });

            const newVY = Math.max(
              MIN_WALL_SPEED,
              Math.abs(body.velocity.y * WALL_DAMPING)
            );

            Body.setVelocity(body, {
              x: body.velocity.x,
              y: newVY,
            });
          }

          // BOTTOM
          if (body.position.y + r > height - WALL_MARGIN) {
            Body.applyForce(body, body.position, { x: 0, y: -WALL_PUSH });

            const newVY = -Math.max(
              MIN_WALL_SPEED,
              Math.abs(body.velocity.y * WALL_DAMPING)
            );

            Body.setVelocity(body, {
              x: body.velocity.x,
              y: newVY,
            });
          }

          // 6. Velocity clamp
          const speed = Math.hypot(body.velocity.x, body.velocity.y);
          if (speed > MAX_SPEED) {
            Body.setVelocity(body, {
              x: (body.velocity.x / speed) * MAX_SPEED,
              y: (body.velocity.y / speed) * MAX_SPEED,
            });
          }
        }

        // Step physics
        Engine.update(engine, 1000 / 60);

        // Sync positions into React state
        const newPositions: Record<number, PhysicsPosition> = {};
        Object.entries(bubbleBodies).forEach(([id, body]) => {
          newPositions[Number(id)] = {
            x: body.position.x,
            y: body.position.y,
          };
        });
        setBubblePositions(newPositions);

        // Propagate collision bursts to React
        const now = performance.now();
        const burstMap: Record<number, number> = {};
        Object.values(bubbleBodies).forEach((body) => {
          if (body.shouldBurst && body.sphereId) {
            burstMap[body.sphereId] = now + Math.random() * 40;
            body.shouldBurst = false;
          }
        });
        if (Object.keys(burstMap).length > 0) {
          setCollisionBursts((prev) => ({ ...prev, ...burstMap }));
        }

        animationFrameId = requestAnimationFrame(tick);
      };

      tick();

      const handleResize = () => {
        // Could re-layout if needed
      };
      window.addEventListener('resize', handleResize);

      return () => {
        cancelAnimationFrame(animationFrameId);
        window.removeEventListener('resize', handleResize);
        Events.off(engine, 'collisionStart', collisionHandler as any);
        World.clear(engine.world, false);
        Engine.clear(engine);
        physicsRef.current = null;
      };
    };

    const rafId = requestAnimationFrame(setupPhysics);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (physicsRef.current) {
        const { engine } = physicsRef.current;
        World.clear(engine.world, false);
        Engine.clear(engine);
        physicsRef.current = null;
      }
    };
  }, [wave, isMobile, bubbleConfigs, currentPositions]);

  // Trim old grid bursts
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setActiveBursts((prev) => prev.filter((b) => now - b.timestamp < 3000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleBurst = (x: number, y: number) => {
    setActiveBursts((prev) => [
      ...prev,
      { id: Math.random(), x, y, timestamp: Date.now() },
    ]);

    setBurstCount((prev) => {
      const newCount = prev + 1;
      if (burstTotal > 0 && newCount >= burstTotal) {
        setTimeout(() => {
          setWave((w) => w + 1);
          setBurstCount(0);
          setCollisionBursts({});
          setBubblePositions({});
          setActiveBursts([]);
        }, 600);
      }
      return newCount;
    });
  };

  const validateEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setEmail(val);
    setIsEmailValid(validateEmail(val));
  };

  const handleBlur = () => setIsTouched(true);

  const handleSubscribe = () => {
    if (!isEmailValid) return;
    console.log('Saving email:', email);
    setEmail('');
    setIsEmailValid(false);
    setIsTouched(false);

    // Gentle chaos: temporary energy mode so a random 2–3 bubbles collide & burst
    setEnergyMode(true);
    setTimeout(() => setEnergyMode(false), 2500);
  };

  return (
    <div className="bg-white min-h-screen text-[#151515] selection:bg-[#4B9CD3] selection:text-white relative overflow-hidden font-sans">
      {/* Background Grid */}
      <div className="absolute inset-0 bg-grid z-0 pointer-events-none opacity-40" />

      {/* Interactive Grid */}
      <div className="absolute inset-0 z-5 pointer-events-none">
        <InteractiveGrid bursts={activeBursts} />
      </div>

      {/* Navbar */}
      <Navbar />

      {/* Bubble layer */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-auto z-10">
        <AnimatePresence mode="wait">
          {bubbleConfigs.map((config, index) => (
            <Sphere
              key={`${config.id}-${wave}`}
              config={config}
              position={currentPositions[index]}
              physicsPosition={bubblePositions[config.id]}
              isMobile={isMobile}
              onBurst={handleBurst}
              wave={wave}
              collisionTrigger={collisionBursts[config.id]}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Main Content */}
      <main className="relative z-30 flex flex-col items-center justify-center min-h-screen px-6 text-center w-full max-w-7xl mx-auto pointer-events-none">
        {/* Subscribe section */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="relative z-30 w-full max-w-xl mx-auto pointer-events-none"
        >
          <p className="text-base md:text-lg text-gray-600 mb-6 leading-relaxed font-medium text-center">
            Subscribe for updates
          </p>

          <form
            className="flex flex-col md:flex-row gap-4 md:gap-6 w-full items-center justify-center pointer-events-none"
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              type="email"
              value={email}
              onChange={handleEmailChange}
              onBlur={handleBlur}
              placeholder="Email"
              className={`w-full md:w-[600px] h-[60px] px-8 rounded-full border bg-white focus:outline-none transition-all 
                text-center md:text-left placeholder:text-gray-400 pointer-events-auto text-[#151515] font-sans text-lg
                ${
                  isTouched && !isEmailValid
                    ? 'border-red-300 focus:border-red-300 ring-1 ring-red-300/20'
                    : 'border-gray-300 focus:border-gray-400'
                }`}
            />
            <div className="w-full md:w-[220px] h-[60px] pointer-events-auto">
              <SubscribeButton
                onClick={handleSubscribe}
                disabled={!isEmailValid}
              />
            </div>
          </form>
        </motion.div>

        {/* Footer */}
        <footer className="absolute bottom-8 w-full px-6 md:px-12 z-30">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center md:items-end justify-between gap-6">
            {/* Left: Contact + Careers */}
            <div className="flex flex-col items-center md:items-start gap-2 pointer-events-auto">
              <a
                href="mailto:contact@brahmneurotech.com"
                className="text-[11px] md:text-xs text-gray-500 hover:text-[#4B9CD3] transition-colors font-sans tracking-wide uppercase"
              >
                Contact
              </a>

              <div className="relative group flex flex-col items-center md:items-start">
                <a
                  href="mailto:contact@brahmneurotech.com"
                  className="text-[11px] md:text-xs text-gray-500 hover:text-[#4B9CD3] transition-colors font-sans tracking-wide uppercase flex items-center gap-2"
                >
                  Careers
                  <span className="text-[9px] px-1.5 py-[2px] border border-[#4B9CD3] text-[#4B9CD3] rounded bg-[#4B9CD3]/10">
                    HIRING
                  </span>
                </a>

                <div className="absolute bottom-full left-1/2 md:left-0 -translate-x-1/2 md:translate-x-0 mb-3 w-56 p-3 bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none group-hover:pointer-events-auto">
                  <p className="text-[11px] text-gray-600 leading-relaxed font-sans text-left">
                    We’re hiring engineering interns
                    <br />
                    (no qualification bar)
                    <br />
                  </p>
                  <div className="absolute bottom-[-5px] left-1/2 md:left-4 -translate-x-1/2 md:-translate-x-0 w-2 h-2 bg-white border-b border-r border-gray-200 transform rotate-45" />
                </div>
              </div>
            </div>

            {/* Right: Copyright */}
            <p className="text-[11px] md:text-xs text-gray-500 font-sans tracking-wide text-center md:text-right pointer-events-none">
              © {new Date().getFullYear()} Brahm Neurotech Pvt Ltd
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default App;
