import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/chartspec.ts
/** Kind vocabulary; closed — an unknown kind is a validation error. */
const KINDS = [
	"bar",
	"line",
	"area",
	"pie",
	"scatter"
];
/** Upper bounds on a single spec (untrusted input: keep rendering bounded). */
const MAX_SERIES = 8;
const MAX_POINTS = 500;
const MAX_LABEL = 120;
/** Bound one string field. */
function boundString(value, field, required, max = MAX_LABEL) {
	if (value === void 0) {
		if (required) throw new Error(`${field} is required`);
		return;
	}
	if (typeof value !== "string") throw new Error(`${field} must be a string`);
	if (value.length === 0) throw new Error(`${field} must not be empty`);
	if (value.length > max) throw new Error(`${field} exceeds ${max} characters`);
	return value;
}
/** Bound one finite number array. */
function boundNumbers(value, field) {
	if (!Array.isArray(value)) throw new Error(`${field}.data must be an array`);
	if (value.length === 0) throw new Error(`${field}.data must not be empty`);
	if (value.length > MAX_POINTS) throw new Error(`${field}.data exceeds ${MAX_POINTS} points`);
	for (const item of value) if (typeof item !== "number" || !Number.isFinite(item)) throw new Error(`${field}.data must contain finite numbers`);
	return value;
}
/** Bound one series object. */
function boundSeries(value, index) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`series[${index}] must be an object`);
	const record = value;
	const data = boundNumbers(record["data"], `series[${index}]`);
	const name = record["name"] === void 0 ? void 0 : boundString(record["name"], `series[${index}].name`, true);
	return name === void 0 ? { data } : {
		name,
		data
	};
}
/**
* Validate untrusted JSON into a ChartSpec.
* @param input - unknown payload (tool argument or parsed result text).
* @returns the validated spec, or a rejection reason.
*/
function parseChartSpec(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return {
		ok: false,
		message: "chart spec must be an object"
	};
	const record = input;
	try {
		if (typeof record["kind"] !== "string" || !KINDS.includes(record["kind"])) throw new Error(`kind must be one of: ${KINDS.join(", ")}`);
		const kind = record["kind"];
		if (!Array.isArray(record["series"]) || record["series"].length === 0) throw new Error("series must be a non-empty array");
		if (record["series"].length > MAX_SERIES) throw new Error(`series exceeds ${MAX_SERIES} entries`);
		const series = record["series"].map(boundSeries);
		const title = boundString(record["title"], "title", false);
		const yName = boundString(record["yName"], "yName", false);
		const xAxis = record["xAxis"] === void 0 ? void 0 : (() => {
			if (!Array.isArray(record["xAxis"])) throw new Error("xAxis must be an array of strings");
			if (record["xAxis"].length > MAX_POINTS) throw new Error(`xAxis exceeds ${MAX_POINTS} labels`);
			const labels = [];
			for (const label of record["xAxis"]) {
				const bound = boundString(label, "xAxis[]", true);
				if (bound !== void 0) labels.push(bound);
			}
			return labels;
		})();
		return {
			ok: true,
			spec: {
				kind,
				...title === void 0 ? {} : { title },
				...yName === void 0 ? {} : { yName },
				...xAxis === void 0 ? {} : { xAxis },
				series
			}
		};
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error)
		};
	}
}
//#endregion
//#region src/widget.ts
/** Upper bound on one widget's code, in UTF-8 bytes. */
const MAX_WIDGET_BYTES = 131072;
/** UTF-8 byte length of a string (TextEncoder is global in Node and browsers). */
const encoder = new TextEncoder();
function utf8ByteLength(text) {
	return encoder.encode(text).length;
}
/** Bound one optional title string. */
function boundTitle(value) {
	if (value === void 0) return void 0;
	if (typeof value !== "string") throw new Error("title must be a string");
	if (value.length === 0) throw new Error("title must not be empty");
	if (value.length > 120) throw new Error(`title exceeds 120 characters`);
	return value;
}
/**
* Validate untrusted JSON into a WidgetSpec.
* @param input - unknown payload (tool argument).
* @returns the validated widget, or a rejection reason.
*/
function parseWidgetSpec(input) {
	if (input === null || typeof input !== "object" || Array.isArray(input)) return {
		ok: false,
		message: "widget spec must be an object"
	};
	const record = input;
	try {
		const kind = record["kind"];
		if (kind !== "svg" && kind !== "html") throw new Error("kind must be one of: svg, html");
		const code = record["code"];
		if (typeof code !== "string") throw new Error("code must be a string");
		if (code.trim() === "") throw new Error("code must not be empty");
		if (utf8ByteLength(code) > 131072) throw new Error(`code exceeds ${MAX_WIDGET_BYTES} bytes`);
		const title = boundTitle(record["title"]);
		return {
			ok: true,
			widget: {
				kind,
				code,
				...title === void 0 ? {} : { title }
			}
		};
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error)
		};
	}
}
Object.freeze({
	kind: void 0,
	title: void 0,
	content: "",
	bytes: 0,
	overflow: false,
	pending: "",
	closed: []
});
//#endregion
//#region src/visualize-tool.ts
/**
* The `visualize` tool definition of dsh-visualizer's host half.
*
* The model hands the tool exactly one of two payloads:
*
* - `spec` — a ChartSpec (validated by chartspec.ts; the client folds it
*   into a `visualizer-chart` node rendered with echarts);
* - `widget` — a WidgetSpec (validated by widget.ts; the client folds it
*   into a `visualizer-widget` node rendered in a sandboxed iframe).
*
* The settled tool result carries the canonical validated JSON as its text
* content, so the client Definitions re-validate the same bytes with the
* same parsers — one contract on both sides of the wire. The model is also
* taught the streamed path in the description: for progressive rendering it
* can emit ```` ```svg ```` / ```` ```html ```` fences in its text response
* instead, which the client folds from `assistant/chunk` deltas without a
* tool round-trip.
*/
/**
* JSON-Schema for the model-facing `spec` parameter (the open object; the
* parser performs the strict/closed validation the schema cannot express).
* Kept in sync with chartspec.ts's field vocabulary.
*/
const SPEC_PARAMETER_SCHEMA = {
	type: "object",
	additionalProperties: true,
	description: "Structured chart specification: { kind: \"bar\"|\"line\"|\"area\"|\"pie\"|\"scatter\", title?, xAxis?: string[], yName?, series: [{ name?, data: number[] }] }."
};
/**
* JSON-Schema for the model-facing `widget` parameter (the open object; the
* parser performs the strict/closed validation the schema cannot express).
* Kept in sync with widget.ts's field vocabulary.
*/
const WIDGET_PARAMETER_SCHEMA = {
	type: "object",
	additionalProperties: true,
	description: "Structured widget payload: { kind: \"svg\"|\"html\", code: string, title?: string }. code is the raw SVG document or HTML body content (max 128 KB), rendered in a sandboxed frame."
};
/** Output schema: the canonical value is exactly one of `{ spec }` / `{ widget }`. */
const OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		spec: SPEC_PARAMETER_SCHEMA,
		widget: WIDGET_PARAMETER_SCHEMA
	}
};
/** Tool name (the client Definitions gate their matches on it). */
const VISUALIZE_TOOL = "visualize";
/**
* Validate and settle one tool call. Pure: exported for unit tests.
* @param args - raw model-produced arguments.
* @returns the canonical value `{ spec }` or `{ widget }`; rejects on
*   missing/ambiguous payloads or validation failure (the tool reports the
*   message back to the model).
*/
function executeVisualize(args) {
	const record = args === null || typeof args !== "object" || Array.isArray(args) ? {} : args;
	const hasSpec = record["spec"] !== void 0;
	if (hasSpec === (record["widget"] !== void 0)) return Promise.reject(/* @__PURE__ */ new Error(hasSpec ? "provide exactly one of `spec` or `widget`" : "`spec` or `widget` is required"));
	if (hasSpec) {
		const parsed = parseChartSpec(record["spec"]);
		if (!parsed.ok) return Promise.reject(/* @__PURE__ */ new Error(`invalid chart spec: ${parsed.message}`));
		return Promise.resolve({ spec: JSON.parse(JSON.stringify(parsed.spec)) });
	}
	const parsed = parseWidgetSpec(record["widget"]);
	if (!parsed.ok) return Promise.reject(/* @__PURE__ */ new Error(`invalid widget spec: ${parsed.message}`));
	return Promise.resolve({ widget: JSON.parse(JSON.stringify(parsed.widget)) });
}
/**
* Build the tool definition (called inside `apply`, mirroring the original
* registry timing; the definition itself is inert until registered).
* @returns the `visualize` tool definition.
*/
function createVisualizeTool() {
	return defineTool({
		name: VISUALIZE_TOOL,
		description: "Render a chart or a static SVG/HTML widget into the conversation. Charts: pass `spec` — pure data: {\"kind\":\"bar|line|area|pie|scatter\",\"title\":\"optional\",\"xAxis\":[\"category labels\"],\"yName\":\"optional y axis name\",\"series\":[{\"name\":\"optional\",\"data\":[1,2,3]}]}. A bar/line/area spec needs xAxis labels and numeric series data; a pie spec uses xAxis as slice names and series[0].data as the values; a scatter spec pairs xAxis labels with series[0].data values. Widgets: pass `widget` — {\"kind\":\"svg|html\",\"code\":\"<raw SVG or HTML body>\",\"title\":\"optional\"}; code renders inside a sandboxed frame (scripts and network disabled). For a widget that should appear progressively while you are still writing it, prefer emitting it as a fenced code block in your normal text response: ```svg … ``` or ```html … ```; the client renders those fences as live widgets too. Pass exactly one of `spec` or `widget`. Use it for data the user asked to see — never for prose.",
		parameters: {
			spec: SPEC_PARAMETER_SCHEMA,
			widget: WIDGET_PARAMETER_SCHEMA
		},
		output: {
			schema: OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value)
			}]
		},
		execute: executeVisualize
	});
}
//#endregion
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "dsh-visualizer";
/**
* Services this plugin reads at apply time. The loader defers activation
* until the 'tools' service (provided by @deepseek-ai/dsh-tools) exists,
* mirroring every other DSH tool plugin; without this the registry access
* below throws "cannot get property 'tools' without inject".
*/
const inject = ["tools"];
/**
* Register the `visualize` tool with the host tools registry.
* @param ctx - host cordis context (provides `tools`).
* @returns disposer (running with the fiber automatically).
*/
function registerVisualizeTool(ctx) {
	return ctx.tools.register(createVisualizeTool());
}
/** Apply the host half: register the visualize tool. */
function apply(ctx) {
	ctx.effect(() => registerVisualizeTool(ctx), "dsh-visualizer: visualize tool");
}
//#endregion
export { apply, inject, name, registerVisualizeTool };
