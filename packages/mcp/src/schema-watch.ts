import { getRelaySchemaWatchPaths } from "@relay-dx/schema";
import { watch } from "chokidar";
import { existsSync } from "node:fs";
import { dirname, relative, isAbsolute, sep } from "node:path";
import type { RelaySchemaLoadOptions } from "./types.js";

function contains(parent: string, child: string) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export async function watchRelaySchema(
  options: RelaySchemaLoadOptions,
  reload: () => Promise<unknown>,
) {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      // The state retains the last good schema and records load failures.
      void reload().catch(() => {});
    }, 100);
  };
  const createWatcher = async (paths: string[]) => {
    // Missing nested paths need an existing ancestor to observe directory creation.
    const roots = paths.map((path) => {
      while (!existsSync(path) && dirname(path) !== path) path = dirname(path);
      return path;
    });
    const watcher = watch(roots, {
      ignoreInitial: true,
      // Filter the ancestor's other children so worktrees stay cheap to watch.
      ignored: (path) =>
        /(^|[/\\])(node_modules|\.git|__generated__)([/\\]|$)/.test(path) ||
        !paths.some((target) => contains(target, path) || contains(path, target)),
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
    });
    watcher.on("all", changed);
    watcher.on("error", (error) => {
      process.stderr.write(`relay-mcp: Schema watcher failed: ${String(error)}\n`);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        watcher.once("ready", resolve);
        watcher.once("error", reject);
      });
      return watcher;
    } catch (error) {
      await watcher.close();
      throw error;
    }
  };
  let paths = getRelaySchemaWatchPaths(options);
  let watcher = await createWatcher(paths);
  return {
    async update(nextOptions: RelaySchemaLoadOptions = options) {
      if (closed) return;
      const next = getRelaySchemaWatchPaths(nextOptions);
      if (next.length === paths.length && next.every((path) => paths.includes(path))) return;
      // Replacing the watcher avoids unwatching an ancestor also disabling a
      // retained child. Keep the old watcher active until the new one is ready.
      const nextWatcher = await createWatcher(next);
      if (closed) {
        await nextWatcher.close();
        return;
      }
      const previous = watcher;
      watcher = nextWatcher;
      paths = next;
      options = nextOptions;
      await previous.close();
    },
    async close() {
      closed = true;
      clearTimeout(timer);
      await watcher.close();
    },
  };
}
