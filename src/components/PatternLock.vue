<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    status?: "normal" | "success" | "error";
    size?: number;
    minPoints?: number;
  }>(),
  {
    disabled: false,
    status: "normal",
    size: 260,
    minPoints: 4,
  },
);

const emit = defineEmits<{
  (e: "completed", pattern: number[]): void;
  (e: "change", pattern: number[]): void;
  (e: "reset"): void;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const isDrawing = ref(false);
const selectedDots = ref<number[]>([]);
const currentPointer = ref<{ x: number; y: number } | null>(null);

// Calculate 3x3 dot positions
const dots = computed(() => {
  const padding = props.size * 0.18;
  const spacing = (props.size - padding * 2) / 2;
  const list: { id: number; x: number; y: number }[] = [];

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      list.push({
        id: row * 3 + col,
        x: padding + col * spacing,
        y: padding + row * spacing,
      });
    }
  }

  return list;
});

// Line styling based on status
const strokeColor = computed(() => {
  if (props.status === "success") return "#10b981";
  if (props.status === "error") return "#ef4444";
  return "#6366f1";
});

function getRelativeCoordinates(clientX: number, clientY: number) {
  if (!containerRef.value) return null;
  const rect = containerRef.value.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function findDotAtPosition(x: number, y: number) {
  const hitRadius = props.size * 0.12;
  for (const dot of dots.value) {
    const dx = dot.x - x;
    const dy = dot.y - y;
    if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) {
      return dot.id;
    }
  }
  return null;
}

function handleStart(clientX: number, clientY: number) {
  if (props.disabled) return;
  const coords = getRelativeCoordinates(clientX, clientY);
  if (!coords) return;

  const hitDot = findDotAtPosition(coords.x, coords.y);
  isDrawing.value = true;
  selectedDots.value = hitDot !== null ? [hitDot] : [];
  currentPointer.value = coords;

  if (hitDot !== null) {
    emit("change", selectedDots.value);
    if (navigator?.vibrate) {
      navigator.vibrate(15);
    }
  }
}

function handleMove(clientX: number, clientY: number) {
  if (!isDrawing.value || props.disabled) return;
  const coords = getRelativeCoordinates(clientX, clientY);
  if (!coords) return;

  currentPointer.value = coords;
  const hitDot = findDotAtPosition(coords.x, coords.y);

  if (hitDot !== null && !selectedDots.value.includes(hitDot)) {
    selectedDots.value.push(hitDot);
    emit("change", selectedDots.value);
    if (navigator?.vibrate) {
      navigator.vibrate(15);
    }
  }
}

function handleEnd() {
  if (!isDrawing.value) return;
  isDrawing.value = false;
  currentPointer.value = null;

  if (selectedDots.value.length > 0) {
    emit("completed", [...selectedDots.value]);
  }
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 1) {
    e.preventDefault();
    handleStart(e.touches[0].clientX, e.touches[0].clientY);
  }
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 1) {
    e.preventDefault();
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
  }
}

function onTouchEnd() {
  handleEnd();
}

function onMouseDown(e: MouseEvent) {
  handleStart(e.clientX, e.clientY);
}

function onMouseMove(e: MouseEvent) {
  handleMove(e.clientX, e.clientY);
}

function onMouseUp() {
  handleEnd();
}

function reset() {
  selectedDots.value = [];
  currentPointer.value = null;
  isDrawing.value = false;
  emit("reset");
}

defineExpose({
  reset,
  selectedDots,
});

onMounted(() => {
  window.addEventListener("mouseup", handleEnd);
});

onUnmounted(() => {
  window.removeEventListener("mouseup", handleEnd);
});
</script>

<template>
  <div
    ref="containerRef"
    :class="['pattern-lock-container', `pattern-lock--${status}`]"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchEnd"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
  >
    <svg
      class="pattern-lock-svg"
      :viewBox="`0 0 ${size} ${size}`"
      :width="size"
      :height="size"
    >
      <!-- Connected lines -->
      <template v-if="selectedDots.length > 1">
        <line
          v-for="idx in selectedDots.length - 1"
          :key="`line-${idx}`"
          :x1="dots[selectedDots[idx - 1]].x"
          :y1="dots[selectedDots[idx - 1]].y"
          :x2="dots[selectedDots[idx]].x"
          :y2="dots[selectedDots[idx]].y"
          :stroke="strokeColor"
          stroke-width="3.5"
          stroke-linecap="round"
          class="pattern-line"
        />
      </template>

      <!-- Active drawing line to current cursor -->
      <line
        v-if="isDrawing && currentPointer && selectedDots.length > 0"
        :x1="dots[selectedDots[selectedDots.length - 1]].x"
        :y1="dots[selectedDots[selectedDots.length - 1]].y"
        :x2="currentPointer.x"
        :y2="currentPointer.y"
        :stroke="strokeColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-dasharray="4,4"
        class="pattern-cursor-line"
      />

      <!-- 3x3 Dots -->
      <g
        v-for="dot in dots"
        :key="`dot-${dot.id}`"
        :class="[
          'pattern-dot-group',
          selectedDots.includes(dot.id) ? 'pattern-dot--selected' : '',
        ]"
      >
        <!-- Outer touch target area (transparent) -->
        <circle
          :cx="dot.x"
          :cy="dot.y"
          :r="size * 0.1"
          fill="transparent"
          class="pattern-hit-target"
        />

        <!-- Outer glowing ring if selected -->
        <circle
          v-if="selectedDots.includes(dot.id)"
          :cx="dot.x"
          :cy="dot.y"
          :r="size * 0.065"
          :fill="props.status === 'error' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(99, 102, 241, 0.25)'"
          :stroke="strokeColor"
          stroke-width="1.5"
          class="pattern-dot-glow"
        />

        <!-- Dot Core -->
        <circle
          :cx="dot.x"
          :cy="dot.y"
          :r="selectedDots.includes(dot.id) ? 6.5 : 4"
          :fill="selectedDots.includes(dot.id) ? strokeColor : 'rgba(255, 255, 255, 0.45)'"
          class="pattern-dot-core"
        />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.pattern-lock-container {
  position: relative;
  touch-action: none;
  user-select: none;
  margin: 0 auto;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
}

.pattern-lock-svg {
  display: block;
}

.pattern-line {
  filter: drop-shadow(0 0 6px currentColor);
  transition: stroke 0.15s ease;
}

.pattern-cursor-line {
  opacity: 0.8;
}

.pattern-dot-core {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.pattern-dot--selected .pattern-dot-core {
  filter: drop-shadow(0 0 8px currentColor);
}

.pattern-dot-glow {
  animation: pattern-pulse 1.2s infinite ease-in-out;
}

@keyframes pattern-pulse {
  0%, 100% {
    transform-origin: center;
    opacity: 0.8;
  }
  50% {
    opacity: 0.4;
  }
}

.pattern-lock--error {
  animation: pattern-shake 0.35s ease-in-out;
}

@keyframes pattern-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-6px); }
  40%, 80% { transform: translateX(6px); }
}
</style>
