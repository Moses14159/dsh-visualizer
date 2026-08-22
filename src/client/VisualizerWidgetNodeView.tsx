/**
 * The keyed `conversation.chat.node` renderer for `visualizer-widget`.
 *
 * Pure presentation: reads `node.data.widgets` (already validated and
 * bounded upstream — the Definition folds them through the widget contract),
 * builds each widget's sandboxed srcdoc, and renders it in an inert iframe:
 * `sandbox=""` (scripts, same-origin, forms, popups, navigation all off)
 * plus the srcdoc's injected CSP. Widget code is inserted verbatim; the
 * iframe boundary is the security layer, so there is no sanitizer to bypass
 * and no escaping to get wrong.
 *
 * Frame sizing: an SVG widget's intrinsic aspect (see svg-geometry.ts) sizes
 * the frame to the full diagram at container width, so tall figures stay
 * readable instead of being clipped to a fixed height. A zoom control scales
 * the frame beyond fit-width; the outer wrapper scrolls. HTML widgets keep a
 * fixed comfortable height (they lay out at document width).
 *
 * Styling: DSH theme tokens only (CSS variables), no literal colors — the
 * plugin must stay neutral across DSH color schemes.
 */
import { memo, useEffect, useRef, useState } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { widgetSrcdoc } from '../to-iframe.ts'
import { DEFAULT_WIDGET_HEIGHT, fittedWidgetHeight } from '../svg-geometry.ts'
import type { WidgetAcc } from '../widget.ts'
import type { VisualizerWidgetData } from './widget-fold.ts'

/** Full props of the keyed renderer (the type resolves through the plugin's
 *  ChatNodeDataMap augmentation in visualizer-widget-definition.ts). The rc
 *  runtime's PropsRuntime wiring resolves `node.data` as any, so the view
 *  re-narrows with the definition-owned payload type below. */
export type VisualizerWidgetViewProps = ChatNodeViewProps<'visualizer-widget'>

/** Fixed frame height (CSS px) for widgets without an intrinsic aspect. */
const FRAME_HEIGHT = DEFAULT_WIDGET_HEIGHT

/** Zoom steps the widget frame offers (1 = fit to width). */
const ZOOM_STEPS = [1, 1.5, 2] as const

/** Lifecycle status of one accumulator (drives badge + data attribute). */
function statusOf(widget: WidgetAcc): 'live' | 'truncated' | 'done' {
  if (!widget.closed) return 'live'
  return widget.overflow ? 'truncated' : 'done'
}

const STATUS_TEXT: Readonly<Record<ReturnType<typeof statusOf>, string>> = {
  live: '生成中',
  truncated: '已截断',
  done: '完成',
}

/** Zoom label for one step. */
function zoomLabel(zoom: number): string {
  return zoom === 1 ? '适应' : `${zoom}×`
}

/** One widget: header row (kind / title / status / zoom) + sandboxed frame. */
function WidgetCard({ widget }: { readonly widget: WidgetAcc }): React.ReactNode {
  const status = statusOf(widget)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [zoomIndex, setZoomIndex] = useState(0)

  // Track the card width so the frame height can follow the SVG's aspect.
  useEffect(() => {
    const host = wrapRef.current
    if (host === null) return
    let observer: ResizeObserver | undefined
    observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined) setContainerWidth(width)
    })
    observer.observe(host)
    return () => observer?.disconnect()
  }, [])

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1
  const fitted = fittedWidgetHeight(containerWidth, widget)
  // At zoom 1 the frame fills the card; beyond that it grows inside a
  // scrollable wrapper so details stay legible.
  const frameWidth = containerWidth > 0 ? Math.round(containerWidth * zoom) : undefined
  const frameHeight = containerWidth > 0 ? Math.round(fitted * zoom) : FRAME_HEIGHT
  const showZoom = widget.kind === 'svg'

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: 11,
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-secondary)',
            textTransform: 'lowercase',
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          {widget.kind}
        </span>
        {widget.title !== undefined && (
          <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{widget.title}</span>
        )}
        <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>{STATUS_TEXT[status]}</span>
        {showZoom && (
          <div style={{ display: 'flex', gap: 2, marginLeft: 'auto', flexShrink: 0 }}>
            {ZOOM_STEPS.map((step, index) => (
              <button
                key={step}
                type="button"
                onClick={() => setZoomIndex(index)}
                aria-pressed={zoomIndex === index}
                style={{
                  padding: '1px 8px',
                  borderRadius: 5,
                  border: zoomIndex === index
                    ? '1px solid var(--dsw-alias-brand-primary)'
                    : '1px solid transparent',
                  background: zoomIndex === index
                    ? 'var(--dsw-alias-brand-primary)'
                    : 'var(--dsw-alias-bg-layer-2)',
                  color: zoomIndex === index
                    ? 'var(--dsw-alias-brand-primary-invert, #fff)'
                    : 'var(--dsw-alias-label-secondary)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {zoomLabel(step)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ overflow: 'auto', maxWidth: '100%' }}>
        <iframe
          // Inert frame: no scripts / same-origin / forms / popups / navigation.
          sandbox=""
          srcDoc={widgetSrcdoc(widget)}
          title={widget.title ?? `${widget.kind} widget`}
          data-widget-kind={widget.kind}
          data-widget-status={status}
          style={{
            display: 'block',
            width: frameWidth === undefined ? '100%' : frameWidth,
            height: frameHeight,
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 8,
            background: 'var(--dsw-alias-bg-base)',
          }}
        />
      </div>
    </div>
  )
}

/** The chat node card: header row + one frame per widget. */
export const VisualizerWidgetNodeView = memo(function VisualizerWidgetNodeView({
  node,
}: VisualizerWidgetViewProps): React.ReactNode {
  const { widgets, dropped } = node.data as VisualizerWidgetData
  return (
    <div
      data-widget-count={widgets.length}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: 11,
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-secondary)',
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          widgets
        </span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>生成的组件</span>
        {dropped > 0 && (
          <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>
            已省略 {dropped} 个超限组件
          </span>
        )}
      </div>
      {widgets.map((widget, index) => <WidgetCard key={index} widget={widget} />)}
    </div>
  )
})
