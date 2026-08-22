/**
 * Host tool tests: executeVisualize settles exactly one of spec/widget and
 * validates through the shared parsers; createVisualizeTool pins the
 * model-facing name, parameters, and output schema.
 */
import { describe, expect, it } from 'vitest'
import { VISUALIZE_TOOL, createVisualizeTool, executeVisualize } from '../src/visualize-tool.ts'

describe('executeVisualize', () => {
  it('settles a valid ChartSpec', async () => {
    await expect(executeVisualize({ spec: { kind: 'bar', series: [{ data: [1, 2] }] } })).resolves.toEqual({
      spec: { kind: 'bar', series: [{ data: [1, 2] }] },
    })
  })

  it('settles a valid WidgetSpec', async () => {
    await expect(executeVisualize({ widget: { kind: 'svg', code: '<svg></svg>', title: 't' } })).resolves.toEqual({
      widget: { kind: 'svg', code: '<svg></svg>', title: 't' },
    })
  })

  it('rejects ambiguous payloads (both / neither)', async () => {
    await expect(executeVisualize({ spec: { kind: 'bar', series: [{ data: [1] }] }, widget: { kind: 'html', code: 'x' } }))
      .rejects.toThrow('provide exactly one of `spec` or `widget`')
    await expect(executeVisualize({}))
      .rejects.toThrow('`spec` or `widget` is required')
    await expect(executeVisualize(null)).rejects.toThrow('`spec` or `widget` is required')
  })

  it('reports chart validation failures', async () => {
    await expect(executeVisualize({ spec: { kind: 'gauge', series: [] } }))
      .rejects.toThrow('invalid chart spec: kind must be one of: bar, line, area, pie, scatter')
  })

  it('reports widget validation failures', async () => {
    await expect(executeVisualize({ widget: { kind: 'mermaid', code: 'x' } }))
      .rejects.toThrow('invalid widget spec: kind must be one of: svg, html')
    await expect(executeVisualize({ widget: { kind: 'svg', code: '' } }))
      .rejects.toThrow('invalid widget spec: code must not be empty')
  })
})

describe('createVisualizeTool', () => {
  const tool = createVisualizeTool()

  it('pins the model-facing name and the spec/widget parameters', () => {
    expect(tool.name).toBe(VISUALIZE_TOOL)
    const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties
    expect(properties).toHaveProperty('spec')
    expect(properties).toHaveProperty('widget')
  })

  it('teaches both delivery paths in the description', () => {
    expect(tool.description).toContain('spec')
    expect(tool.description).toContain('widget')
    expect(tool.description).toContain('```svg')
    expect(tool.description).toContain('```html')
  })

  it('renders the canonical value as its JSON text content', () => {
    const rendered = tool.output.render({}, { widget: { kind: 'svg', code: '<svg/>' } })
    expect(rendered).toEqual([{ type: 'text', text: JSON.stringify({ widget: { kind: 'svg', code: '<svg/>' } }) }])
  })
})
