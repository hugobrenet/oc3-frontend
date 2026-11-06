import streams from "./fixtures/agui-streams.json";
import {
  createAssistantClient,
  type RunInput,
  type RunOptions,
  type RunResult,
} from "../assistant-client";

/**
 * The AG-UI streams the agent serves in the scenarios of a client, exported by
 * the test TestGoldenAGUIStreams of the agent (internal/api/testdata/agui/
 * streams.json): this page replays what the agent emits, and a change of the
 * protocol breaks its tests. Each runs on the conversation conversation-id as
 * the run run-1.
 */
export const GOLDEN_THREAD = "conversation-id";
export const GOLDEN_RUN = "run-1";

interface GoldenStream {
  name: string;
  request: Record<string, unknown>;
  status: number;
  contentType: string;
  body: string;
}

export function goldenStream(name: string): GoldenStream {
  const stream = (streams as GoldenStream[]).find((item) => item.name === name);
  if (stream === undefined) throw new Error(`no golden AG-UI stream ${name}`);
  return stream;
}

/** A response with the chunks of a body, each a string or bytes. */
export function streamResponse(
  chunks: (string | Uint8Array)[],
  { status = 200, contentType = "text/event-stream; charset=utf-8" } = {},
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
        controller.close();
      },
    }),
    { status, headers: { "Content-Type": contentType } },
  );
}

/** The response of the agent in a golden scenario. */
export function goldenResponse(name: string): Response {
  const stream = goldenStream(name);
  return streamResponse([stream.body], { status: stream.status, contentType: stream.contentType });
}

/** One AG-UI event as the agent frames it. */
export const aguiFrame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
export const runStarted = { type: "RUN_STARTED", threadId: GOLDEN_THREAD, runId: GOLDEN_RUN };
export const runFinished = (fields: Record<string, unknown> = {}) => ({
  type: "RUN_FINISHED",
  threadId: GOLDEN_THREAD,
  runId: GOLDEN_RUN,
  outcome: { type: "success" },
  result: { turnId: "turn-1" },
  ...fields,
});

type Run = (id: string, input: RunInput, options?: RunOptions) => Promise<RunResult>;

/**
 * A run of a client of the agent that replays the response given through the
 * reader of this page, whatever the conversation: for the tests of the hook and
 * of the components.
 */
const replayResponse =
  (response: () => Response): Run =>
  async (_id, input, options) => {
    const client = createAssistantClient({ newId: () => GOLDEN_RUN });
    const fetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(response());
    try {
      return await client.run(GOLDEN_THREAD, input, options);
    } finally {
      globalThis.fetch = fetch;
    }
  };

/** A run that replays a golden scenario. */
export const replayRun = (name: string) => replayResponse(() => goldenResponse(name));

/** A run that replays the events given, as the agent frames them. */
export const replayEvents = (events: unknown[]) =>
  replayResponse(() => streamResponse([events.map(aguiFrame).join("")]));
