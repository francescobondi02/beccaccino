import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  parseAnnotationDatabaseArgs,
} from "../../src/scripts/annotationDatabaseCli";
import {
  describeDatabaseUrl,
  loadEnvironmentFile,
} from "../../src/scripts/annotationEnvironment";
import {
  annotationImportPlanToken,
  annotationRestorePlanToken,
} from "../../src/scripts/annotationDatabase";
import { writeAnnotationExportFile } from "../../src/scripts/atomicAnnotationExport";
import { readAnnotationBatch } from "../../src/scripts/importAnnotationScenarios";
import { canonicalJson } from "../../src/annotations/state";
import {
  annotationBatchArtifacts,
  writeAnnotationBatchFiles,
} from "../helpers/annotationBatch";
import { chooseBriscolaScenarioInput } from "../helpers/annotationScenario";

describe("annotation database operator arguments", () => {
  it("parses status and dry-run imports from explicit environment files", () => {
    expect(
      parseAnnotationDatabaseArgs([
        "status",
        "--env-file",
        "/tmp/annotation.env",
      ]),
    ).toEqual({
      command: "status",
      envFile: "/tmp/annotation.env",
    });
    expect(
      parseAnnotationDatabaseArgs([
        "import",
        "batch.json",
        "manifest.json",
        "--env-file",
        "/tmp/annotation.env",
        "--replace-active",
      ]),
    ).toEqual({
      command: "import",
      envFile: "/tmp/annotation.env",
      batchPath: "batch.json",
      manifestPath: "manifest.json",
      apply: false,
      replaceActive: true,
      confirmPlan: undefined,
    });
    expect(
      parseAnnotationDatabaseArgs([
        "restore-active",
        "expert-v1",
        "--env-file",
        "/tmp/annotation.env",
      ]),
    ).toEqual({
      command: "restore-active",
      envFile: "/tmp/annotation.env",
      sourceBatch: "expert-v1",
      apply: false,
      confirmPlan: undefined,
    });
  });

  it("requires a confirmed dry-run plan for apply", () => {
    expect(() =>
      parseAnnotationDatabaseArgs([
        "import",
        "batch.json",
        "manifest.json",
        "--env-file",
        "/tmp/annotation.env",
        "--apply",
      ]),
    ).toThrow(/requires --confirm-plan/);
    expect(() =>
      parseAnnotationDatabaseArgs([
        "restore-active",
        "expert-v1",
        "--env-file",
        "/tmp/annotation.env",
        "--apply",
      ]),
    ).toThrow(/requires --confirm-plan/);
  });

  it("rejects unknown commands, arguments, and implicit environments", () => {
    expect(() => parseAnnotationDatabaseArgs(["status"])).toThrow(
      /--env-file is required/,
    );
    expect(() =>
      parseAnnotationDatabaseArgs([
        "delete",
        "--env-file",
        "/tmp/annotation.env",
      ]),
    ).toThrow(/unknown command/);
    expect(() =>
      parseAnnotationDatabaseArgs([
        "status",
        "--env-file",
        "/tmp/annotation.env",
        "--apply",
      ]),
    ).toThrow(/unexpected argument/);
  });

  it("describes a database URL without credentials or query parameters", () => {
    const raw =
      "postgresql://private-user:private-password@db.example.com:6432/becca?sslmode=require";
    const description = describeDatabaseUrl(raw);

    expect(description).toEqual({
      host: "db.example.com",
      port: "6432",
      database: "becca",
    });
    expect(JSON.stringify(description)).not.toContain("private");
    expect(() => describeDatabaseUrl("https://db.example.com/becca")).toThrow(
      /must use postgres/,
    );
  });

  it("rejects broadly readable environment files without exposing secrets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "annotation-env-test-"));
    const envFile = join(directory, "annotations.env");
    const secret = "do-not-print-this-password";
    await writeFile(
      envFile,
      `DATABASE_URL="postgresql://user:${secret}@localhost:5432/becca"\n` +
        `DIRECT_URL="postgresql://user:${secret}@localhost:5432/becca"\n`,
    );
    await chmod(envFile, 0o644);

    try {
      const error = await loadEnvironmentFile(envFile).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/permissions must be 600/);
      expect((error as Error).message).not.toContain(secret);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects symbolic-link environment files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "annotation-env-test-"));
    const envFile = join(directory, "annotations.env");
    const linkPath = join(directory, "annotations-link.env");
    await writeFile(
      envFile,
      'DATABASE_URL="postgresql://user:secret@localhost:5432/becca"\n' +
        'DIRECT_URL="postgresql://user:secret@localhost:5432/becca"\n',
    );
    await chmod(envFile, 0o600);
    await symlink(envFile, linkPath);

    try {
      await expect(loadEnvironmentFile(linkPath)).rejects.toThrow(
        /must not be a symbolic link/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fingerprints complete connection settings without exposing them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "annotation-env-test-"));
    const first = join(directory, "first.env");
    const second = join(directory, "second.env");
    await writeFile(
      first,
      'DATABASE_URL="postgresql://user:secret@localhost:5432/becca?schema=public"\n' +
        'DIRECT_URL="postgresql://user:secret@localhost:5432/becca?schema=public"\n',
    );
    await writeFile(
      second,
      'DATABASE_URL="postgresql://other:secret@localhost:5432/becca?schema=private"\n' +
        'DIRECT_URL="postgresql://other:secret@localhost:5432/becca?schema=private"\n',
    );
    await Promise.all([chmod(first, 0o600), chmod(second, 0o600)]);

    try {
      const firstEnvironment = await loadEnvironmentFile(first);
      const secondEnvironment = await loadEnvironmentFile(second);
      expect(firstEnvironment.targets).toEqual(secondEnvironment.targets);
      expect(firstEnvironment.connectionSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(secondEnvironment.connectionSha256).not.toBe(
        firstEnvironment.connectionSha256,
      );
      expect(JSON.stringify(firstEnvironment)).not.toContain("secret");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("binds plan tokens to code, connection, catalog, batch, mode, and counts", () => {
    const plan = {
      targets: {
        pooled: { host: "pool.neon.tech", port: "5432", database: "becca" },
        direct: { host: "direct.neon.tech", port: "5432", database: "becca" },
      },
      connectionSha256: "b".repeat(64),
      toolSha256: "c".repeat(64),
      manifestSha256: "a".repeat(64),
      replaceActive: true,
      summary: {
        batchId: "expert-v2",
        catalogSha256: "d".repeat(64),
        validated: 50,
        wouldInsert: 50,
        inserted: 0,
        skipped: 0,
        wouldActivate: 0,
        activated: 0,
        wouldDeactivate: 50,
        deactivated: 0,
        applied: false,
      },
    };
    const token = annotationImportPlanToken(plan);

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(
      annotationImportPlanToken({
        ...plan,
        summary: { ...plan.summary, wouldDeactivate: 49 },
      }),
    ).not.toBe(token);
    expect(
      annotationImportPlanToken({
        ...plan,
        connectionSha256: "e".repeat(64),
      }),
    ).not.toBe(token);
    expect(
      annotationImportPlanToken({
        ...plan,
        toolSha256: "f".repeat(64),
      }),
    ).not.toBe(token);
    expect(
      annotationImportPlanToken({
        ...plan,
        summary: { ...plan.summary, catalogSha256: "0".repeat(64) },
      }),
    ).not.toBe(token);
    expect(
      annotationImportPlanToken({
        ...plan,
        manifestSha256: "1".repeat(64),
      }),
    ).not.toBe(token);
    expect(
      annotationImportPlanToken({
        ...plan,
        replaceActive: false,
      }),
    ).not.toBe(token);
    expect(
      annotationImportPlanToken({
        ...plan,
        summary: { ...plan.summary, wouldInsert: 49 },
      }),
    ).not.toBe(token);
    expect(
      annotationImportPlanToken({
        ...plan,
        targets: {
          ...plan.targets,
          pooled: { ...plan.targets.pooled, database: "other" },
        },
      }),
    ).not.toBe(token);
  });

  it("validates complete manifests and binds provenance bytes to import tokens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "annotation-batch-test-"));
    const scenario = chooseBriscolaScenarioInput({
      code: "expert-v2-00001",
    });

    try {
      const paths = await writeAnnotationBatchFiles(
        directory,
        [scenario],
        "expert-v2",
      );
      const first = await readAnnotationBatch(
        paths.batchPath,
        paths.manifestPath,
      );
      const changed = annotationBatchArtifacts(
        [scenario],
        "expert-v2",
        "ai@different",
      );
      await writeFile(paths.manifestPath, changed.manifestBytes);
      const second = await readAnnotationBatch(
        paths.batchPath,
        paths.manifestPath,
      );
      const summary = {
        batchId: "expert-v2",
        catalogSha256: "d".repeat(64),
        validated: 1,
        wouldInsert: 1,
        inserted: 0,
        skipped: 0,
        wouldActivate: 0,
        activated: 0,
        wouldDeactivate: 1,
        deactivated: 0,
        applied: false,
      };
      const tokenInput = {
        targets: {
          pooled: { host: "pool.neon.tech", port: "5432", database: "becca" },
          direct: {
            host: "direct.neon.tech",
            port: "5432",
            database: "becca",
          },
        },
        connectionSha256: "b".repeat(64),
        toolSha256: "c".repeat(64),
        replaceActive: true,
        summary,
      };

      expect(first.manifest.generatorCommit).toBe("ai@test");
      expect(second.manifest.generatorCommit).toBe("ai@different");
      expect(second.manifestSha256).not.toBe(first.manifestSha256);
      expect(
        annotationImportPlanToken({
          ...tokenInput,
          manifestSha256: second.manifestSha256,
        }),
      ).not.toBe(
        annotationImportPlanToken({
          ...tokenInput,
          manifestSha256: first.manifestSha256,
        }),
      );

      const tampered = structuredClone(changed.manifest);
      tampered.counts.difficulty.medium = 0;
      tampered.counts.difficulty.hard = 1;
      await writeFile(
        paths.manifestPath,
        `${canonicalJson(tampered)}\n`,
      );
      await expect(
        readAnnotationBatch(paths.batchPath, paths.manifestPath),
      ).rejects.toThrow(/counts do not match/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("binds restore tokens to the source batch, catalog, and write counts", () => {
    const plan = {
      targets: {
        pooled: { host: "pool.neon.tech", port: "5432", database: "becca" },
        direct: { host: "direct.neon.tech", port: "5432", database: "becca" },
      },
      connectionSha256: "b".repeat(64),
      toolSha256: "c".repeat(64),
      summary: {
        sourceBatch: "expert-v1",
        catalogSha256: "d".repeat(64),
        retained: 50,
        wouldActivate: 50,
        activated: 0,
        wouldDeactivate: 50,
        deactivated: 0,
        applied: false,
      },
    };
    const token = annotationRestorePlanToken(plan);

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(
      annotationRestorePlanToken({
        ...plan,
        summary: { ...plan.summary, sourceBatch: "expert-v2" },
      }),
    ).not.toBe(token);
    expect(
      annotationRestorePlanToken({
        ...plan,
        summary: { ...plan.summary, catalogSha256: "e".repeat(64) },
      }),
    ).not.toBe(token);
    expect(
      annotationRestorePlanToken({
        ...plan,
        summary: { ...plan.summary, wouldDeactivate: 49 },
      }),
    ).not.toBe(token);
  });

  it("requires exports to use an absolute path outside the checkout", () => {
    expect(() =>
      parseAnnotationDatabaseArgs([
        "export",
        "--env-file",
        "/tmp/annotation.env",
        "--output",
        "annotations.jsonl",
      ]),
    ).toThrow(/absolute path outside/);
    expect(() =>
      parseAnnotationDatabaseArgs([
        "export",
        "--env-file",
        "/tmp/annotation.env",
        "--output",
        join(process.cwd(), "annotations.jsonl"),
      ]),
    ).toThrow(/outside the backend checkout/);
  });

  it("atomically creates mode-600 exports and refuses overwrite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "annotation-export-test-"));
    const output = join(directory, "annotations.jsonl");

    try {
      const written = await writeAnnotationExportFile(output, [
        { id: 1 },
        { id: 2 },
      ]);
      expect(written).toBe(
        join(await realpath(directory), "annotations.jsonl"),
      );
      expect(await readFile(output, "utf8")).toBe('{"id":1}\n{"id":2}\n');
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      await writeFile(output, "unchanged\n");
      await expect(
        writeAnnotationExportFile(output, [{ id: 3 }]),
      ).rejects.toThrow(/refusing to overwrite/);
      expect(await readFile(output, "utf8")).toBe("unchanged\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects export paths whose parent resolves inside the checkout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "annotation-export-test-"));
    const linkedParent = join(directory, "linked-parent");
    await symlink(resolve(__dirname, "../.."), linkedParent, "dir");

    try {
      await expect(
        writeAnnotationExportFile(join(linkedParent, "annotations.jsonl"), [
          { id: 1 },
        ]),
      ).rejects.toThrow(/outside the backend checkout/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
