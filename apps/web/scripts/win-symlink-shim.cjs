/**
 * Windows-only build shim for the OpenNext Cloudflare build (local dev PCs without admin/Developer Mode).
 *
 * OpenNext recreates pnpm's node_modules symlinks inside .open-next/. On Windows, creating a
 * symlink needs admin rights or Developer Mode, so it fails with EPERM. Directory *junctions* do not.
 * This preload retries a failed symlink as a junction (directories) or a file copy (files).
 *
 * No-op on non-Windows platforms (CI on Linux never touches it). Loaded only by scripts/cf.mjs.
 */
"use strict";

if (process.platform === "win32") {
  const fs = require("node:fs");
  const path = require("node:path");
  const { syncBuiltinESMExports } = require("node:module");

  // On Windows, Next's standalone output stores pnpm links as junctions with ABSOLUTE targets
  // inside `.next/standalone`. OpenNext copies those targets verbatim, so links in
  // `.open-next/server-functions/<fn>` would point back at the unpatched standalone tree
  // (on Linux the targets are relative and stay inside .open-next). Re-root them.
  const STANDALONE = `${path.sep}.next${path.sep}standalone${path.sep}`;
  const FN_ROOT = /^(.*[\\/]\.open-next[\\/]server-functions[\\/][^\\/]+)[\\/]/;
  const resolveTarget = (target, linkPath) => {
    const t = String(target);
    const link = path.resolve(String(linkPath));
    if (!path.isAbsolute(t)) return path.resolve(path.dirname(link), t);
    const i = t.indexOf(STANDALONE);
    const fnRoot = FN_ROOT.exec(link);
    if (i !== -1 && fnRoot) return path.join(fnRoot[1], t.slice(i + STANDALONE.length));
    return t;
  };

  const rebase = (target, linkPath) => (path.isAbsolute(String(target)) ? resolveTarget(target, linkPath) : target);

  const fallbackSync = (target, linkPath) => {
    const abs = resolveTarget(target, linkPath);
    let isFile = false;
    try {
      isFile = fs.statSync(abs).isFile();
    } catch {
      // Target not copied yet: pnpm links point at package directories, so use a junction.
    }
    if (isFile) fs.copyFileSync(abs, linkPath);
    else origSymlinkSync(abs, linkPath, "junction");
  };

  const origSymlinkSync = fs.symlinkSync;
  fs.symlinkSync = function symlinkSync(target, linkPath, type) {
    try {
      return origSymlinkSync(rebase(target, linkPath), linkPath, type);
    } catch (e) {
      if (e && e.code === "EPERM") return fallbackSync(target, linkPath);
      throw e;
    }
  };

  const origSymlink = fs.symlink;
  fs.symlink = function symlink(target, linkPath, type, cb) {
    const callback = typeof type === "function" ? type : cb;
    const t = typeof type === "function" ? undefined : type;
    origSymlink(rebase(target, linkPath), linkPath, t, (err) => {
      if (err && err.code === "EPERM") {
        try {
          fallbackSync(target, linkPath);
          return callback(null);
        } catch (e2) {
          return callback(e2);
        }
      }
      return callback(err);
    });
  };

  const origPromiseSymlink = fs.promises.symlink;
  fs.promises.symlink = async function symlink(target, linkPath, type) {
    try {
      return await origPromiseSymlink(rebase(target, linkPath), linkPath, type);
    } catch (e) {
      if (e && e.code === "EPERM") return fallbackSync(target, linkPath);
      throw e;
    }
  };

  syncBuiltinESMExports();
}
