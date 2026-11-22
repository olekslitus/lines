/**
 * How long `work` kept this process busy, in milliseconds: its CPU time, not time on the clock, so a
 * test that something is quick isn't failed by other programs taking the machine meanwhile (a busy
 * CI runner, a build alongside), which a clock counts. It includes the engine's own threads (its
 * garbage collector and compiler), so it's a little more than the work alone.
 */
export async function cpuTime(work: () => unknown) {
  const start = process.cpuUsage();
  await work();
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
}
