/**
 * Overview subagent state-machine board — layered SVG of team graph nodes
 * with live activity dots (running chase / idle done).
 */
import { useMemo } from 'react'
import { StateDot, type StateDotState } from '@xrkseek/client-ui-primitives'
import css from './SubagentGraphBoard.module.css'

export interface SubagentGraphNode {
  readonly id: string
  readonly label: string
  readonly role?: string
  readonly depth?: number
  readonly activity?: 'running' | 'inactive'
}

export interface SubagentGraphEdge {
  readonly from: string
  readonly to: string
  readonly kind: string
  readonly label?: string
}

export interface SubagentLiveRow {
  readonly id: string
  readonly label?: string
  readonly activity: 'running' | 'inactive'
  readonly mode: string
  readonly liveTool?: string
  readonly liveText?: string
}

export interface SubagentGraphBoardProps {
  readonly sessionId: string
  readonly rootLabel: string
  readonly nodes: readonly SubagentGraphNode[]
  readonly edges: readonly SubagentGraphEdge[]
  readonly live: readonly SubagentLiveRow[]
  readonly emptyLabel: string
  readonly runningLabel: string
  readonly idleLabel: string
}

const COL_W = 148
const ROW_H = 64
const NODE_W = 124
const NODE_H = 40
const PAD_X = 16
const PAD_Y = 20

function activityDot(activity: 'running' | 'inactive' | undefined): StateDotState {
  return activity === 'running' ? 'ongoing' : 'done'
}

function mergeGraph(
  sessionId: string,
  rootLabel: string,
  nodes: readonly SubagentGraphNode[],
  edges: readonly SubagentGraphEdge[],
  live: readonly SubagentLiveRow[],
): { nodes: SubagentGraphNode[]; edges: SubagentGraphEdge[] } {
  const liveById = new Map(live.map((row) => [row.id, row]))
  if (nodes.length === 0 && live.length === 0) {
    return { nodes: [], edges: [] }
  }

  const byId = new Map<string, SubagentGraphNode>()
  if (nodes.length === 0) {
    byId.set(sessionId, {
      id: sessionId,
      label: rootLabel,
      depth: 0,
      activity: 'inactive',
    })
    for (const row of live) {
      byId.set(row.id, {
        id: row.id,
        label: row.label ?? row.id,
        depth: 1,
        activity: row.activity,
      })
    }
    return {
      nodes: [...byId.values()],
      edges: live.map((row) => ({
        from: sessionId,
        to: row.id,
        kind: 'delegates',
      })),
    }
  }

  for (const node of nodes) {
    const liveRow = liveById.get(node.id)
    byId.set(node.id, {
      ...node,
      activity: liveRow?.activity ?? node.activity ?? 'inactive',
      ...(liveRow?.label && !node.label ? { label: liveRow.label } : {}),
    })
  }
  // Live children missing from the team graph still belong on the board.
  for (const row of live) {
    if (byId.has(row.id)) continue
    byId.set(row.id, {
      id: row.id,
      label: row.label ?? row.id,
      depth: 1,
      activity: row.activity,
    })
  }
  if (![...byId.values()].some((n) => (n.depth ?? 1) === 0)) {
    // Ensure a root anchor when the graph only lists children.
    if (!byId.has(sessionId)) {
      byId.set(sessionId, {
        id: sessionId,
        label: rootLabel,
        depth: 0,
        activity: 'inactive',
      })
    }
  }

  const edgeList = [...edges]
  for (const row of live) {
    if (edgeList.some((e) => e.to === row.id)) continue
    edgeList.push({ from: sessionId, to: row.id, kind: 'delegates' })
  }
  return { nodes: [...byId.values()], edges: edgeList }
}

