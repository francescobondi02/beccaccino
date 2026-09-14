import {
  GameEvent,
  RuntimeDirective,
  TransitionOutcome,
} from "./transitions/types";

export async function coordinateOutcome<T>(
  outcome: TransitionOutcome<T>,
  dependencies: {
    applyRuntime: (directive: RuntimeDirective | null) => void;
    publishEvents: (events: readonly GameEvent[]) => void | Promise<void>;
  },
): Promise<T> {
  dependencies.applyRuntime(outcome.runtime);
  try {
    await dependencies.publishEvents(outcome.events);
  } catch {
    // The database commit and runtime handoff already succeeded. Publication
    // is best-effort and must not turn a committed action into an HTTP failure.
  }
  return outcome.value;
}
