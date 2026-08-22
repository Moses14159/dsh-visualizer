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
/** Chart kinds requiring a scatter-point reading; kept for renderers. */
function isPairKind(kind) {
	return kind === "scatter";
}
//#endregion
//#region src/widget.ts
/** Upper bound on one widget's code, in UTF-8 bytes. */
const MAX_WIDGET_BYTES = 131072;
/** Upper bound on an optional title, in characters. */
const MAX_WIDGET_TITLE = 120;
/** Upper bound on widgets materialized into one chat node. */
const MAX_WIDGETS_PER_NODE = 12;
/** Upper bound on the total UTF-8 bytes of one chat node's widgets. */
const MAX_NODE_WIDGET_BYTES = 524288;
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
/**
* Open-fence lines: up to three leading spaces (CommonMark), exactly three
* backticks, then one of the known kinds, then optional info text.
*/
const FENCE_OPEN = /^\s{0,3}```(svg|html)(?:\s+(.*?))?\s*$/;
/** Close-fence lines: only backticks, at least three (CommonMark: a closing
*  fence may be longer than the opening one; any letters keep it content). */
const FENCE_CLOSE = /^\s{0,3}```+\s*$/;
/** Fresh scanner state (shared; immutable updates never mutate it). */
const EMPTY_SCANNER = Object.freeze({
	kind: void 0,
	title: void 0,
	content: "",
	bytes: 0,
	overflow: false,
	pending: "",
	closed: []
});
/** Strip one trailing newline (content stores one per complete line). */
function stripTrailingNewline(content) {
	return content.endsWith("\n") ? content.slice(0, -1) : content;
}
/** Build the accumulator for a fence that opened and is live/closed now. */
function accOf(kind, title, content, closed, overflow) {
	return {
		kind,
		code: stripTrailingNewline(content),
		...title === void 0 ? {} : { title },
		closed,
		overflow
	};
}
/** Process one complete line (no newline, no carriage return). */
function pushLine(state, line) {
	if (state.kind === void 0) {
		const open = FENCE_OPEN.exec(line);
		if (open === null) return state;
		const kind = open[1];
		const info = (open[2] ?? "").trim();
		return {
			kind,
			title: info === "" ? void 0 : info.slice(0, 120),
			content: "",
			bytes: 0,
			overflow: false,
			pending: "",
			closed: state.closed
		};
	}
	if (FENCE_CLOSE.test(line)) {
		if (state.content === "") return {
			...EMPTY_SCANNER,
			closed: state.closed
		};
		const acc = accOf(state.kind, state.title, state.content, true, state.overflow);
		return {
			...EMPTY_SCANNER,
			closed: [...state.closed, acc]
		};
	}
	if (state.overflow) return state;
	const piece = `${line}\n`;
	const pieceBytes = utf8ByteLength(piece);
	if (state.bytes + pieceBytes > 131072) return {
		...state,
		overflow: true
	};
	return {
		...state,
		content: state.content + piece,
		bytes: state.bytes + pieceBytes
	};
}
/**
* Feed one raw text delta into the scanner. Deltas may split lines at any
* byte; the scanner buffers the partial line and only complete lines drive
* the fence state machine, so the same content folds identically however the
* provider chunks it.
* @param state - current scanner state.
* @param text - one model text delta.
* @returns next scanner state (immutable update).
*/
function pushScannerText(state, text) {
	if (text === "") return state;
	const parts = `${state.pending}${text}`.split("\n");
	const pending = parts.pop() ?? "";
	let next = {
		...state,
		pending
	};
	for (const raw of parts) next = pushLine(next, raw.endsWith("\r") ? raw.slice(0, -1) : raw);
	return {
		...next,
		pending
	};
}
/**
* Close the scanner at stream/message end: a fence left open by an
* interrupted or never-closed stream becomes an incomplete accumulator
* (rendered with a live/incomplete badge), never dropped silently. The
* partial pending line counts as content — the model may stop mid-line.
* @param state - final scanner state.
* @returns every completed widget plus the incomplete one, in opening order.
*/
function finishScanner(state) {
	const closed = [...state.closed];
	if (state.kind !== void 0) {
		const code = state.content + state.pending;
		if (code !== "") closed.push(accOf(state.kind, state.title, code, false, state.overflow));
	}
	return closed;
}
//#endregion
//#region src/to-iframe.ts
/** Shared document head pieces (single assembly point, tested verbatim). */
const DOCUMENT_PREFIX = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;
/** Body styles: SVG scales to the frame width and grows the document with
*  its aspect (min-height keeps the scroll box working when the frame is
*  clamped); HTML is laid out top-left. */
const BODY_STYLE_SVG = "<style>html,body{margin:0;padding:0;min-height:100%;background:transparent}svg{display:block;max-width:100%;height:auto;margin:0 auto}</style>";
const BODY_STYLE_HTML = "<style>html,body{margin:0;padding:0;background:transparent}</style>";
/**
* Build the complete srcdoc document for one validated widget.
* @param widget - validated widget ({@link WidgetSpec} or accumulator).
* @returns deterministic srcdoc string (pure function of the widget).
*/
function widgetSrcdoc(widget) {
	const title = widget.title === void 0 ? "" : `<title>${widget.title}</title>`;
	const bodyStyle = widget.kind === "svg" ? BODY_STYLE_SVG : BODY_STYLE_HTML;
	return `${DOCUMENT_PREFIX}${title}${bodyStyle}</head><body>${widget.code}</body></html>`;
}
/**
* Read the first text block of a settled tool result.
*
* The durable shape is nested: `message.content[0]` is a `tool-result` block
* whose own `content` array carries the real blocks, and our host tool emits
* `[{ type: 'text', text: <spec JSON> }]` there. Walk both levels (outer
* blocks + tool-result inner blocks) so shape drift on either level degrades
* to "no text" instead of a broken render.
* @param match - folded match.
* @returns text content, when present.
*/
function resultText(match) {
	if (match.event.type !== "tool/result") return void 0;
	const message = match.event.data["message"];
	if (message === null || typeof message !== "object") return void 0;
	const blocks = message["content"];
	if (!Array.isArray(blocks)) return void 0;
	for (const block of blocks) {
		if (block === null || typeof block !== "object") continue;
		const record = block;
		if (record["type"] === "text" && typeof record["text"] === "string") return record["text"];
		if (record["type"] !== "tool-result") continue;
		const inner = record["content"];
		if (!Array.isArray(inner)) continue;
		for (const candidate of inner) if (candidate !== null && typeof candidate === "object") {
			const innerBlock = candidate;
			if (innerBlock["type"] === "text" && typeof innerBlock["text"] === "string") return innerBlock["text"];
		} else if (typeof candidate === "string") return candidate;
	}
}
/**
* Definition-local id: the call's durable id. `tool/call` is gated on the
* `visualize` name (only our calls may start a Context); `tool/result`
* matches by callId, and an orphan result without a start can never build a
* node — the engine requires a start for a Context body.
* @param event - raw session event.
* @returns id, when this event belongs to a visualizer call.
*/
function callIdOf(event) {
	if (event.type === "tool/call" && event.data["name"] === "visualize") return typeof event.data["callId"] === "string" && event.data["callId"] !== "" ? event.data["callId"] : void 0;
	if (event.type === "tool/result") {
		const message = event.data["message"];
		if (message === null || typeof message !== "object") return void 0;
		const id = message["source"]?.callId;
		return typeof id === "string" && id !== "" ? id : void 0;
	}
}
//#endregion
//#region src/client/widget-fold.ts
/** The kind this plugin renders under (dispatch key of the chat node seat). */
const WIDGET_KIND = "visualizer-widget";
/** Build the stable id a step-scoped stream event belongs to. */
function stepId(turn, step) {
	if (typeof turn !== "number" || typeof step !== "number") return void 0;
	if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(step)) return void 0;
	if (turn < 0 || step < 0) return void 0;
	return `step:${turn}:${step}`;
}
/**
* Definition-local identity for one raw session event.
* @param event - raw session event.
* @returns `{ id, role }`, or null when the event does not belong to this
*   definition.
*/
function widgetMatchOf(event) {
	switch (event.type) {
		case "step/start": {
			const id = stepId(event.data["turn"], event.data["step"]);
			return id === void 0 ? null : {
				id,
				role: "start"
			};
		}
		case "assistant/chunk":
		case "assistant/message":
		case "step/end":
		case "llm/retry": {
			const id = stepId(event.data["turn"], event.data["step"]);
			return id === void 0 ? null : {
				id,
				role: "update"
			};
		}
		case "tool/call": {
			if (event.data["name"] !== "visualize") return null;
			const callId = event.data["callId"];
			if (typeof callId !== "string" || callId === "") return null;
			return {
				id: `widget:${callId}`,
				role: "start"
			};
		}
		case "tool/result": {
			const id = callIdOf(event);
			if (id === void 0) return null;
			return {
				id: `widget:${id}`,
				role: "update"
			};
		}
		default: return null;
	}
}
/** Build a complete (closed) accumulator from a validated tool widget. */
function accOfWidget(widget) {
	return {
		...widget,
		closed: true,
		overflow: false
	};
}
/**
* Parse a settled tool result's JSON text into a validated WidgetSpec.
*
* The host tool's canonical value is `{ widget: WidgetSpec }` and its render
* emits the whole envelope as text; the parsed root may wrap the widget in a
* `widget` key. Accept both the bare spec and the one-level envelope; a chart
* result (which wraps `spec` instead) parses to undefined, leaving it to the
* `visualizer-chart` definition.
* @param match - folded tool/result match.
* @returns validated widget, or undefined on any parse/validation failure.
*/
function widgetFromResult(match) {
	const text = resultText(match);
	if (text === void 0) return void 0;
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
		const nested = parsed["widget"];
		if (nested !== null && typeof nested === "object") parsed = nested;
	}
	const result = parseWidgetSpec(parsed);
	return result.ok ? result.widget : void 0;
}
/**
* Create the State from the start Match (step/start for streams, tool/call
* for tool-delivered widgets).
* @param context - assembled context.
* @param match - start match.
* @returns fresh state.
*/
function widgetStartState(context, match) {
	if (match.event.type === "tool/call") {
		const data = match.event.data;
		return {
			source: "tool",
			callId: typeof data["callId"] === "string" ? data["callId"] : context.id,
			turn: typeof data["turn"] === "number" ? data["turn"] : 0,
			step: typeof data["step"] === "number" ? data["step"] : 0,
			scan: EMPTY_SCANNER,
			widgets: [],
			settled: false
		};
	}
	const data = match.event.data;
	return {
		source: "stream",
		turn: typeof data["turn"] === "number" ? data["turn"] : 0,
		step: typeof data["step"] === "number" ? data["step"] : 0,
		scan: EMPTY_SCANNER,
		widgets: [],
		settled: false
	};
}
/**
* Fold one update Match into State.
* @param context - context with current state.
* @param match - update match in ascending log order.
* @returns next state (immutable).
*/
function widgetUpdateState(context, match) {
	const state = context.state;
	if (state.source === "tool") {
		if (match.event.type !== "tool/result") return state;
		const widget = widgetFromResult(match);
		if (widget === void 0) return state;
		return {
			...state,
			widgets: [accOfWidget(widget)],
			settled: true
		};
	}
	if (match.event.type === "llm/retry") return {
		...state,
		scan: EMPTY_SCANNER,
		widgets: [],
		settled: false
	};
	if (state.settled) return state;
	if (match.event.type === "assistant/chunk") {
		const chunk = match.event.data["chunk"];
		if (chunk === null || typeof chunk !== "object" || chunk["type"] !== "text-delta") return state;
		const text = chunk["text"];
		if (typeof text !== "string" || text === "") return state;
		return {
			...state,
			scan: pushScannerText(state.scan, text)
		};
	}
	if (match.event.type === "assistant/message" || match.event.type === "step/end") {
		const done = finishScanner(state.scan);
		return {
			...state,
			scan: EMPTY_SCANNER,
			widgets: [...state.widgets, ...done],
			settled: true
		};
	}
	return state;
}
/** Walk a message content array for text blocks (narrow structural guard). */
function* messageTexts(content) {
	if (!Array.isArray(content)) return;
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		const record = block;
		if (record["type"] === "text" && typeof record["text"] === "string") yield record["text"];
	}
}
/**
* Rebuild state from a cold window: the engine knows no start Match, so the
* fold scans the settled evidence it does have — a `tool/result` carrying a
* widget, or the step's final `assistant/message` text scanned whole.
* @param context - assembled context.
* @returns recovered state, when any widget content exists.
*/
function fallbackWidgetState(context) {
	for (const match of context.matches) {
		if (match.event.type !== "tool/result") continue;
		const id = callIdOf(match.event);
		const widget = widgetFromResult(match);
		if (id === void 0 || widget === void 0) continue;
		const data = match.event.data;
		return {
			source: "tool",
			callId: id,
			turn: typeof data["turn"] === "number" ? data["turn"] : 0,
			step: typeof data["step"] === "number" ? data["step"] : 0,
			scan: EMPTY_SCANNER,
			widgets: [accOfWidget(widget)],
			settled: true
		};
	}
	let state;
	for (const match of context.matches) {
		if (match.event.type !== "assistant/message") continue;
		const data = match.event.data;
		const turn = typeof data["turn"] === "number" ? data["turn"] : 0;
		const step = typeof data["step"] === "number" ? data["step"] : 0;
		state ??= {
			source: "stream",
			turn,
			step,
			scan: EMPTY_SCANNER,
			widgets: [],
			settled: true
		};
		const message = data["message"];
		if (message === null || typeof message !== "object") continue;
		for (const text of messageTexts(message["content"])) state = {
			...state,
			scan: pushScannerText(state.scan, text)
		};
	}
	if (state === void 0) return void 0;
	const done = finishScanner(state.scan);
	if (done.length === 0 && state.widgets.length === 0) return void 0;
	return {
		...state,
		scan: EMPTY_SCANNER,
		widgets: [...state.widgets, ...done]
	};
}
/** Live accumulator for a fence still open (streaming in progress). The
*  partial pending line is content — the model may be mid-line right now. */
function liveAcc(scan) {
	if (scan.kind === void 0) return void 0;
	const raw = scan.content + scan.pending;
	if (raw === "") return void 0;
	const code = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
	return {
		kind: scan.kind,
		code,
		...scan.title === void 0 ? {} : { title: scan.title },
		closed: false,
		overflow: scan.overflow
	};
}
/** Apply the per-node count/byte caps over the materialized widget list. */
function capWidgets(all) {
	const widgets = [];
	let bytes = 0;
	let dropped = 0;
	for (const acc of all) {
		const size = utf8ByteLength(acc.code);
		if (widgets.length >= 12 || bytes + size > 524288) {
			dropped += 1;
			continue;
		}
		widgets.push(acc);
		bytes += size;
	}
	return {
		widgets,
		dropped
	};
}
/**
* Materialize the chat node, or null while no widget content is folded yet.
* @param context - assembled context.
* @returns final node.
*/
function buildWidgetViewNode(context) {
	const fallback = context.state === void 0 ? fallbackWidgetState(context) : void 0;
	const state = context.state ?? fallback;
	if (state === void 0) return null;
	const live = liveAcc(state.scan);
	const capped = capWidgets([
		...state.widgets,
		...state.scan.closed,
		...live === void 0 ? [] : [live]
	]);
	if (capped.widgets.length === 0) return null;
	return {
		key: context.key,
		kind: WIDGET_KIND,
		id: context.id,
		target: "chat",
		anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
		location: context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" },
		visibility: "visible",
		data: {
			widgets: capped.widgets,
			source: state.source,
			...state.callId === void 0 ? {} : { callId: state.callId },
			dropped: capped.dropped
		}
	};
}
//#endregion
export { EMPTY_SCANNER, MAX_NODE_WIDGET_BYTES, MAX_WIDGETS_PER_NODE, MAX_WIDGET_BYTES, MAX_WIDGET_TITLE, WIDGET_KIND, buildWidgetViewNode, fallbackWidgetState, finishScanner, isPairKind, parseChartSpec, parseWidgetSpec, pushScannerText, utf8ByteLength, widgetFromResult, widgetMatchOf, widgetSrcdoc, widgetStartState, widgetUpdateState };