function layout(
  nodes: readonly SubagentGraphNode[],
  edges: readonly SubagentGraphEdge[],
): {
  positions: Map<string, { x: number; y: number; depth: number }>
  width: number
  height: number
  maxDepth: number
} {
  const depthOf = new Map<string, number>()
  for (const node of nodes) {
    depthOf.set(node.id, typeof node.depth === 'number' ? node.depth : 1)
  }
  // Prefer BFS depths from the shallowest roots when depth is missing.
  const incoming = new Map<string, string[]>()
  for (const edge of edges) {
    const list = incoming.get(edge.to) ?? []
    list.push(edge.from)
    incoming.set(edge.to, list)
  }
  const roots = nodes.filter((n) => (incoming.get(n.id)?.length ?? 0) === 0)
  if (roots.length > 0) {
    const queue = roots.map((r) => r.id)
    const seen = new Set(queue)
    for (const id of queue) depthOf.set(id, 0)
    while (queue.length > 0) {
      const id = queue.shift()!
      const d = depthOf.get(id) ?? 0
      for (const edge of edges) {
        if (edge.from !== id || seen.has(edge.to)) continue
        seen.add(edge.to)
        depthOf.set(edge.to, d + 1)
        queue.push(edge.to)
      }
    }
  }

  const columns = new Map<number, string[]>()
  let maxDepth = 0
  for (const node of nodes) {
    const d = depthOf.get(node.id) ?? 0
    maxDepth = Math.max(maxDepth, d)
    const col = columns.get(d) ?? []
    col.push(node.id)
    columns.set(d, col)
  }

  const positions = new Map<string, { x: number; y: number; depth: number }>()
  let maxRows = 1
  for (const [depth, ids] of columns) {
    maxRows = Math.max(maxRows, ids.length)
    ids.forEach((id, index) => {
      positions.set(id, {
        depth,
        x: PAD_X + depth * COL_W,
        y: PAD_Y + index * ROW_H,
      })
    })
  }
  return {
    positions,
    width: PAD_X * 2 + (maxDepth + 1) * COL_W,
    height: PAD_Y * 2 + maxRows * ROW_H,
    maxDepth,
  }
}

function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const x1 = from.x + NODE_W
  const y1 = from.y + NODE_H / 2
  const x2 = to.x
  const y2 = to.y + NODE_H / 2
  const mx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
}

/**
 * Render a live subagent / Agent Teams state machine for Overview Status.
 */
export function SubagentGraphBoard({
  sessionId,
  rootLabel,
  nodes,
  edges,
  live,
  emptyLabel,
  runningLabel,
  idleLabel,
}: SubagentGraphBoardProps) {
  const merged = useMemo(
    () => mergeGraph(sessionId, rootLabel, nodes, edges, live),
    [sessionId, rootLabel, nodes, edges, live],
  )
  const laid = useMemo(
    () => layout(merged.nodes, merged.edges),
    [merged.nodes, merged.edges],
  )
  const liveById = useMemo(() => new Map(live.map((row) => [row.id, row])), [live])

  if (merged.nodes.length === 0) {
    return <div className={css.empty}>{emptyLabel}</div>
  }

  return (
    <div className={css.board} data-subagent-graph="">
      <svg
        className={css.svg}
        width={laid.width}
        height={laid.height}
        viewBox={`0 0 ${laid.width} ${laid.height}`}
        role="img"
        aria-label={rootLabel}
      >
        <defs>
          <marker
            id="subagent-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className={css.arrowHead} />
          </marker>
        </defs>
        {merged.edges.map((edge) => {
          const from = laid.positions.get(edge.from)
          const to = laid.positions.get(edge.to)
          if (!from || !to) return null
          const toNode = merged.nodes.find((n) => n.id === edge.to)
          const running = toNode?.activity === 'running'
          return (
            <path
              key={`${edge.kind}:${edge.from}:${edge.to}`}
              d={edgePath(from, to)}
              className={running ? `${css.edge} ${css.edgeLive}` : css.edge}
              data-kind={edge.kind}
              markerEnd="url(#subagent-arrow)"
            />
          )
        })}
      </svg>
      <div className={css.overlay} style={{ width: laid.width, height: laid.height }}>
        {merged.nodes.map((node) => {
          const pos = laid.positions.get(node.id)
          if (!pos) return null
          const liveRow = liveById.get(node.id)
          const running = node.activity === 'running'
          const meta = running
            ? (liveRow?.liveTool
              ? `tool:${liveRow.liveTool}`
              : liveRow?.liveText
                ? liveRow.liveText
                : runningLabel)
            : idleLabel
          return (
            <div
              key={node.id}
              className={running ? `${css.node} ${css.nodeLive}` : css.node}
              style={{ left: pos.x, top: pos.y, width: NODE_W, height: NODE_H }}
              data-activity={node.activity ?? 'inactive'}
              data-depth={pos.depth}
              title={`${node.label} · ${meta}`}
            >
              <StateDot state={activityDot(node.activity)} size={8} />
              <div className={css.nodeText}>
                <span className={css.nodeTitle}>{node.label}</span>
                <span className={css.nodeMeta}>
                  {node.role ? `${node.role} · ` : ''}
                  {meta}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
