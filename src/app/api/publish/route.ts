import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { PublishRequestSchema } from "@/lib/domain/schemas";
import { publishWorkflow } from "@/workflows/publish-workflow";
import { putPrivateBlobJson } from "@/lib/server/blob-client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = PublishRequestSchema.safeParse(body);

    if (!parseResult.success) {
      const issues = parseResult.error.issues;
      const approvalError = issues.find((i) => i.path.includes("approved"));

      if (approvalError) {
        return NextResponse.json(
          { error: "Publication requires explicit seller approval (approved must be true)" },
          { status: 400 }
        );
      }

      const errorDetails = issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return NextResponse.json(
        { error: "Invalid publish request payload", details: errorDetails },
        { status: 400 }
      );
    }

    const { listing } = parseResult.data;

    const run = await start(publishWorkflow, [{ listing }]);

    const markerPath = `run-metadata/${run.runId}.json`;
    await putPrivateBlobJson(markerPath, {
      runId: run.runId,
      kind: "publication",
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        runId: run.runId,
        status: "started",
      },
      { status: 202 }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to initialize publish workflow" },
      { status: 500 }
    );
  }
}
