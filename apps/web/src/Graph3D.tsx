import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';

export interface Graph3DNode {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
}
export interface Graph3DEdge {
  id: string;
  fromId: string;
  toId: string;
}
interface ProjectedNode {
  id: string;
  label: string;
  x: number;
  y: number;
  depth: number;
  radius: number;
}
interface Props {
  nodes: Graph3DNode[];
  edges: Graph3DEdge[];
  selectedId: string;
  onSelect: (id: string) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Lightweight 3D projection renderer. Every point and edge is derived from repository graph data. */
export function Graph3D({ nodes, edges, selectedId, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const projectedRef = useRef<ProjectedNode[]>([]);
  const cameraRef = useRef({ yaw: 0.25, pitch: -0.18, zoom: 1 });
  const dragRef = useRef({ active: false, moved: false, pointerX: 0, pointerY: 0 });
  const drawRef = useRef<() => void>(() => undefined);
  const [reducedMotion, setReducedMotion] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(bounds.width * dpr);
    const height = Math.round(bounds.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, bounds.width, bounds.height);

    const cx = bounds.width / 2;
    const cy = bounds.height / 2;
    const camera = cameraRef.current;
    const cyaw = Math.cos(camera.yaw);
    const syaw = Math.sin(camera.yaw);
    const cpitch = Math.cos(camera.pitch);
    const spitch = Math.sin(camera.pitch);
    const focal = Math.min(bounds.width, bounds.height) * 1.35;

    const projected = nodes.map((node) => {
      const wx = node.x * 178;
      const wy = node.y * 178;
      const wz = node.z * 178;
      const rx = wx * cyaw + wz * syaw;
      const yawZ = -wx * syaw + wz * cyaw;
      const ry = wy * cpitch - yawZ * spitch;
      const rz = wy * spitch + yawZ * cpitch;
      const perspective = focal / (focal - rz);
      return {
        id: node.id,
        label: node.label,
        x: cx + rx * perspective * camera.zoom,
        y: cy + ry * perspective * camera.zoom,
        depth: rz,
        radius: clamp(3.1 * perspective * camera.zoom, 2.2, 8),
      };
    });
    projectedRef.current = projected;

    const glow = ctx.createRadialGradient(
      cx,
      cy,
      8,
      cx,
      cy,
      Math.max(bounds.width, bounds.height) * 0.58,
    );
    glow.addColorStop(0, 'rgba(34, 211, 238, 0.075)');
    glow.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, bounds.width, bounds.height);

    ctx.save();
    ctx.strokeStyle = 'rgba(92, 133, 158, 0.085)';
    ctx.lineWidth = 1;
    for (let r = 56; r <= Math.min(bounds.width, bounds.height) * 0.46; r += 56) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.28, r * 0.55, -0.22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    const byId = new Map(projected.map((node) => [node.id, node]));
    const visibleEdges = edges
      .map((edge) => ({ edge, from: byId.get(edge.fromId), to: byId.get(edge.toId) }))
      .filter((item): item is { edge: Graph3DEdge; from: ProjectedNode; to: ProjectedNode } =>
        Boolean(item.from && item.to),
      )
      .sort((a, b) => a.from.depth + a.to.depth - (b.from.depth + b.to.depth));
    for (const item of visibleEdges) {
      const depth = (item.from.depth + item.to.depth) / 2;
      const opacity = clamp(0.16 + (depth + 178) / 620, 0.12, 0.48);
      ctx.beginPath();
      ctx.moveTo(item.from.x, item.from.y);
      ctx.lineTo(item.to.x, item.to.y);
      ctx.strokeStyle = 'rgba(91, 177, 196, ' + opacity.toFixed(3) + ')';
      ctx.lineWidth = 0.8 + clamp((depth + 178) / 178, 0, 1) * 0.7;
      ctx.stroke();
    }

    for (const node of [...projected].sort((a, b) => a.depth - b.depth)) {
      const selected = node.id === selectedId;
      const opacity = clamp(0.58 + (node.depth + 178) / 650, 0.5, 1);
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + (selected ? 3 : 0), 0, Math.PI * 2);
      ctx.fillStyle = selected ? 'rgba(34, 211, 238, 0.2)' : 'rgba(34, 211, 238, 0.055)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = selected ? '#a5f3fc' : 'rgba(79, 211, 231, ' + opacity.toFixed(3) + ')';
      ctx.fill();
      ctx.strokeStyle = selected ? '#e0fbff' : 'rgba(154, 236, 246, 0.75)';
      ctx.lineWidth = selected ? 1.7 : 0.8;
      ctx.stroke();
      if (nodes.length <= 28 || selected) {
        ctx.font = selected ? '600 11px ui-monospace, monospace' : '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = selected ? '#e6fbff' : 'rgba(191, 218, 230, ' + opacity.toFixed(3) + ')';
        ctx.fillText(node.label.slice(0, 24), node.x, node.y - node.radius - 8);
      }
    }
  }, [edges, nodes, selectedId]);

  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    let frame = 0;
    let last = 0;
    const animate = (time: number) => {
      if (time - last >= 40) {
        cameraRef.current.yaw += 0.0014;
        drawRef.current();
        last = time;
      }
      frame = window.requestAnimationFrame(animate);
    };
    if (!reducedMotion) frame = window.requestAnimationFrame(animate);
    else drawRef.current();
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [reducedMotion]);

  function pointerDown(event: PointerEvent<HTMLCanvasElement>) {
    dragRef.current = {
      active: true,
      moved: false,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag.active) return;
    const dx = event.clientX - drag.pointerX;
    const dy = event.clientY - drag.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    cameraRef.current.yaw += dx * 0.008;
    cameraRef.current.pitch = clamp(cameraRef.current.pitch + dy * 0.006, -1.15, 1.15);
    drag.pointerX = event.clientX;
    drag.pointerY = event.clientY;
    drawRef.current();
  }
  function pointerUp(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    dragRef.current.active = false;
    if (!drag.moved) {
      const rect = event.currentTarget.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const hit = [...projectedRef.current]
        .map((node) => ({ node, distance: Math.hypot(node.x - px, node.y - py) }))
        .filter((item) => item.distance <= Math.max(15, item.node.radius + 8))
        .sort((a, b) => a.distance - b.distance)[0];
      if (hit) onSelect(hit.node.id);
    }
  }
  function wheel(event: WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    cameraRef.current.zoom = clamp(cameraRef.current.zoom - event.deltaY * 0.001, 0.62, 1.85);
    drawRef.current();
  }

  return (
    <div className="orbit-graph3d">
      <canvas
        ref={canvasRef}
        className="orbit-graph3d-canvas"
        role="img"
        aria-label={
          'Interactive 3D engineering graph with ' +
          nodes.length +
          ' loaded nodes and ' +
          edges.length +
          ' loaded relationships. Drag to rotate, scroll to zoom, or select a node below.'
        }
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => {
          dragRef.current.active = false;
        }}
        onWheel={wheel}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 text-[10px] text-mute">
        <span>Drag to rotate · Scroll to zoom · Select a node to inspect</span>
        <button
          type="button"
          className="rounded border border-edge px-2 py-1 hover:border-cyan hover:text-cyan"
          onClick={() => {
            cameraRef.current = { yaw: 0.25, pitch: -0.18, zoom: 1 };
            drawRef.current();
          }}
        >
          Reset view
        </button>
      </div>
      <div className="orbit-graph3d-node-list" aria-label="Select graph node">
        {nodes.slice(0, 40).map((node) => (
          <button
            key={node.id}
            type="button"
            aria-pressed={selectedId === node.id}
            onClick={() => onSelect(node.id)}
            className={selectedId === node.id ? 'is-selected' : ''}
          >
            {node.label.slice(0, 30)}
          </button>
        ))}
      </div>
    </div>
  );
}
