"use client";

import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef } from "react";
import { AnimatePresence, MotionConfig, animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";

/** Motion defaults for the app: honours the reduced-motion setting everywhere. */
export function MotionShell({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>{children}</MotionConfig>;
}

/** Slight tilt toward the pointer, shared with the landing page but toned down for working screens. */
export function useTilt(strength = 2) {
  const reduceMotion = useReducedMotion();
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springX = useSpring(rotateX, { stiffness: 190, damping: 22, mass: 0.55 });
  const springY = useSpring(rotateY, { stiffness: 190, damping: 22, mass: 0.55 });
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (reduceMotion) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    rotateX.set(y * -strength);
    rotateY.set(x * strength);
  };
  const onPointerLeave = () => { rotateX.set(0); rotateY.set(0); };
  return { style: { rotateX: springX, rotateY: springY, transformPerspective: 1200 }, onPointerMove, onPointerLeave };
}

/** A card that lifts and tilts under the pointer. Use on things you can open or act on, not on reading surfaces. */
export function LiftCard({ children, className = "", tilt = 2, lift = 3, as = "div", ...rest }: { children: ReactNode; className?: string; tilt?: number; lift?: number; as?: "div" | "section" | "header" | "li" | "a" | "article"; href?: string; "aria-label"?: string; id?: string }) {
  const tiltProps = useTilt(tilt);
  const Component = (motion as unknown as Record<string, typeof motion.div>)[as] ?? motion.div;
  return (
    <Component className={`lift ${className}`} style={tiltProps.style} onPointerMove={tiltProps.onPointerMove} onPointerLeave={tiltProps.onPointerLeave}
      whileHover={{ y: -lift, boxShadow: "0 12px 28px rgba(13,29,48,.12)" }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} {...rest}>
      {children}
    </Component>
  );
}

/** Counts up once on first paint, then stays still for every later change. */
export function AnimatedAmount({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const reduceMotion = useReducedMotion();
  const count = useMotionValue(0);
  const first = useRef(true);
  const formatted = useTransform(count, (latest) => latest.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  useEffect(() => {
    if (reduceMotion || !first.current) { count.set(value); return; }
    first.current = false;
    const controls = animate(count, value, { duration: 0.7, ease: [0.25, 1, 0.5, 1] });
    return () => controls.stop();
  }, [count, reduceMotion, value]);
  return <span aria-label={value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}><motion.span aria-hidden="true">{formatted}</motion.span></span>;
}

/** Slides the outgoing stage out and the next stage in when the key changes. */
export function StageSwitch({ stageKey, children }: { stageKey: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={stageKey} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Grows a bar from zero to its width once, then follows width changes with a transition. */
export function GrowBar({ width, className }: { width: string; className: string }) {
  return <motion.span className={className} initial={{ width: 0 }} animate={{ width }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />;
}

export { motion };
