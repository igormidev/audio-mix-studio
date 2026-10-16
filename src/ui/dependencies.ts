import type { DependencyStatus } from "../shared/types";

let pending: Promise<DependencyStatus> | null = null;
let cached: { value: DependencyStatus; at: number } | null = null;
export function rememberDependencies(
  value: DependencyStatus,
): DependencyStatus {
  cached = { value, at: Date.now() };
  return value;
}
/** Tab creation does not launch duplicate Python/model-health checks. */
export function loadDependencies(force = false): Promise<DependencyStatus> {
  if (pending) return pending;
  if (!force && cached && Date.now() - cached.at < 10_000)
    return Promise.resolve(cached.value);
  pending = window.studio
    .dependencies()
    .then((value) => {
      return rememberDependencies(value);
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
