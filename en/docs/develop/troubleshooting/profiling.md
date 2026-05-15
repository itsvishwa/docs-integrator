---
sidebar_position: 5
title: Profiling
description: Profile integrations to find performance bottlenecks using the Ballerina profiler and runtime tuning.
---

# Profiling

The Ballerina profiler samples your integration at runtime and produces an interactive flame graph that shows where execution time is spent. Use it when you have a slow integration and need to find the hot path before tuning anything.

:::caution
The profiler is experimental and adds significant overhead. Run it in development or a load-test environment, not in production.
:::

## Run the profiler

From the project root, run:

```bash
bal profile
```

The profiler proceeds through six stages: initializing the session, copying the executable, performing analysis, instrumenting functions, running the executable, and generating output. When it finishes, an interactive HTML report is written to `target/bin/ProfilerOutput.html`.

## Profile a service

For an HTTP service or any long-running integration, drive traffic at the profiled process and stop it when you have a representative sample.

```bash
# Terminal 1: start the service under the profiler
bal profile

# Terminal 2: drive requests
curl http://localhost:9090/api/orders
curl -X POST http://localhost:9090/api/orders \
  -H "Content-Type: application/json" \
  -d '{"product": "Widget", "quantity": 5}'
```

Press `Ctrl+C` in the first terminal to stop the run. The profiler writes `target/bin/ProfilerOutput.html`; open it in a browser to explore the flame graph.

## Read the flame graph

![Profiler flame graph report](/img/develop/troubleshooting/profiling/report.png)

Each bar in the graph represents a function call.

- **Bar width** is proportional to time spent in that function.
- **Vertical stacking** shows the call hierarchy. Callers are below, callees above.
- **Wide bars at the bottom** consume the most total time, but the time may be spread across their children.
- **Wide bars at the top** are the actual hotspots, since they have no further callees to pass the time to.

Use the search, zoom, and reset controls to focus on specific call paths.

## Tune connection pools

If the flame graph points at network or database calls, the next step is usually pool configuration. A pool that is too small queues requests; a pool that is too large can overwhelm the backend.

### HTTP client pool

```ballerina
http:Client apiClient = check new ("http://backend.internal", {
    poolConfig: {
        maxActiveConnections: 200,
        maxIdleConnections: 50,
        waitTime: 10
    },
    timeout: 30
});
```

### SQL connection pool

```ballerina
postgresql:Client dbClient = check new (
    host = "localhost",
    database = "mydb",
    connectionPool = {
        maxOpenConnections: 25,
        maxConnectionLifeTime: 600.0,
        minIdleConnections: 5
    }
);
```

If many strands are waiting on a pool, see [Strand dump analysis](strand-dump-analysis.md) to confirm the bottleneck before raising limits.

## Tune the runtime thread pool

Ballerina's scheduler defaults to a thread pool of `number of CPU cores × 2`. Override it with the `BALLERINA_MAX_POOL_SIZE` environment variable:

```bash
export BALLERINA_MAX_POOL_SIZE=16
bal run .
```

Raise the value when long-running blocking calls (legacy JDBC drivers, external Java libraries) are tying up scheduler workers and starving other strands.

### Diagnose thread starvation

When requests stop progressing even though the service is up, and latency climbs linearly, the scheduler is most likely starved.

- Capture a strand dump with `kill -SIGTRAP <pid>` and look for blocked `ballerina-scheduler` strands. See [Strand dump analysis](strand-dump-analysis.md).
- Capture a JVM thread dump with `jstack <pid>` for the OS-thread view.

## Tune JVM memory

Increase the heap when you hit `OutOfMemoryError`:

```bash
export JAVA_OPTS="-Xmx2g -Xms512m"
bal run .
```

Have the JVM emit a heap dump automatically on OOM so you can analyze it after the fact:

```bash
export JAVA_OPTS="-Xmx2g -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/tmp/"
bal run .
```

## Verify concurrency safety

The `isolated` keyword turns concurrency safety into a compile-time check. Mark a service or function `isolated` and the compiler flags any unsafe access to shared mutable state. This catches data races before they reach production.

Note that even without `isolated`, the runtime may invoke a resource function concurrently. Without isolation guarantees, you have to enforce safety yourself.

## Optimization checklist

- Run independent external calls in parallel using workers.
- Pool connections for databases and HTTP clients.
- Cache values that are read often and change rarely.
- Use typed records instead of repeatedly parsing JSON.
- Minimize serialization and deserialization on the hot path.
- Use query expressions for collection processing.
- Set timeouts on every external call.
- Stream large payloads instead of buffering them in memory.

## Best practices

- Measure before optimizing. Profile first, then change one thing at a time.
- Test under realistic load. Single-request profiling hides contention.
- Focus on the critical path. Optimizations off the hot path rarely pay back.
- Compare profiler output before and after each change.
- Monitor production with observability metrics so regressions show up early.

## Related

- [Strand dump analysis](strand-dump-analysis.md) - diagnose concurrency issues spotted while profiling.
- [Logging](logging.md) - when logs are a better diagnostic than a live profile.
- [Errors and stack traces](errors-and-stack-traces.md) - read failures back to source.
